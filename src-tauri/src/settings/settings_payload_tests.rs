use super::*;
use serde_json::json;
use std::{env, fs};

#[test]
fn deserializes_and_saves_settings_with_plugin_extension_config() {
    let mut value = serde_json::to_value(default_settings()).unwrap();
    value["plugins"]["extensionRoot"] = json!({ "schema": 1, "enabled": true });
    value["plugins"]["targets"]["thirdPartyTarget"] = json!({
        "enabled": true,
        "endpoint": "https://example.invalid/targets"
    });
    value["plugins"]["viewers"]["thirdPartyViewer"] = json!({
        "enabled": false,
        "layout": "timeline"
    });
    value["plugins"]["viewers"]["raw"]["enabled"] = json!(false);
    value["shortcuts"] = json!({
        "openSettings": "Meta+,",
        "openTargetPicker": "Meta+K",
        "toggleStream": "Meta+Enter",
        "restartStream": "Meta+Shift+Enter"
    });

    let settings: PersistedSettings = serde_json::from_value(value).unwrap();
    assert_eq!(settings.shortcuts.open_settings.as_deref(), Some("Meta+,"));
    assert!(settings.plugins.extra.contains_key("extensionRoot"));
    assert!(settings
        .plugins
        .targets
        .extra
        .contains_key("thirdPartyTarget"));
    assert!(settings
        .plugins
        .viewers
        .extra
        .contains_key("thirdPartyViewer"));

    let dir = env::temp_dir().join(format!(
        "klogcat-settings-extension-payload-test-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("settings.json");

    let saved = save_to_path(path.clone(), settings).unwrap();
    assert!(saved.plugins.viewers.raw.enabled);

    let loaded = load_from_path(path.clone()).unwrap().settings;
    assert!(loaded.plugins.viewers.raw.enabled);
    assert_eq!(loaded.plugins.extra["extensionRoot"]["schema"], json!(1));
    assert_eq!(
        loaded.plugins.targets.extra["thirdPartyTarget"]["endpoint"],
        json!("https://example.invalid/targets")
    );
    assert_eq!(
        loaded.plugins.viewers.extra["thirdPartyViewer"]["layout"],
        json!("timeline")
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn deserializes_partial_plugin_settings_with_defaults() {
    let mut value = serde_json::to_value(default_settings()).unwrap();
    value["plugins"].as_object_mut().unwrap().remove("viewers");
    value["plugins"]["targets"]
        .as_object_mut()
        .unwrap()
        .remove("csvFile");
    value.as_object_mut().unwrap().remove("shortcuts");

    let settings: PersistedSettings = serde_json::from_value(value).unwrap();

    assert_eq!(
        settings.shortcuts.open_target_picker.as_deref(),
        Some("Meta+K")
    );
    assert!(settings.plugins.viewers.raw.enabled);
    assert!(settings.plugins.viewers.api_flow_graph.enabled);
    assert!(!settings.plugins.targets.csv_file.enabled);
}
