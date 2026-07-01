use super::{AwsVmTargetPluginSettings, LogSourceConfig, PersistedSettings};
use crate::error::SettingsValidationError;

const REQUIRED_LOG_SOURCE_KEYS: [&str; 3] = ["access", "error", "info"];
const REQUIRED_AWS_VM_FIELDS: [(&str, fn(&AwsVmTargetPluginSettings) -> &str); 6] = [
    ("bastionHost", |plugin| &plugin.bastion_host),
    ("bastionUsername", |plugin| &plugin.bastion_username),
    ("bastionPasswordEnv", |plugin| &plugin.bastion_password_env),
    ("vmUsername", |plugin| &plugin.vm_username),
    ("vmPasswordEnv", |plugin| &plugin.vm_password_env),
    ("consulCatalogCommand", |plugin| {
        &plugin.consul_catalog_command
    }),
];
const ENV_FIELDS: [(&str, fn(&AwsVmTargetPluginSettings) -> &str); 2] = [
    ("bastionPasswordEnv", |plugin| &plugin.bastion_password_env),
    ("vmPasswordEnv", |plugin| &plugin.vm_password_env),
];
const SSH_USERNAME_FIELDS: [(&str, fn(&AwsVmTargetPluginSettings) -> &str); 2] = [
    ("bastionUsername", |plugin| &plugin.bastion_username),
    ("vmUsername", |plugin| &plugin.vm_username),
];

pub fn validate_settings(s: &PersistedSettings) -> Vec<SettingsValidationError> {
    let mut errors = Vec::new();
    validate_schema_version(s, &mut errors);
    validate_language(s, &mut errors);
    validate_runtime_limits(s, &mut errors);
    validate_log_policy_id(s, &mut errors);
    validate_log_source_keys(s, &mut errors);
    validate_log_sources(s, &mut errors);
    validate_target_plugins(s, &mut errors);
    errors
}

fn validate_schema_version(s: &PersistedSettings, errors: &mut Vec<SettingsValidationError>) {
    if s.schema_version != 1 {
        errors.push(err("schemaVersion", "schemaVersion must be 1"));
    }
}

fn validate_language(s: &PersistedSettings, errors: &mut Vec<SettingsValidationError>) {
    if !matches!(s.language.as_str(), "en" | "ko") {
        errors.push(err("language", "language must be en or ko"));
    }
}

fn validate_runtime_limits(s: &PersistedSettings, errors: &mut Vec<SettingsValidationError>) {
    if s.initial_tail_lines > 100000 {
        errors.push(err(
            "initialTailLines",
            "initialTailLines must be 0..100000",
        ));
    }
    if !(1000..=200000).contains(&s.buffer_limit) {
        errors.push(err("bufferLimit", "bufferLimit must be 1000..200000"));
    }
}

fn validate_log_policy_id(s: &PersistedSettings, errors: &mut Vec<SettingsValidationError>) {
    if s.log_policy_id
        .as_deref()
        .is_some_and(|id| !matches!(id, "scloud" | "custom"))
    {
        errors.push(err("logPolicyId", "logPolicyId must be scloud or custom"));
    }
}

fn validate_log_source_keys(s: &PersistedSettings, errors: &mut Vec<SettingsValidationError>) {
    if sorted_keys(s.log_sources.keys()).as_slice() != REQUIRED_LOG_SOURCE_KEYS {
        errors.push(err(
            "logSources",
            "logSources must contain exactly info/access/error keys",
        ));
    }
}

fn validate_log_sources(s: &PersistedSettings, errors: &mut Vec<SettingsValidationError>) {
    for (key, source) in &s.log_sources {
        validate_log_source(key, source, errors);
    }
}

fn validate_log_source(
    key: &str,
    source: &LogSourceConfig,
    errors: &mut Vec<SettingsValidationError>,
) {
    if source.container.trim().is_empty() {
        errors.push(err(
            format!("logSources.{key}.container"),
            "container is required",
        ));
    }
    if !is_absolute_non_null_path(&source.file_path) {
        errors.push(err(
            format!("logSources.{key}.filePath"),
            "filePath must be an absolute path without null bytes",
        ));
    }
}

fn validate_target_plugins(s: &PersistedSettings, errors: &mut Vec<SettingsValidationError>) {
    let plugin = &s.target_plugins.aws_vm;
    validate_aws_vm_base(plugin, errors);
    validate_aws_vm_required_fields(plugin, errors);
    validate_aws_vm_env_fields(plugin, errors);
    validate_aws_vm_totp(plugin, errors);
    validate_aws_vm_usernames(plugin, errors);
    validate_aws_vm_log_paths(plugin, errors);
}

fn validate_aws_vm_base(
    plugin: &AwsVmTargetPluginSettings,
    errors: &mut Vec<SettingsValidationError>,
) {
    if plugin.bastion_port == 0 {
        errors.push(err(
            "targetPlugins.awsVm.bastionPort",
            "bastionPort must be 1..65535",
        ));
    }
    if !matches!(
        plugin.bastion_password_mode.as_str(),
        "password" | "password-plus-totp"
    ) {
        errors.push(err(
            "targetPlugins.awsVm.bastionPasswordMode",
            "bastionPasswordMode must be password or password-plus-totp",
        ));
    }
}

fn validate_aws_vm_required_fields(
    plugin: &AwsVmTargetPluginSettings,
    errors: &mut Vec<SettingsValidationError>,
) {
    if !plugin.enabled {
        return;
    }
    for (field, getter) in REQUIRED_AWS_VM_FIELDS {
        if getter(plugin).trim().is_empty() {
            errors.push(err(
                format!("targetPlugins.awsVm.{field}"),
                format!("{field} is required when AWS VM plugin is enabled"),
            ));
        }
    }
}

fn validate_aws_vm_env_fields(
    plugin: &AwsVmTargetPluginSettings,
    errors: &mut Vec<SettingsValidationError>,
) {
    for (field, getter) in ENV_FIELDS {
        push_invalid_env(field, getter(plugin), errors);
    }
    if let Some(secret_env) = plugin
        .bastion_totp_secret_env
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        push_invalid_env("bastionTotpSecretEnv", secret_env, errors);
    }
}

fn push_invalid_env(field: &str, value: &str, errors: &mut Vec<SettingsValidationError>) {
    if !is_env_name(value) {
        errors.push(err(
            format!("targetPlugins.awsVm.{field}"),
            format!("{field} must be a valid environment variable name"),
        ));
    }
}

fn validate_aws_vm_totp(
    plugin: &AwsVmTargetPluginSettings,
    errors: &mut Vec<SettingsValidationError>,
) {
    let missing_secret = plugin
        .bastion_totp_secret_env
        .as_deref()
        .is_none_or(|value| value.trim().is_empty());
    if plugin.enabled && plugin.bastion_password_mode == "password-plus-totp" && missing_secret {
        errors.push(err(
            "targetPlugins.awsVm.bastionTotpSecretEnv",
            "bastionTotpSecretEnv is required for password-plus-totp mode",
        ));
    }
}

fn validate_aws_vm_usernames(
    plugin: &AwsVmTargetPluginSettings,
    errors: &mut Vec<SettingsValidationError>,
) {
    for (field, getter) in SSH_USERNAME_FIELDS {
        let value = getter(plugin);
        if !value.trim().is_empty() && !is_ssh_username(value) {
            errors.push(err(
                format!("targetPlugins.awsVm.{field}"),
                format!("{field} must be a safe SSH username"),
            ));
        }
    }
}

fn validate_aws_vm_log_paths(
    plugin: &AwsVmTargetPluginSettings,
    errors: &mut Vec<SettingsValidationError>,
) {
    if sorted_keys(plugin.log_paths.keys()).as_slice() != REQUIRED_LOG_SOURCE_KEYS {
        errors.push(err(
            "targetPlugins.awsVm.logPaths",
            "logPaths must contain exactly info/access/error keys",
        ));
    }
    for (key, path) in &plugin.log_paths {
        if !is_absolute_non_null_path(path) {
            errors.push(err(
                format!("targetPlugins.awsVm.logPaths.{key}"),
                "VM log path must be an absolute path without null bytes",
            ));
        }
    }
}

fn sorted_keys<'a>(keys: impl Iterator<Item = &'a String>) -> Vec<&'a str> {
    keys.map(String::as_str).collect()
}

fn is_absolute_non_null_path(value: &str) -> bool {
    value.starts_with('/') && !value.contains('\0')
}

fn is_env_name(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first.is_ascii_alphabetic())
        && chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

fn is_ssh_username(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first.is_ascii_alphanumeric() || matches!(first, '.' | '_'))
        && value.len() <= 64
        && !value.contains('@')
        && chars.all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
}

fn err(field: impl Into<String>, message: impl Into<String>) -> SettingsValidationError {
    SettingsValidationError {
        field: field.into(),
        message: message.into(),
    }
}
