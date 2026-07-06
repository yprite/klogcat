use crate::error::{CommandError, SettingsValidationError};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, env, fs, path::PathBuf};
use tauri::Manager;

mod plugin_migration;
mod secrets;
mod target_plugin_groups;
mod target_plugins;
#[cfg(test)]
mod vm_target_group_tests;

pub use target_plugin_groups::{AwsVmTargetGroupSettings, AwsVmTargetModuleSettings};
use target_plugins::{default_plugins, validate_target_plugins};
pub use target_plugins::{
    AwsVmTargetPluginSettings, CsvFileTargetPluginSettings, PluginSettings, TargetPluginSettings,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersistedSettings {
    pub schema_version: u8,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_color_theme")]
    pub color_theme: String,
    pub default_namespace: Option<String>,
    pub initial_tail_lines: u32,
    pub buffer_limit: u32,
    pub log_sources: BTreeMap<String, LogSourceConfig>,
    #[serde(default)]
    pub log_policy_id: Option<String>,
    #[serde(default)]
    pub log_policy: Option<serde_json::Value>,
    #[serde(default = "default_plugins")]
    pub plugins: PluginSettings,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogSourceConfig {
    pub container: String,
    pub file_path: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsWarning {
    pub code: String,
    pub message: String,
    pub details: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSettingsResponse {
    pub settings: PersistedSettings,
    pub warning: Option<SettingsWarning>,
}

fn default_language() -> String {
    "en".into()
}

fn default_color_theme() -> String {
    "dark-plus".into()
}

pub fn default_settings() -> PersistedSettings {
    PersistedSettings {
        schema_version: 1,
        language: default_language(),
        color_theme: default_color_theme(),
        default_namespace: None,
        initial_tail_lines: 200,
        buffer_limit: 50_000,
        log_sources: BTreeMap::from([
            (
                "info".into(),
                LogSourceConfig {
                    container: "app".into(),
                    file_path: "/var/log/app/info.log".into(),
                },
            ),
            (
                "access".into(),
                LogSourceConfig {
                    container: "app".into(),
                    file_path: "/var/log/app/access.log".into(),
                },
            ),
            (
                "error".into(),
                LogSourceConfig {
                    container: "app".into(),
                    file_path: "/var/log/app/error.log".into(),
                },
            ),
        ]),
        log_policy_id: Some("scloud".into()),
        log_policy: None,
        plugins: default_plugins(),
    }
}

fn debug_enabled() -> bool {
    env::var("KLOGCAT_DEBUG").is_ok_and(|v| !matches!(v.as_str(), "" | "0" | "false" | "False"))
        || env::args().any(|arg| arg == "--debug")
}

const REQUIRED_LOG_SOURCE_KEYS: [&str; 3] = ["access", "error", "info"];

pub fn validate_settings(s: &PersistedSettings) -> Vec<SettingsValidationError> {
    let mut errors = Vec::new();
    validate_schema_version(s, &mut errors);
    validate_language(s, &mut errors);
    validate_color_theme(s, &mut errors);
    validate_runtime_limits(s, &mut errors);
    validate_log_policy_id(s, &mut errors);
    validate_log_source_keys(s, &mut errors);
    validate_log_sources(s, &mut errors);
    validate_target_plugins(&s.plugins.targets, &mut errors);
    errors
}

fn validate_schema_version(s: &PersistedSettings, errors: &mut Vec<SettingsValidationError>) {
    if s.schema_version != 1 {
        errors.push(err("schemaVersion", "schemaVersion must be 1"));
    }
}

fn validate_language(s: &PersistedSettings, errors: &mut Vec<SettingsValidationError>) {
    if s.language != "en" && s.language != "ko" {
        errors.push(err("language", "language must be en or ko"));
    }
}

fn validate_color_theme(s: &PersistedSettings, errors: &mut Vec<SettingsValidationError>) {
    if !matches!(
        s.color_theme.as_str(),
        "dark-plus"
            | "light-plus"
            | "dark-modern"
            | "light-modern"
            | "quiet-light"
            | "solarized-dark"
            | "solarized-light"
            | "monokai"
            | "red"
            | "tomorrow-night-blue"
            | "abyss"
            | "kimbie-dark"
            | "high-contrast"
            | "high-contrast-light"
    ) {
        errors.push(err(
            "colorTheme",
            "colorTheme must be a supported VS Code color theme",
        ));
    }
}

fn validate_runtime_limits(s: &PersistedSettings, errors: &mut Vec<SettingsValidationError>) {
    if s.initial_tail_lines > 100000 {
        errors.push(err(
            "initialTailLines",
            "initialTailLines must be 0..100000",
        ));
    }
    if s.buffer_limit < 1000 || s.buffer_limit > 200000 {
        errors.push(err("bufferLimit", "bufferLimit must be 1000..200000"));
    }
}

fn validate_log_policy_id(s: &PersistedSettings, errors: &mut Vec<SettingsValidationError>) {
    let Some(log_policy_id) = &s.log_policy_id else {
        return;
    };
    if log_policy_id != "scloud" && log_policy_id != "custom" {
        errors.push(err("logPolicyId", "logPolicyId must be scloud or custom"));
    }
}

fn validate_log_source_keys(s: &PersistedSettings, errors: &mut Vec<SettingsValidationError>) {
    let keys: Vec<_> = s.log_sources.keys().map(String::as_str).collect();
    if keys.as_slice() != REQUIRED_LOG_SOURCE_KEYS {
        errors.push(err(
            "logSources",
            "logSources must contain exactly info/access/error keys",
        ));
    }
}

fn validate_log_sources(s: &PersistedSettings, errors: &mut Vec<SettingsValidationError>) {
    for (k, v) in &s.log_sources {
        validate_log_source(k, v, errors);
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
    if !source.file_path.starts_with('/') || source.file_path.contains('\0') {
        errors.push(err(
            format!("logSources.{key}.filePath"),
            "filePath must be an absolute path without null bytes",
        ));
    }
}

fn err(field: impl Into<String>, message: impl Into<String>) -> SettingsValidationError {
    SettingsValidationError {
        field: field.into(),
        message: message.into(),
    }
}
fn path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, CommandError> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| {
            CommandError::new("settings_read_failed", "failed to resolve config dir")
                .with_details(e.to_string())
        })?
        .join("settings.json"))
}

fn migrate_legacy_app_log_source(value: &mut serde_json::Value) -> bool {
    let Some(log_sources) = value.get_mut("logSources").and_then(|v| v.as_object_mut()) else {
        return false;
    };
    if log_sources.contains_key("info") {
        return false;
    }
    let Some(app_config) = log_sources.remove("app") else {
        return false;
    };
    log_sources.insert("info".into(), app_config);
    true
}
pub fn load<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<GetSettingsResponse, CommandError> {
    load_from_path(path(app)?)
}
pub fn save<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    settings: PersistedSettings,
) -> Result<PersistedSettings, CommandError> {
    save_to_path(path(app)?, settings)
}
pub fn reset<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<PersistedSettings, CommandError> {
    save_to_path(path(app)?, default_settings())
}
pub fn load_from_path(path: PathBuf) -> Result<GetSettingsResponse, CommandError> {
    if debug_enabled() {
        eprintln!("[klogcat debug] loading settings from {}", path.display());
    }
    if !path.exists() {
        return save_default_settings(path);
    }
    let mut value = match read_settings_json(&path) {
        Ok(value) => value,
        Err(warning) => {
            return Ok(GetSettingsResponse {
                settings: default_settings(),
                warning: Some(warning),
            });
        }
    };
    migrate_legacy_app_log_source(&mut value);
    plugin_migration::migrate_missing_plugins(&mut value);
    secrets::decrypt_aws_vm_secrets(&mut value, &path)?;
    let settings = load_settings_from_value(value)?;
    let errors = validate_settings(&settings);
    if !errors.is_empty() {
        return Err(
            CommandError::new("settings_validation_failed", "settings validation failed")
                .with_validation_errors(errors),
        );
    }
    Ok(GetSettingsResponse {
        settings,
        warning: None,
    })
}

pub fn save_to_path(
    path: PathBuf,
    settings: PersistedSettings,
) -> Result<PersistedSettings, CommandError> {
    if debug_enabled() {
        eprintln!("[klogcat debug] saving settings to {}", path.display());
    }
    ensure_settings_valid(&settings)?;
    persist_settings(path, &settings)?;
    Ok(settings)
}

fn save_default_settings(path: PathBuf) -> Result<GetSettingsResponse, CommandError> {
    let settings = default_settings();
    save_to_path(path, settings.clone())?;
    Ok(GetSettingsResponse {
        settings,
        warning: None,
    })
}

fn read_settings_json(path: &PathBuf) -> Result<serde_json::Value, SettingsWarning> {
    let text = fs::read_to_string(path).map_err(|e| {
        settings_warning(
            "read_failed",
            "Failed to read settings; using defaults",
            e.to_string(),
        )
    })?;

    serde_json::from_str(&text).map_err(|e| {
        settings_warning(
            "parse_failed",
            "Failed to parse settings; using defaults",
            e.to_string(),
        )
    })
}

fn load_settings_from_value(value: serde_json::Value) -> Result<PersistedSettings, CommandError> {
    serde_json::from_value(value).map_err(|e| {
        CommandError::new("settings_validation_failed", "settings validation failed")
            .with_details(e.to_string())
            .with_validation_errors(vec![SettingsValidationError {
                field: "settings".into(),
                message: e.to_string(),
            }])
    })
}

fn settings_warning(
    code: impl Into<String>,
    message: impl Into<String>,
    details: String,
) -> SettingsWarning {
    SettingsWarning {
        code: code.into(),
        message: message.into(),
        details: Some(details),
    }
}

fn ensure_settings_valid(settings: &PersistedSettings) -> Result<(), CommandError> {
    let errors = validate_settings(settings);
    if errors.is_empty() {
        return Ok(());
    }
    Err(
        CommandError::new("settings_validation_failed", "settings validation failed")
            .with_validation_errors(errors),
    )
}

fn persist_settings(path: PathBuf, settings: &PersistedSettings) -> Result<(), CommandError> {
    ensure_parent_directory(path.as_path())?;
    let tmp = path.with_extension("json.tmp");
    let mut value = serde_json::to_value(settings).map_err(|e| {
        CommandError::new("settings_save_failed", "failed to serialize settings")
            .with_details(e.to_string())
    })?;
    secrets::encrypt_aws_vm_secrets(&mut value, &path)?;
    let text = serde_json::to_string_pretty(&value).map_err(|e| {
        CommandError::new("settings_save_failed", "failed to serialize settings")
            .with_details(e.to_string())
    })?;
    fs::write(&tmp, text).map_err(|e| {
        CommandError::new("settings_save_failed", "failed to write settings")
            .with_details(e.to_string())
    })?;
    fs::rename(&tmp, &path).map_err(|e| {
        CommandError::new("settings_save_failed", "failed to replace settings")
            .with_details(e.to_string())
    })?;
    Ok(())
}

fn ensure_parent_directory(path: &std::path::Path) -> Result<(), CommandError> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    fs::create_dir_all(parent).map_err(|e| {
        CommandError::new(
            "settings_save_failed",
            "failed to create settings directory",
        )
        .with_details(e.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_settings_validate() {
        assert!(validate_settings(&default_settings()).is_empty());
    }
    #[test]
    fn uppercase_keys_invalid() {
        let mut s = default_settings();
        s.log_sources = BTreeMap::from([(
            "INFO".into(),
            LogSourceConfig {
                container: "app".into(),
                file_path: "/x".into(),
            },
        )]);
        assert!(!validate_settings(&s).is_empty());
    }

    #[test]
    fn migrates_legacy_app_log_source_key_to_info() {
        let mut value = serde_json::json!({
            "schemaVersion": 1,
            "defaultNamespace": null,
            "initialTailLines": 200,
            "bufferLimit": 50000,
            "logSources": {
                "app": { "container": "app", "filePath": "/var/log/app/info.log" },
                "access": { "container": "app", "filePath": "/var/log/app/access.log" },
                "error": { "container": "app", "filePath": "/var/log/app/error.log" }
            }
        });

        assert!(migrate_legacy_app_log_source(&mut value));
        let settings: PersistedSettings = serde_json::from_value(value).unwrap();

        assert!(settings.log_sources.contains_key("info"));
        assert!(!settings.log_sources.contains_key("app"));
        assert!(validate_settings(&settings).is_empty());
    }

    #[test]
    fn preserves_optional_log_policy_for_frontend_settings() {
        let value = serde_json::json!({
            "schemaVersion": 1,
            "defaultNamespace": null,
            "initialTailLines": 200,
            "bufferLimit": 50000,
            "logSources": {
                "info": { "container": "app", "filePath": "/var/log/app/info.log" },
                "access": { "container": "app", "filePath": "/var/log/app/access.log" },
                "error": { "container": "app", "filePath": "/var/log/app/error.log" }
            },
            "logPolicyId": "custom",
            "logPolicy": {
                "version": 1,
                "pathTemplate": "/custom/[namespace]/[podname][suffix].log"
            }
        });

        let settings: PersistedSettings = serde_json::from_value(value).unwrap();

        assert_eq!(settings.log_policy_id.as_deref(), Some("custom"));
        assert_eq!(
            settings.log_policy.unwrap()["pathTemplate"],
            serde_json::json!("/custom/[namespace]/[podname][suffix].log")
        );
    }

    #[test]
    fn deep_merges_partial_target_plugins() {
        let mut value = serde_json::json!({
            "schemaVersion": 1,
            "defaultNamespace": null,
            "initialTailLines": 200,
            "bufferLimit": 50000,
            "logSources": {
                "info": { "container": "app", "filePath": "/var/log/app/info.log" },
                "access": { "container": "app", "filePath": "/var/log/app/access.log" },
                "error": { "container": "app", "filePath": "/var/log/app/error.log" }
            },
            "targetPlugins": {
                "awsVm": { "enabled": false, "bastionTotpProfile": "old" }
            }
        });

        assert!(plugin_migration::migrate_missing_plugins(&mut value));
        let settings: PersistedSettings = serde_json::from_value(value).unwrap();

        assert_eq!(settings.plugins.targets.aws_vm.bastion_port, 22);
        assert_eq!(settings.plugins.targets.aws_vm.vm_password, "");
        assert!(validate_settings(&settings).is_empty());
    }

    #[test]
    fn rejects_unknown_log_policy_id() {
        let mut s = default_settings();
        s.log_policy_id = Some("unknown".into());

        assert!(validate_settings(&s)
            .iter()
            .any(|error| error.field == "logPolicyId"));
    }

    #[test]
    fn validates_aws_vm_plugin_security_fields() {
        let mut s = default_settings();
        s.plugins.targets.aws_vm.enabled = true;
        s.plugins.targets.aws_vm.target_groups.clear();
        s.plugins.targets.aws_vm.bastion_host = "bastion.example.com".into();
        s.plugins.targets.aws_vm.bastion_username = "ops".into();
        s.plugins.targets.aws_vm.bastion_password = "bastion-password".into();
        s.plugins.targets.aws_vm.vm_username = "app".into();
        s.plugins.targets.aws_vm.vm_password = "vm-password".into();
        assert!(validate_settings(&s).is_empty());

        s.plugins.targets.aws_vm.vm_username = "operator@example.com".into();
        assert!(validate_settings(&s).is_empty());

        s.plugins.targets.aws_vm.bastion_password = "bad\0secret".into();
        assert!(validate_settings(&s)
            .iter()
            .any(|error| error.field == "plugins.targets.awsVm.bastionPassword"));

        s.plugins.targets.aws_vm.bastion_password = "bastion-password".into();
        s.plugins.targets.aws_vm.vm_username = "app".into();
        s.plugins.targets.aws_vm.bastion_username = "-bad".into();
        assert!(validate_settings(&s)
            .iter()
            .any(|error| error.field == "plugins.targets.awsVm.bastionUsername"));

        s.plugins.targets.aws_vm.bastion_username = "operator@example.com".into();
        assert!(validate_settings(&s)
            .iter()
            .any(|error| error.field == "plugins.targets.awsVm.bastionUsername"));

        s.plugins.targets.aws_vm.bastion_username = "ops".into();
        s.plugins.targets.aws_vm.bastion_password_mode = "password-plus-totp".into();
        s.plugins.targets.aws_vm.bastion_totp_secret = Some(String::new());
        assert!(validate_settings(&s)
            .iter()
            .any(|error| error.field == "plugins.targets.awsVm.bastionTotpSecret"));
    }

    #[test]
    fn encrypts_aws_vm_secrets_on_disk_and_decrypts_on_load() {
        let dir = env::temp_dir().join(format!(
            "klogcat-settings-secret-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        let mut s = default_settings();
        s.plugins.targets.aws_vm.bastion_password = "bastion-password".into();
        s.plugins.targets.aws_vm.bastion_totp_secret = Some("totp-secret".into());
        s.plugins.targets.aws_vm.vm_password = "vm-password".into();

        save_to_path(path.clone(), s.clone()).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains(secrets::SECRET_PREFIX));
        assert!(!text.contains("bastion-password"));
        assert!(!text.contains("totp-secret"));
        assert!(!text.contains("vm-password"));

        let loaded = load_from_path(path.clone()).unwrap().settings;
        assert_eq!(
            loaded.plugins.targets.aws_vm.bastion_password,
            "bastion-password"
        );
        assert_eq!(
            loaded.plugins.targets.aws_vm.bastion_totp_secret.as_deref(),
            Some("totp-secret")
        );
        assert_eq!(loaded.plugins.targets.aws_vm.vm_password, "vm-password");
        let _ = fs::remove_dir_all(&dir);
    }
}
