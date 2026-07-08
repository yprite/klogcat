use super::vm::*;

#[test]
fn parses_consul_node_json() {
    let targets = parse_vm_targets(r#"[{"Node":"api-1","Address":"10.0.0.7"}]"#).unwrap();
    assert_eq!(
        targets,
        vec![VmTargetInfo {
            id: "api-1".into(),
            name: "api-1".into(),
            address: "10.0.0.7".into(),
            service: None,
            datacenter: None,
            tags: None,
            bastion_id: None,
            bastion_name: None,
            module_id: None,
            module_name: None,
        }]
    );
}

#[test]
fn shell_quote_handles_single_quotes() {
    assert_eq!(shell_quote("a'b"), "'a'\\''b'");
}

#[test]
fn builds_password_shell_literals_and_ssh_options() {
    assert_eq!(password_shell_expr("p'ass").unwrap(), "'p'\\''ass'");
    assert!(password_shell_expr("bad\0secret").is_err());
    let mut plugin = crate::settings::default_settings().plugins.targets.aws_vm;
    plugin.strict_host_key_checking = false;
    let options = ssh_options(&plugin, true);
    assert!(options.contains("BatchMode=yes"));
    assert!(options.contains("ConnectTimeout=10"));
    assert!(options.contains("StrictHostKeyChecking=no"));
}

#[test]
fn bastion_command_diagnostics_print_redacted_command_lines() {
    let mut plugin = crate::settings::default_settings().plugins.targets.aws_vm;
    plugin.enabled = true;
    plugin.bastion_host = "bastion.example.com".into();
    plugin.bastion_username = "ops".into();
    plugin.bastion_password = "bastion-secret".into();
    plugin.vm_username = "app".into();
    plugin.vm_password = "vm-secret".into();
    plugin.consul_catalog_command = "consul_catalog API".into();

    let commands = bastion_shell_commands(&plugin, &plugin.consul_catalog_command).unwrap();
    let diagnostics = command_diagnostics(&plugin, &commands);
    let output = diagnostics.join("\n");

    assert!(output.contains("COMMAND remote consul_catalog API"));
    assert!(output.contains("COMMAND sshpass SSHPASS='[redacted]' ssh"));
    assert!(output.contains("COMMAND fallback ssh"));
    assert!(output.contains("RUN sh -lc"));
    assert!(!output.contains("bastion-secret"));
    assert!(!output.contains("vm-secret"));
}

#[test]
fn allows_email_vm_username_but_not_bastion_username() {
    let mut plugin = crate::settings::default_settings().plugins.targets.aws_vm;
    plugin.enabled = true;
    plugin.bastion_host = "bastion.example.com".into();
    plugin.bastion_username = "ops".into();
    plugin.bastion_password = "bastion-password".into();
    plugin.vm_username = "operator@example.com".into();
    plugin.vm_password = "vm-password".into();

    assert!(validate_aws_vm_plugin(&plugin).is_ok());

    plugin.bastion_username = "operator@example.com".into();
    assert!(validate_aws_vm_plugin(&plugin).is_err());
}
