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
fn disabled_aws_vm_plugin_does_not_validate_incomplete_operational_settings() {
    let mut s = default_settings();
    s.plugins.targets.aws_vm.enabled = false;
    s.plugins.targets.aws_vm.bastion_port = 0;
    s.plugins.targets.aws_vm.bastion_password_mode = "invalid".into();
    s.plugins.targets.aws_vm.target_groups[0].enabled = true;
    s.plugins.targets.aws_vm.target_groups[0].modules.clear();

    assert!(validate_settings(&s).is_empty());
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
