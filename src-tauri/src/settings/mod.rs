use crate::error::{CommandError, SettingsValidationError};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, env, fs, path::PathBuf};
use tauri::Manager;

mod validation;
pub use validation::validate_settings;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersistedSettings {
    pub schema_version: u8,
    #[serde(default = "default_language")]
    pub language: String,
    pub default_namespace: Option<String>,
    pub initial_tail_lines: u32,
    pub buffer_limit: u32,
    pub log_sources: BTreeMap<String, LogSourceConfig>,
    #[serde(default)]
    pub log_policy_id: Option<String>,
    #[serde(default)]
    pub log_policy: Option<serde_json::Value>,
    #[serde(default = "default_target_plugins")]
    pub target_plugins: TargetPluginSettings,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogSourceConfig {
    pub container: String,
    pub file_path: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetPluginSettings {
    pub aws_vm: AwsVmTargetPluginSettings,
    pub csv_file: CsvFileTargetPluginSettings,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AwsVmTargetPluginSettings {
    pub enabled: bool,
    pub bastion_host: String,
    pub bastion_port: u16,
    pub bastion_username: String,
    pub bastion_password_env: String,
    #[serde(default)]
    pub bastion_totp_secret_env: Option<String>,
    pub bastion_password_mode: String,
    pub vm_username: String,
    pub vm_password_env: String,
    pub consul_catalog_command: String,
    pub strict_host_key_checking: bool,
    pub log_paths: BTreeMap<String, String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CsvFileTargetPluginSettings {
    pub enabled: bool,
    pub csv_text: String,
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

fn default_vm_log_paths() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("info".into(), "/var/log/app/info.log".into()),
        ("access".into(), "/var/log/app/access.log".into()),
        ("error".into(), "/var/log/app/error.log".into()),
    ])
}

fn default_target_plugins() -> TargetPluginSettings {
    TargetPluginSettings {
        aws_vm: AwsVmTargetPluginSettings {
            enabled: false,
            bastion_host: String::new(),
            bastion_port: 22,
            bastion_username: String::new(),
            bastion_password_env: "KLOGCAT_BASTION_PASSWORD".into(),
            bastion_totp_secret_env: Some("KLOGCAT_BASTION_TOTP_SECRET".into()),
            bastion_password_mode: "password".into(),
            vm_username: String::new(),
            vm_password_env: "KLOGCAT_VM_PASSWORD".into(),
            consul_catalog_command: "consul catalog nodes -format=json".into(),
            strict_host_key_checking: true,
            log_paths: default_vm_log_paths(),
        },
        csv_file: CsvFileTargetPluginSettings {
            enabled: false,
            csv_text: String::new(),
        },
    }
}

pub fn default_settings() -> PersistedSettings {
    PersistedSettings {
        schema_version: 1,
        language: default_language(),
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
        target_plugins: default_target_plugins(),
    }
}

fn debug_enabled() -> bool {
    env::var("KLOGCAT_DEBUG").is_ok_and(|v| !matches!(v.as_str(), "" | "0" | "false" | "False"))
        || env::args().any(|arg| arg == "--debug")
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
    migrate_missing_target_plugins(&mut value);
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

fn migrate_missing_target_plugins(value: &mut serde_json::Value) -> bool {
    let Some(settings) = value.as_object_mut() else {
        return false;
    };
    let default_plugins =
        serde_json::to_value(default_target_plugins()).unwrap_or(serde_json::Value::Null);
    let Some(default_plugins_obj) = default_plugins.as_object() else {
        return false;
    };
    let target_plugins = settings
        .entry("targetPlugins")
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    deep_merge_defaults(target_plugins, default_plugins_obj);
    if let Some(aws_vm) = target_plugins
        .get_mut("awsVm")
        .and_then(|plugin| plugin.as_object_mut())
    {
        aws_vm.remove("bastionTotpProfile");
        aws_vm.remove("streamCommandTemplate");
    }
    true
}

fn deep_merge_defaults(
    value: &mut serde_json::Value,
    defaults: &serde_json::Map<String, serde_json::Value>,
) {
    if !value.is_object() {
        *value = serde_json::Value::Object(serde_json::Map::new());
    }
    let Some(object) = value.as_object_mut() else {
        return;
    };
    for (key, default_value) in defaults {
        match (object.get_mut(key), default_value.as_object()) {
            (Some(existing), Some(default_object)) => deep_merge_defaults(existing, default_object),
            (Some(_), None) => {}
            (None, _) => {
                object.insert(key.clone(), default_value.clone());
            }
        }
    }
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
    let text = serde_json::to_string_pretty(settings).map_err(|e| {
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

        assert!(migrate_missing_target_plugins(&mut value));
        let settings: PersistedSettings = serde_json::from_value(value).unwrap();

        assert_eq!(settings.target_plugins.aws_vm.bastion_port, 22);
        assert_eq!(
            settings.target_plugins.aws_vm.vm_password_env,
            "KLOGCAT_VM_PASSWORD"
        );
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
        s.target_plugins.aws_vm.enabled = true;
        s.target_plugins.aws_vm.bastion_host = "bastion.example.com".into();
        s.target_plugins.aws_vm.bastion_username = "ops".into();
        s.target_plugins.aws_vm.vm_username = "app".into();
        assert!(validate_settings(&s).is_empty());

        s.target_plugins.aws_vm.bastion_password_env = "bad-name".into();
        assert!(validate_settings(&s)
            .iter()
            .any(|error| error.field == "targetPlugins.awsVm.bastionPasswordEnv"));

        s.target_plugins.aws_vm.bastion_password_env = "KLOGCAT_BASTION_PASSWORD".into();
        s.target_plugins.aws_vm.bastion_username = "-bad".into();
        assert!(validate_settings(&s)
            .iter()
            .any(|error| error.field == "targetPlugins.awsVm.bastionUsername"));

        s.target_plugins.aws_vm.bastion_username = "ops".into();
        s.target_plugins.aws_vm.bastion_password_mode = "password-plus-totp".into();
        s.target_plugins.aws_vm.bastion_totp_secret_env = Some(String::new());
        assert!(validate_settings(&s)
            .iter()
            .any(|error| error.field == "targetPlugins.awsVm.bastionTotpSecretEnv"));
    }
}
