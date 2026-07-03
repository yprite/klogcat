use crate::error::CommandError;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use rand::{rngs::OsRng, RngCore};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{env, fs, path::Path};

pub(crate) const SECRET_PREFIX: &str = "klogcat-secret:v1:";
const SECRET_FIELDS: [&str; 3] = ["bastionPassword", "bastionTotpSecret", "vmPassword"];
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

pub(crate) fn decrypt_aws_vm_secrets(
    value: &mut serde_json::Value,
    settings_path: &Path,
) -> Result<(), CommandError> {
    transform_aws_vm_secrets(value, |secret| decrypt_secret(settings_path, secret))
}

pub(crate) fn encrypt_aws_vm_secrets(
    value: &mut serde_json::Value,
    settings_path: &Path,
) -> Result<(), CommandError> {
    transform_aws_vm_secrets(value, |secret| match should_encrypt(secret) {
        true => encrypt_secret(settings_path, secret),
        false => Ok(secret.to_owned()),
    })
}

fn should_encrypt(secret: &str) -> bool {
    !secret.is_empty() && !secret.starts_with(SECRET_PREFIX)
}

fn transform_aws_vm_secrets<F>(
    value: &mut serde_json::Value,
    mut transform: F,
) -> Result<(), CommandError>
where
    F: FnMut(&str) -> Result<String, CommandError>,
{
    let Some(aws_vm) = value
        .get_mut("plugins")
        .and_then(|plugins| plugins.get_mut("targets"))
        .and_then(|targets| targets.get_mut("awsVm"))
        .and_then(|plugin| plugin.as_object_mut())
    else {
        return Ok(());
    };
    transform_secret_fields(aws_vm, &mut transform)?;
    transform_target_group_secrets(aws_vm, &mut transform)?;
    Ok(())
}

fn transform_target_group_secrets<F>(
    aws_vm: &mut serde_json::Map<String, serde_json::Value>,
    transform: &mut F,
) -> Result<(), CommandError>
where
    F: FnMut(&str) -> Result<String, CommandError>,
{
    let Some(groups) = aws_vm
        .get_mut("targetGroups")
        .and_then(|value| value.as_array_mut())
    else {
        return Ok(());
    };
    for group in groups.iter_mut().filter_map(|group| group.as_object_mut()) {
        transform_secret_fields(group, transform)?;
    }
    Ok(())
}

fn transform_secret_fields<F>(
    aws_vm: &mut serde_json::Map<String, serde_json::Value>,
    transform: &mut F,
) -> Result<(), CommandError>
where
    F: FnMut(&str) -> Result<String, CommandError>,
{
    for field in SECRET_FIELDS {
        if let Some(transformed) = transformed_secret(aws_vm, field, transform)? {
            aws_vm.insert(field.into(), serde_json::Value::String(transformed));
        }
    }
    Ok(())
}

fn transformed_secret<F>(
    aws_vm: &serde_json::Map<String, serde_json::Value>,
    field: &str,
    transform: &mut F,
) -> Result<Option<String>, CommandError>
where
    F: FnMut(&str) -> Result<String, CommandError>,
{
    let Some(secret) = aws_vm.get(field).and_then(|value| value.as_str()) else {
        return Ok(None);
    };
    transform(secret).map(Some)
}

fn encrypt_secret(settings_path: &Path, plain: &str) -> Result<String, CommandError> {
    let key = settings_encryption_key(settings_path)?;
    let mut nonce_bytes = [0_u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let ciphertext = cipher_for_key(&key)?
        .encrypt(Nonce::from_slice(&nonce_bytes), plain.as_bytes())
        .map_err(|_| secret_encrypt_error("failed to encrypt settings secret"))?;
    let mut payload = nonce_bytes.to_vec();
    payload.extend(ciphertext);
    Ok(format!(
        "{SECRET_PREFIX}{}",
        BASE64_STANDARD.encode(payload)
    ))
}

fn decrypt_secret(settings_path: &Path, value: &str) -> Result<String, CommandError> {
    let Some(encoded) = value.strip_prefix(SECRET_PREFIX) else {
        return Ok(value.to_owned());
    };
    let payload = decode_secret_payload(encoded)?;
    let (nonce_bytes, ciphertext) = payload.split_at(NONCE_LEN);
    let key = settings_encryption_key(settings_path)?;
    let plain = cipher_for_key(&key)?
        .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
        .map_err(|_| secret_decrypt_error("failed to decrypt settings secret"))?;
    String::from_utf8(plain).map_err(|e| {
        secret_decrypt_error("decrypted settings secret is not valid UTF-8")
            .with_details(e.to_string())
    })
}

fn decode_secret_payload(encoded: &str) -> Result<Vec<u8>, CommandError> {
    let payload = BASE64_STANDARD.decode(encoded).map_err(|e| {
        secret_decrypt_error("failed to decode encrypted settings secret")
            .with_details(e.to_string())
    })?;
    if payload.len() <= NONCE_LEN {
        return Err(secret_decrypt_error(
            "encrypted settings secret is too short",
        ));
    }
    Ok(payload)
}

fn cipher_for_key(key: &[u8; KEY_LEN]) -> Result<Aes256Gcm, CommandError> {
    Aes256Gcm::new_from_slice(key).map_err(|_| {
        CommandError::new(
            "settings_secret_key_failed",
            "failed to initialize settings secret cipher",
        )
    })
}

fn settings_encryption_key(settings_path: &Path) -> Result<[u8; KEY_LEN], CommandError> {
    if let Some(key) = key_from_env()? {
        return Ok(key);
    }
    let key_path = settings_path.with_file_name("settings.key");
    if key_path.exists() {
        return read_key_file(&key_path);
    }
    create_key_file(&key_path)
}

fn key_from_env() -> Result<Option<[u8; KEY_LEN]>, CommandError> {
    let Ok(encoded) = env::var("KLOGCAT_SETTINGS_ENCRYPTION_KEY") else {
        return Ok(None);
    };
    BASE64_STANDARD
        .decode(encoded.trim())
        .map_err(|e| {
            secret_key_error("failed to decode KLOGCAT_SETTINGS_ENCRYPTION_KEY")
                .with_details(e.to_string())
        })
        .and_then(|decoded| key_from_slice(&decoded))
        .map(Some)
}

fn read_key_file(key_path: &Path) -> Result<[u8; KEY_LEN], CommandError> {
    let encoded = fs::read_to_string(key_path).map_err(|e| {
        secret_key_error("failed to read settings encryption key").with_details(e.to_string())
    })?;
    BASE64_STANDARD
        .decode(encoded.trim())
        .map_err(|e| {
            secret_key_error("failed to decode settings encryption key").with_details(e.to_string())
        })
        .and_then(|decoded| key_from_slice(&decoded))
}

fn create_key_file(key_path: &Path) -> Result<[u8; KEY_LEN], CommandError> {
    let mut key = [0_u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);
    ensure_key_parent(key_path)?;
    fs::write(key_path, BASE64_STANDARD.encode(key)).map_err(|e| {
        secret_key_error("failed to write settings encryption key").with_details(e.to_string())
    })?;
    protect_key_file(key_path)?;
    Ok(key)
}

fn ensure_key_parent(key_path: &Path) -> Result<(), CommandError> {
    let Some(parent) = key_path.parent() else {
        return Ok(());
    };
    fs::create_dir_all(parent).map_err(|e| {
        secret_key_error("failed to create settings key directory").with_details(e.to_string())
    })
}

fn protect_key_file(key_path: &Path) -> Result<(), CommandError> {
    #[cfg(unix)]
    fs::set_permissions(key_path, fs::Permissions::from_mode(0o600)).map_err(|e| {
        secret_key_error("failed to protect settings encryption key").with_details(e.to_string())
    })?;
    Ok(())
}

fn key_from_slice(value: &[u8]) -> Result<[u8; KEY_LEN], CommandError> {
    value
        .try_into()
        .map_err(|_| secret_key_error("settings encryption key must be 32 bytes"))
}

fn secret_encrypt_error(message: &'static str) -> CommandError {
    CommandError::new("settings_secret_encrypt_failed", message)
}

fn secret_decrypt_error(message: &'static str) -> CommandError {
    CommandError::new("settings_secret_decrypt_failed", message)
}

fn secret_key_error(message: &'static str) -> CommandError {
    CommandError::new("settings_secret_key_failed", message)
}
