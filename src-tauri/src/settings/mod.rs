use crate::error::{CommandError, SettingsValidationError};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::PathBuf};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersistedSettings {
    pub schema_version: u8,
    pub default_namespace: Option<String>,
    pub initial_tail_lines: u32,
    pub buffer_limit: u32,
    pub log_sources: BTreeMap<String, LogSourceConfig>,
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

pub fn default_settings() -> PersistedSettings {
    PersistedSettings {
        schema_version: 1,
        default_namespace: None,
        initial_tail_lines: 200,
        buffer_limit: 50_000,
        log_sources: BTreeMap::from([
            (
                "app".into(),
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
    }
}
pub fn validate_settings(s: &PersistedSettings) -> Vec<SettingsValidationError> {
    let mut e = Vec::new();
    if s.schema_version != 1 {
        e.push(err("schemaVersion", "schemaVersion must be 1"));
    }
    if s.initial_tail_lines > 100000 {
        e.push(err(
            "initialTailLines",
            "initialTailLines must be 0..100000",
        ));
    }
    if s.buffer_limit < 1000 || s.buffer_limit > 200000 {
        e.push(err("bufferLimit", "bufferLimit must be 1000..200000"));
    }
    let keys: Vec<_> = s.log_sources.keys().map(String::as_str).collect();
    if keys != vec!["access", "app", "error"] {
        e.push(err(
            "logSources",
            "logSources must contain exactly app/access/error keys",
        ));
    }
    for (k, v) in &s.log_sources {
        if v.container.trim().is_empty() {
            e.push(err(
                format!("logSources.{k}.container"),
                "container is required",
            ));
        }
        if !v.file_path.starts_with('/') || v.file_path.contains('\0') {
            e.push(err(
                format!("logSources.{k}.filePath"),
                "filePath must be an absolute path without null bytes",
            ));
        }
    }
    e
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
    if !path.exists() {
        let s = default_settings();
        save_to_path(path, s.clone())?;
        return Ok(GetSettingsResponse {
            settings: s,
            warning: None,
        });
    }
    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => {
            return Ok(GetSettingsResponse {
                settings: default_settings(),
                warning: Some(SettingsWarning {
                    code: "read_failed".into(),
                    message: "Failed to read settings; using defaults".into(),
                    details: Some(e.to_string()),
                }),
            })
        }
    };
    let value: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => {
            return Ok(GetSettingsResponse {
                settings: default_settings(),
                warning: Some(SettingsWarning {
                    code: "parse_failed".into(),
                    message: "Failed to parse settings; using defaults".into(),
                    details: Some(e.to_string()),
                }),
            })
        }
    };
    let settings: PersistedSettings = serde_json::from_value(value).map_err(|e| {
        CommandError::new("settings_validation_failed", "settings validation failed")
            .with_details(e.to_string())
            .with_validation_errors(vec![SettingsValidationError {
                field: "settings".into(),
                message: e.to_string(),
            }])
    })?;
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
    let errors = validate_settings(&settings);
    if !errors.is_empty() {
        return Err(
            CommandError::new("settings_validation_failed", "settings validation failed")
                .with_validation_errors(errors),
        );
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            CommandError::new(
                "settings_save_failed",
                "failed to create settings directory",
            )
            .with_details(e.to_string())
        })?;
    }
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(&settings).map_err(|e| {
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
    Ok(settings)
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
            "APP".into(),
            LogSourceConfig {
                container: "app".into(),
                file_path: "/x".into(),
            },
        )]);
        assert!(!validate_settings(&s).is_empty());
    }
}
