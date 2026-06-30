use crate::error::SettingsValidationError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const REQUIRED_LOG_SOURCE_KEYS: [&str; 3] = ["access", "error", "info"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetPluginSettings {
    pub aws_vm: AwsVmTargetPluginSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AwsVmTargetPluginSettings {
    pub enabled: bool,
    pub bastion_host: String,
    pub bastion_port: u16,
    pub bastion_username: String,
    pub bastion_password: String,
    #[serde(default)]
    pub bastion_totp_secret: Option<String>,
    pub bastion_password_mode: String,
    pub vm_username: String,
    pub vm_password: String,
    pub consul_catalog_command: String,
    pub strict_host_key_checking: bool,
    pub log_paths: BTreeMap<String, String>,
}

pub(crate) fn default_target_plugins() -> TargetPluginSettings {
    TargetPluginSettings {
        aws_vm: AwsVmTargetPluginSettings {
            enabled: false,
            bastion_host: String::new(),
            bastion_port: 22,
            bastion_username: String::new(),
            bastion_password: String::new(),
            bastion_totp_secret: Some(String::new()),
            bastion_password_mode: "password".into(),
            vm_username: String::new(),
            vm_password: String::new(),
            consul_catalog_command: "consul catalog nodes -format=json".into(),
            strict_host_key_checking: true,
            log_paths: default_vm_log_paths(),
        },
    }
}

fn default_vm_log_paths() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("info".into(), "/var/log/app/info.log".into()),
        ("access".into(), "/var/log/app/access.log".into()),
        ("error".into(), "/var/log/app/error.log".into()),
    ])
}

pub(crate) fn validate_target_plugins(
    settings: &TargetPluginSettings,
    errors: &mut Vec<SettingsValidationError>,
) {
    let plugin = &settings.aws_vm;
    validate_bastion_port(plugin, errors);
    validate_password_mode(plugin, errors);
    validate_required_fields(plugin, errors);
    validate_secret_values(plugin, errors);
    validate_usernames(plugin, errors);
    validate_log_paths(plugin, errors);
}

fn validate_bastion_port(
    plugin: &AwsVmTargetPluginSettings,
    errors: &mut Vec<SettingsValidationError>,
) {
    if plugin.bastion_port != 0 {
        return;
    }
    errors.push(err(
        "targetPlugins.awsVm.bastionPort",
        "bastionPort must be 1..65535",
    ));
}

fn validate_password_mode(
    plugin: &AwsVmTargetPluginSettings,
    errors: &mut Vec<SettingsValidationError>,
) {
    if plugin.bastion_password_mode == "password"
        || plugin.bastion_password_mode == "password-plus-totp"
    {
        return;
    }
    errors.push(err(
        "targetPlugins.awsVm.bastionPasswordMode",
        "bastionPasswordMode must be password or password-plus-totp",
    ));
}

fn validate_required_fields(
    plugin: &AwsVmTargetPluginSettings,
    errors: &mut Vec<SettingsValidationError>,
) {
    if !plugin.enabled {
        return;
    }
    for (field, value) in required_field_values(plugin) {
        if value.trim().is_empty() {
            errors.push(err(
                format!("targetPlugins.awsVm.{field}"),
                format!("{field} is required when AWS VM plugin is enabled"),
            ));
        }
    }
}

fn required_field_values(plugin: &AwsVmTargetPluginSettings) -> [(&'static str, &String); 6] {
    [
        ("bastionHost", &plugin.bastion_host),
        ("bastionUsername", &plugin.bastion_username),
        ("bastionPassword", &plugin.bastion_password),
        ("vmUsername", &plugin.vm_username),
        ("vmPassword", &plugin.vm_password),
        ("consulCatalogCommand", &plugin.consul_catalog_command),
    ]
}

fn validate_secret_values(
    plugin: &AwsVmTargetPluginSettings,
    errors: &mut Vec<SettingsValidationError>,
) {
    for (field, value) in [
        ("bastionPassword", &plugin.bastion_password),
        ("vmPassword", &plugin.vm_password),
    ] {
        if value.contains('\0') {
            errors.push(err(
                format!("targetPlugins.awsVm.{field}"),
                format!("{field} cannot contain null bytes"),
            ));
        }
    }
    validate_totp_secret(plugin, errors);
}

fn validate_totp_secret(
    plugin: &AwsVmTargetPluginSettings,
    errors: &mut Vec<SettingsValidationError>,
) {
    let secret = plugin.bastion_totp_secret.as_deref().unwrap_or_default();
    if secret.contains('\0') {
        errors.push(err(
            "targetPlugins.awsVm.bastionTotpSecret",
            "bastionTotpSecret cannot contain null bytes",
        ));
    }
    if plugin.enabled
        && plugin.bastion_password_mode == "password-plus-totp"
        && secret.trim().is_empty()
    {
        errors.push(err(
            "targetPlugins.awsVm.bastionTotpSecret",
            "bastionTotpSecret is required for password-plus-totp mode",
        ));
    }
}

fn validate_usernames(
    plugin: &AwsVmTargetPluginSettings,
    errors: &mut Vec<SettingsValidationError>,
) {
    for (field, value) in [
        ("bastionUsername", &plugin.bastion_username),
        ("vmUsername", &plugin.vm_username),
    ] {
        if !value.trim().is_empty() && !is_ssh_username(value) {
            errors.push(err(
                format!("targetPlugins.awsVm.{field}"),
                format!("{field} must be a safe SSH username"),
            ));
        }
    }
}

fn validate_log_paths(
    plugin: &AwsVmTargetPluginSettings,
    errors: &mut Vec<SettingsValidationError>,
) {
    if !plugin.enabled {
        return;
    }
    let keys: Vec<_> = plugin.log_paths.keys().map(String::as_str).collect();
    if keys.as_slice() != REQUIRED_LOG_SOURCE_KEYS {
        errors.push(err(
            "targetPlugins.awsVm.logPaths",
            "logPaths must contain exactly info/access/error keys",
        ));
    }
    for (key, path) in &plugin.log_paths {
        if !path.starts_with('/') || path.contains('\0') {
            errors.push(err(
                format!("targetPlugins.awsVm.logPaths.{key}"),
                "VM log path must be an absolute path without null bytes",
            ));
        }
    }
}

fn is_ssh_username(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first.is_ascii_alphanumeric() || first == '.' || first == '_')
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
