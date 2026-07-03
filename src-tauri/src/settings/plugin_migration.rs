use super::target_plugins::default_plugins;
use std::env;

pub(super) fn migrate_missing_plugins(value: &mut serde_json::Value) -> bool {
    let Some(settings) = value.as_object_mut() else {
        return false;
    };
    let Some(plugins) = plugins_with_legacy_targets(settings) else {
        return false;
    };
    if !merge_default_plugins(plugins) {
        return false;
    }
    migrate_legacy_aws_vm_settings(plugins);
    true
}

fn plugins_with_legacy_targets(
    settings: &mut serde_json::Map<String, serde_json::Value>,
) -> Option<&mut serde_json::Value> {
    let legacy_target_plugins = settings.remove("targetPlugins");
    let plugins = settings
        .entry("plugins")
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    if let Some(legacy_target_plugins) = legacy_target_plugins {
        merge_legacy_targets(plugins, legacy_target_plugins);
    }
    Some(plugins)
}

fn merge_default_plugins(plugins: &mut serde_json::Value) -> bool {
    let default_plugins =
        serde_json::to_value(default_plugins()).unwrap_or(serde_json::Value::Null);
    let Some(default_plugins_obj) = default_plugins.as_object() else {
        return false;
    };
    deep_merge_defaults(plugins, default_plugins_obj);
    true
}

fn merge_legacy_targets(plugins: &mut serde_json::Value, legacy_target_plugins: serde_json::Value) {
    let targets = plugins.as_object_mut().map(|plugins| {
        plugins
            .entry("targets")
            .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()))
    });
    if let Some(targets) = targets {
        deep_merge_legacy(targets, legacy_target_plugins);
    }
}

fn migrate_legacy_aws_vm_settings(plugins: &mut serde_json::Value) {
    if let Some(aws_vm) = plugins
        .get_mut("targets")
        .and_then(|targets| targets.get_mut("awsVm"))
        .and_then(|plugin| plugin.as_object_mut())
    {
        migrate_legacy_env_secret(aws_vm, "bastionPasswordEnv", "bastionPassword");
        migrate_legacy_env_secret(aws_vm, "bastionTotpSecretEnv", "bastionTotpSecret");
        migrate_legacy_env_secret(aws_vm, "vmPasswordEnv", "vmPassword");
        aws_vm.remove("bastionTotpProfile");
        aws_vm.remove("streamCommandTemplate");
    }
}

fn deep_merge_legacy(target: &mut serde_json::Value, legacy: serde_json::Value) {
    if !target.is_object() {
        *target = serde_json::Value::Object(serde_json::Map::new());
    }
    let (Some(target_object), Some(legacy_object)) = (target.as_object_mut(), legacy.as_object())
    else {
        return;
    };
    for (key, legacy_value) in legacy_object {
        target_object
            .entry(key.clone())
            .or_insert_with(|| legacy_value.clone());
    }
}

fn migrate_legacy_env_secret(
    aws_vm: &mut serde_json::Map<String, serde_json::Value>,
    legacy_env_field: &str,
    secret_field: &str,
) {
    let legacy_env = aws_vm
        .remove(legacy_env_field)
        .and_then(|value| value.as_str().map(str::to_owned));
    let should_fill = aws_vm
        .get(secret_field)
        .and_then(|value| value.as_str())
        .is_none_or(str::is_empty);
    if should_fill {
        let secret = legacy_env
            .as_deref()
            .and_then(|name| env::var(name).ok())
            .unwrap_or_default();
        aws_vm.insert(secret_field.into(), serde_json::Value::String(secret));
    }
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
