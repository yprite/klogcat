use super::target_plugins::AwsVmTargetPluginSettings;
use crate::error::SettingsValidationError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const REQUIRED_LOG_SOURCE_KEYS: [&str; 3] = ["access", "error", "info"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AwsVmTargetGroupSettings {
    pub id: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub bastion_host: Option<String>,
    #[serde(default)]
    pub bastion_port: Option<u16>,
    #[serde(default)]
    pub bastion_username: Option<String>,
    #[serde(default)]
    pub bastion_password: Option<String>,
    #[serde(default)]
    pub bastion_totp_secret: Option<String>,
    #[serde(default)]
    pub bastion_password_mode: Option<String>,
    #[serde(default)]
    pub vm_username: Option<String>,
    #[serde(default)]
    pub vm_password: Option<String>,
    #[serde(default)]
    pub consul_catalog_command: Option<String>,
    #[serde(default)]
    pub strict_host_key_checking: Option<bool>,
    #[serde(default)]
    pub log_paths: BTreeMap<String, String>,
    #[serde(default)]
    pub modules: Vec<AwsVmTargetModuleSettings>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AwsVmTargetModuleSettings {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub consul_catalog_command: Option<String>,
    #[serde(default)]
    pub log_paths: BTreeMap<String, String>,
}

fn default_true() -> bool {
    true
}

pub(crate) fn validate_group_secret_values(
    plugin: &AwsVmTargetPluginSettings,
    errors: &mut Vec<SettingsValidationError>,
) {
    for (index, group) in plugin.target_groups.iter().enumerate() {
        let prefix = format!("plugins.targets.awsVm.targetGroups.{index}");
        validate_optional_secret(&group.bastion_password, &prefix, "bastionPassword", errors);
        validate_optional_secret(&group.vm_password, &prefix, "vmPassword", errors);
        validate_optional_secret(
            &group.bastion_totp_secret,
            &prefix,
            "bastionTotpSecret",
            errors,
        );
    }
}

fn validate_optional_secret(
    value: &Option<String>,
    prefix: &str,
    field: &str,
    errors: &mut Vec<SettingsValidationError>,
) {
    if value.as_deref().is_some_and(|secret| secret.contains('\0')) {
        errors.push(err(
            format!("{prefix}.{field}"),
            format!("{field} cannot contain null bytes"),
        ));
    }
}

pub(crate) fn validate_group_usernames(
    plugin: &AwsVmTargetPluginSettings,
    errors: &mut Vec<SettingsValidationError>,
) {
    for (index, group) in plugin.target_groups.iter().enumerate() {
        let prefix = format!("plugins.targets.awsVm.targetGroups.{index}");
        validate_optional_username(
            group.bastion_username.as_deref(),
            &prefix,
            "bastionUsername",
            is_ssh_username,
            errors,
        );
        validate_optional_username(
            group.vm_username.as_deref(),
            &prefix,
            "vmUsername",
            is_vm_username,
            errors,
        );
    }
}

fn validate_optional_username(
    value: Option<&str>,
    prefix: &str,
    field: &str,
    is_valid: fn(&str) -> bool,
    errors: &mut Vec<SettingsValidationError>,
) {
    if value.is_some_and(|username| !username.trim().is_empty() && !is_valid(username)) {
        errors.push(err(
            format!("{prefix}.{field}"),
            format!("{field} must be a safe SSH username or email account"),
        ));
    }
}

pub(crate) fn validate_group_log_paths(
    plugin: &AwsVmTargetPluginSettings,
    errors: &mut Vec<SettingsValidationError>,
) {
    for (group_index, group) in plugin.target_groups.iter().enumerate() {
        validate_partial_log_paths(
            &group.log_paths,
            &format!("plugins.targets.awsVm.targetGroups.{group_index}.logPaths"),
            errors,
        );
        for (module_index, module) in group.modules.iter().enumerate() {
            validate_partial_log_paths(
                &module.log_paths,
                &format!(
                    "plugins.targets.awsVm.targetGroups.{group_index}.modules.{module_index}.logPaths"
                ),
                errors,
            );
        }
    }
}

fn validate_partial_log_paths(
    log_paths: &BTreeMap<String, String>,
    prefix: &str,
    errors: &mut Vec<SettingsValidationError>,
) {
    for (key, path) in log_paths {
        validate_partial_log_path_key(key, prefix, errors);
        validate_log_path_value(key, path, prefix, errors);
    }
}

fn validate_partial_log_path_key(
    key: &str,
    prefix: &str,
    errors: &mut Vec<SettingsValidationError>,
) {
    if !REQUIRED_LOG_SOURCE_KEYS.contains(&key) {
        errors.push(err(
            format!("{prefix}.{key}"),
            format!("Unknown log path key: {key}"),
        ));
    }
}

fn validate_log_path_value(
    key: &str,
    path: &str,
    prefix: &str,
    errors: &mut Vec<SettingsValidationError>,
) {
    if !path.starts_with('/') || path.contains('\0') {
        errors.push(err(
            format!("{prefix}.{key}"),
            "VM log path must be an absolute path without null bytes",
        ));
    }
}

pub(crate) fn validate_target_groups(
    plugin: &AwsVmTargetPluginSettings,
    errors: &mut Vec<SettingsValidationError>,
) {
    for (index, group) in plugin.target_groups.iter().enumerate() {
        let prefix = format!("plugins.targets.awsVm.targetGroups.{index}");
        validate_group_identity(group, &prefix, errors);
        validate_group_port(group, &prefix, errors);
        validate_group_password_mode(group, &prefix, errors);
        validate_module_identities(group, &prefix, errors);
    }
}

fn validate_group_identity(
    group: &AwsVmTargetGroupSettings,
    prefix: &str,
    errors: &mut Vec<SettingsValidationError>,
) {
    if group.id.trim().is_empty() {
        errors.push(err(format!("{prefix}.id"), "target group id is required"));
    }
    if group.name.trim().is_empty() {
        errors.push(err(
            format!("{prefix}.name"),
            "target group name is required",
        ));
    }
}

fn validate_group_port(
    group: &AwsVmTargetGroupSettings,
    prefix: &str,
    errors: &mut Vec<SettingsValidationError>,
) {
    if group.bastion_port == Some(0) {
        errors.push(err(
            format!("{prefix}.bastionPort"),
            "bastionPort must be 1..65535",
        ));
    }
}

fn validate_group_password_mode(
    group: &AwsVmTargetGroupSettings,
    prefix: &str,
    errors: &mut Vec<SettingsValidationError>,
) {
    if group
        .bastion_password_mode
        .as_deref()
        .is_some_and(|mode| mode != "password" && mode != "password-plus-totp")
    {
        errors.push(err(
            format!("{prefix}.bastionPasswordMode"),
            "bastionPasswordMode must be password or password-plus-totp",
        ));
    }
}

fn validate_module_identities(
    group: &AwsVmTargetGroupSettings,
    group_prefix: &str,
    errors: &mut Vec<SettingsValidationError>,
) {
    for (index, module) in group.modules.iter().enumerate() {
        let prefix = format!("{group_prefix}.modules.{index}");
        if module.id.trim().is_empty() {
            errors.push(err(format!("{prefix}.id"), "target module id is required"));
        }
        if module.name.trim().is_empty() {
            errors.push(err(
                format!("{prefix}.name"),
                "target module name is required",
            ));
        }
    }
}

pub(crate) fn validate_effective_target_groups(
    plugin: &AwsVmTargetPluginSettings,
    errors: &mut Vec<SettingsValidationError>,
) {
    if !plugin.enabled || plugin.target_groups.is_empty() {
        return;
    }
    let enabled_count = plugin
        .target_groups
        .iter()
        .enumerate()
        .filter(|(_, group)| group.enabled)
        .map(|(index, group)| validate_effective_group(plugin, group, index, errors))
        .count();
    if enabled_count == 0 {
        errors.push(err(
            "plugins.targets.awsVm.targetGroups",
            "at least one enabled VM target group is required",
        ));
    }
}

fn validate_effective_group(
    plugin: &AwsVmTargetPluginSettings,
    group: &AwsVmTargetGroupSettings,
    group_index: usize,
    errors: &mut Vec<SettingsValidationError>,
) {
    let base = effective_group_plugin(plugin, group);
    if group.modules.is_empty() {
        validate_effective_plugin(
            &base,
            &format!("plugins.targets.awsVm.targetGroups.{group_index}"),
            errors,
        );
        return;
    }
    for (module_index, module) in group.modules.iter().enumerate() {
        validate_effective_plugin(
            &effective_module_plugin(&base, module),
            &format!("plugins.targets.awsVm.targetGroups.{group_index}.modules.{module_index}"),
            errors,
        );
    }
}

fn validate_effective_plugin(
    plugin: &AwsVmTargetPluginSettings,
    prefix: &str,
    errors: &mut Vec<SettingsValidationError>,
) {
    for (field, value) in required_field_values(plugin) {
        if value.trim().is_empty() {
            errors.push(err(
                format!("{prefix}.{field}"),
                format!("{field} is required when AWS VM plugin is enabled"),
            ));
        }
    }
    validate_effective_totp(plugin, prefix, errors);
    validate_effective_log_path_keys(plugin, prefix, errors);
}

fn validate_effective_totp(
    plugin: &AwsVmTargetPluginSettings,
    prefix: &str,
    errors: &mut Vec<SettingsValidationError>,
) {
    if plugin.bastion_password_mode == "password-plus-totp"
        && plugin
            .bastion_totp_secret
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
    {
        errors.push(err(
            format!("{prefix}.bastionTotpSecret"),
            "bastionTotpSecret is required for password-plus-totp mode",
        ));
    }
}

fn validate_effective_log_path_keys(
    plugin: &AwsVmTargetPluginSettings,
    prefix: &str,
    errors: &mut Vec<SettingsValidationError>,
) {
    let keys: Vec<_> = plugin.log_paths.keys().map(String::as_str).collect();
    if keys.as_slice() != REQUIRED_LOG_SOURCE_KEYS {
        errors.push(err(
            format!("{prefix}.logPaths"),
            "logPaths must contain exactly info/access/error keys",
        ));
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

fn effective_group_plugin(
    plugin: &AwsVmTargetPluginSettings,
    group: &AwsVmTargetGroupSettings,
) -> AwsVmTargetPluginSettings {
    let mut next = plugin.clone();
    next.target_groups.clear();
    apply_optional_string(&mut next.bastion_host, &group.bastion_host);
    if let Some(value) = group.bastion_port {
        next.bastion_port = value;
    }
    apply_optional_string(&mut next.bastion_username, &group.bastion_username);
    apply_optional_string(&mut next.bastion_password, &group.bastion_password);
    if let Some(value) = non_empty(&group.bastion_totp_secret) {
        next.bastion_totp_secret = Some(value);
    }
    apply_optional_string(
        &mut next.bastion_password_mode,
        &group.bastion_password_mode,
    );
    apply_optional_string(&mut next.vm_username, &group.vm_username);
    apply_optional_string(&mut next.vm_password, &group.vm_password);
    apply_optional_string(
        &mut next.consul_catalog_command,
        &group.consul_catalog_command,
    );
    if let Some(value) = group.strict_host_key_checking {
        next.strict_host_key_checking = value;
    }
    next.log_paths.extend(group.log_paths.clone());
    next
}

fn effective_module_plugin(
    plugin: &AwsVmTargetPluginSettings,
    module: &AwsVmTargetModuleSettings,
) -> AwsVmTargetPluginSettings {
    let mut next = plugin.clone();
    apply_optional_string(
        &mut next.consul_catalog_command,
        &module.consul_catalog_command,
    );
    next.log_paths.extend(module.log_paths.clone());
    next
}

fn apply_optional_string(target: &mut String, value: &Option<String>) {
    if let Some(value) = non_empty(value) {
        *target = value;
    }
}

fn non_empty(value: &Option<String>) -> Option<String> {
    value
        .as_ref()
        .filter(|item| !item.trim().is_empty())
        .cloned()
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

fn is_vm_username(value: &str) -> bool {
    is_ssh_username(value) || is_ssh_email_username(value)
}

fn is_ssh_email_username(value: &str) -> bool {
    let Some((local, domain)) = value.split_once('@') else {
        return false;
    };
    is_safe_email_local(local) && is_safe_email_domain(domain)
}

fn is_safe_email_local(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '%' | '+' | '-'))
}

fn is_safe_email_domain(value: &str) -> bool {
    value.contains('.') && value.split('.').all(is_safe_email_label)
}

fn is_safe_email_label(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    value.len() <= 63
        && first.is_ascii_alphanumeric()
        && !value.ends_with('-')
        && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
}

fn err(field: impl Into<String>, message: impl Into<String>) -> SettingsValidationError {
    SettingsValidationError {
        field: field.into(),
        message: message.into(),
    }
}
