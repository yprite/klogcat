use super::*;
use std::{collections::BTreeMap, env, fs};

#[test]
fn validates_aws_vm_target_groups_as_effective_profiles() {
    let mut s = default_settings();
    s.plugins.targets.aws_vm.enabled = true;
    s.plugins.targets.aws_vm.bastion_username = "ops".into();
    s.plugins.targets.aws_vm.bastion_password = "bastion-password".into();
    s.plugins.targets.aws_vm.vm_username = "operator@example.com".into();
    s.plugins.targets.aws_vm.vm_password = "vm-password".into();
    s.plugins.targets.aws_vm.target_groups = vec![AwsVmTargetGroupSettings {
        id: "prod".into(),
        name: "Prod".into(),
        enabled: true,
        bastion_host: Some("bastion-prod.example.com".into()),
        bastion_port: None,
        bastion_username: None,
        bastion_password: None,
        bastion_totp_secret: None,
        bastion_password_mode: None,
        vm_username: None,
        vm_password: None,
        consul_catalog_command: None,
        strict_host_key_checking: None,
        log_paths: BTreeMap::new(),
        modules: vec![AwsVmTargetModuleSettings {
            id: "api".into(),
            name: "API".into(),
            consul_catalog_command: Some("consul catalog nodes -service api -format=json".into()),
            log_paths: BTreeMap::new(),
        }],
    }];

    assert!(validate_settings(&s).is_empty());

    s.plugins.targets.aws_vm.target_groups[0].bastion_host = Some(String::new());
    assert!(validate_settings(&s)
        .iter()
        .any(|error| error.field == "plugins.targets.awsVm.targetGroups.0.modules.0.bastionHost"));
}

#[test]
fn encrypts_aws_vm_group_secrets_on_disk_and_decrypts_on_load() {
    let dir = env::temp_dir().join(format!(
        "klogcat-settings-group-secret-test-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("settings.json");
    let mut s = default_settings();
    s.plugins.targets.aws_vm.target_groups = vec![AwsVmTargetGroupSettings {
        id: "prod".into(),
        name: "Prod".into(),
        enabled: true,
        bastion_host: None,
        bastion_port: None,
        bastion_username: None,
        bastion_password: Some("group-bastion-password".into()),
        bastion_totp_secret: Some("group-totp-secret".into()),
        bastion_password_mode: None,
        vm_username: None,
        vm_password: Some("group-vm-password".into()),
        consul_catalog_command: None,
        strict_host_key_checking: None,
        log_paths: BTreeMap::new(),
        modules: vec![AwsVmTargetModuleSettings {
            id: "api".into(),
            name: "API".into(),
            consul_catalog_command: None,
            log_paths: BTreeMap::new(),
        }],
    }];

    save_to_path(path.clone(), s).unwrap();
    let text = fs::read_to_string(&path).unwrap();
    assert!(!text.contains("group-bastion-password"));
    assert!(!text.contains("group-totp-secret"));
    assert!(!text.contains("group-vm-password"));

    let loaded = load_from_path(path.clone()).unwrap().settings;
    let loaded_group = &loaded.plugins.targets.aws_vm.target_groups[0];
    assert_eq!(
        loaded_group.bastion_password.as_deref(),
        Some("group-bastion-password")
    );
    assert_eq!(
        loaded_group.bastion_totp_secret.as_deref(),
        Some("group-totp-secret")
    );
    assert_eq!(
        loaded_group.vm_password.as_deref(),
        Some("group-vm-password")
    );
    let _ = fs::remove_dir_all(&dir);
}
