use super::{
    vm_diagnostics::{append_diagnostics, profile_label, redact_command},
    vm_process::run_shell_with_timeout,
    vm_target_groups::{annotate_vm_target, discovery_error_details, effective_vm_profiles},
    vm_username::{validate_bastion_username, validate_vm_username},
};
use crate::error::CommandError;
use crate::settings::{AwsVmTargetPluginSettings, TargetPluginSettings};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    net::{IpAddr, Ipv4Addr},
    time::Duration,
};

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ListVmTargetsRequest {
    pub plugin: TargetPluginSettings,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VmTargetInfo {
    pub id: String,
    pub name: String,
    pub address: String,
    pub service: Option<String>,
    pub datacenter: Option<String>,
    pub tags: Option<Vec<String>>,
    pub bastion_id: Option<String>,
    pub bastion_name: Option<String>,
    pub module_id: Option<String>,
    pub module_name: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ListVmTargetsResponse {
    pub targets: Vec<VmTargetInfo>,
    pub diagnostics: Vec<String>,
}

#[tauri::command]
pub async fn list_vm_targets(
    request: ListVmTargetsRequest,
) -> Result<ListVmTargetsResponse, CommandError> {
    let plugin = request.plugin.aws_vm;
    validate_plugin_enabled(&plugin)?;
    let mut targets = Vec::new();
    let mut diagnostics = Vec::new();
    for profile in effective_vm_profiles(&plugin) {
        diagnostics.push(format!("STEP validate {}", profile_label(&profile)));
        validate_aws_vm_plugin(&profile.plugin)
            .map_err(|error| append_diagnostics(error, &diagnostics))?;
        let command =
            bastion_shell_command(&profile.plugin, &profile.plugin.consul_catalog_command)
                .map_err(|error| append_diagnostics(error, &diagnostics))?;
        diagnostics.push(format!(
            "RUN sh -lc {}",
            redact_command(&command, &profile.plugin)
        ));
        let output = run_shell_with_timeout(&command, Duration::from_secs(20))
            .map_err(|error| append_diagnostics(error, &diagnostics))?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !output.status.success() {
            diagnostics.push(format!(
                "FAIL {} exit={}",
                profile_label(&profile),
                output.status
            ));
            return Err(
                CommandError::new("vm_discovery_failed", "failed to discover VM targets")
                    .with_details(format!(
                        "{}\n{}",
                        discovery_error_details(&profile, &stderr),
                        diagnostics.join("\n")
                    )),
            );
        }
        diagnostics.push(format!(
            "OK {} exit={} stdout={} bytes stderr={} bytes",
            profile_label(&profile),
            output.status,
            output.stdout.len(),
            output.stderr.len()
        ));
        targets.extend(
            parse_vm_targets(&stdout)
                .map_err(|error| append_diagnostics(error, &diagnostics))?
                .into_iter()
                .map(|target| annotate_vm_target(target, &profile)),
        );
    }
    Ok(ListVmTargetsResponse {
        targets,
        diagnostics,
    })
}

pub fn validate_plugin_enabled(plugin: &AwsVmTargetPluginSettings) -> Result<(), CommandError> {
    if !plugin.enabled {
        return Err(CommandError::new(
            "vm_plugin_disabled",
            "AWS VM target plugin is disabled",
        ));
    }
    if !plugin.target_groups.is_empty() {
        let profiles = effective_vm_profiles(plugin);
        if profiles.is_empty() {
            return Err(CommandError::new(
                "vm_plugin_config_invalid",
                "at least one enabled VM target group is required",
            ));
        }
        for profile in profiles {
            validate_single_plugin_required_fields(&profile.plugin)?;
        }
        return Ok(());
    }
    validate_single_plugin_required_fields(plugin)
}

fn validate_single_plugin_required_fields(
    plugin: &AwsVmTargetPluginSettings,
) -> Result<(), CommandError> {
    for (field, value) in [
        ("bastionHost", &plugin.bastion_host),
        ("bastionUsername", &plugin.bastion_username),
        ("bastionPassword", &plugin.bastion_password),
        ("vmUsername", &plugin.vm_username),
        ("vmPassword", &plugin.vm_password),
    ] {
        if value.trim().is_empty() {
            return Err(CommandError::new(
                "vm_plugin_config_invalid",
                format!("{field} is required"),
            ));
        }
    }
    validate_bastion_username(&plugin.bastion_username)?;
    validate_vm_username(&plugin.vm_username)?;
    Ok(())
}

pub fn validate_aws_vm_plugin(plugin: &AwsVmTargetPluginSettings) -> Result<(), CommandError> {
    if plugin.bastion_port == 0 {
        return Err(CommandError::new(
            "vm_plugin_config_invalid",
            "bastionPort must be 1..65535",
        ));
    }
    if plugin.bastion_password_mode != "password"
        && plugin.bastion_password_mode != "password-plus-totp"
    {
        return Err(CommandError::new(
            "vm_plugin_config_invalid",
            "bastionPasswordMode must be password or password-plus-totp",
        ));
    }
    validate_secret_value("bastionPassword", &plugin.bastion_password)?;
    validate_secret_value("vmPassword", &plugin.vm_password)?;
    validate_optional_secret_value("bastionTotpSecret", plugin.bastion_totp_secret.as_deref())?;
    if plugin.consul_catalog_command.trim().is_empty() {
        return Err(CommandError::new(
            "vm_plugin_config_invalid",
            "consulCatalogCommand is required",
        ));
    }
    validate_bastion_username(&plugin.bastion_username)?;
    validate_vm_username(&plugin.vm_username)?;
    Ok(())
}

fn validate_secret_value(field: &str, value: &str) -> Result<(), CommandError> {
    if value.contains('\0') {
        return Err(CommandError::new(
            "vm_plugin_config_invalid",
            format!("{field} cannot contain null bytes"),
        ));
    }
    Ok(())
}

fn validate_optional_secret_value(field: &str, value: Option<&str>) -> Result<(), CommandError> {
    match value {
        Some(secret) => validate_secret_value(field, secret),
        None => Ok(()),
    }
}

pub fn bastion_shell_command(
    plugin: &AwsVmTargetPluginSettings,
    remote_command: &str,
) -> Result<String, CommandError> {
    validate_aws_vm_plugin(plugin)?;
    let password_setup = bastion_sshpass_password_setup(plugin)?;
    let password_ready = bastion_password_ready_shell_condition(plugin)?;
    let sshpass_command = format!(
        "{} sshpass -e ssh {} -p {} -- {}@{} {}",
        password_setup,
        ssh_options(plugin, false),
        plugin.bastion_port,
        shell_quote(&plugin.bastion_username),
        shell_quote(&plugin.bastion_host),
        shell_quote(remote_command)
    );
    let plain_command = format!(
        "ssh {} -p {} -- {}@{} {}",
        ssh_options(plugin, true),
        plugin.bastion_port,
        shell_quote(&plugin.bastion_username),
        shell_quote(&plugin.bastion_host),
        shell_quote(remote_command)
    );
    Ok(format!(
        "if command -v sshpass >/dev/null 2>&1 && {}; then {}; else {}; fi",
        password_ready, sshpass_command, plain_command
    ))
}

pub fn ssh_options(plugin: &AwsVmTargetPluginSettings, batch_mode: bool) -> String {
    let batch = if batch_mode { "yes" } else { "no" };
    let prompts = if batch_mode { "0" } else { "1" };
    let base =
        format!("-o BatchMode={batch} -o ConnectTimeout=10 -o NumberOfPasswordPrompts={prompts}");
    if plugin.strict_host_key_checking {
        base
    } else {
        format!("{base} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null")
    }
}

pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub fn password_shell_expr(password: &str) -> Result<String, CommandError> {
    if password.contains('\0') {
        return Err(CommandError::new(
            "vm_plugin_config_invalid",
            "password cannot contain null bytes",
        ));
    }
    Ok(shell_quote(password))
}

pub fn bastion_password_shell_expr(
    plugin: &AwsVmTargetPluginSettings,
) -> Result<String, CommandError> {
    let password = password_shell_expr(&plugin.bastion_password)?;
    if plugin.bastion_password_mode != "password-plus-totp" {
        return Ok(password);
    }
    let Some(secret) = plugin
        .bastion_totp_secret
        .as_deref()
        .filter(|v| !v.trim().is_empty())
    else {
        return Err(CommandError::new(
            "vm_plugin_config_invalid",
            "bastionTotpSecret is required for password-plus-totp mode",
        ));
    };
    Ok(format!(
        "{password}$(oathtool --totp -b {})",
        shell_quote(secret)
    ))
}

pub fn bastion_sshpass_password_setup(
    plugin: &AwsVmTargetPluginSettings,
) -> Result<String, CommandError> {
    if plugin.bastion_password_mode != "password-plus-totp" {
        return Ok(format!("SSHPASS={}", shell_quote(&plugin.bastion_password)));
    }
    let Some(secret) = plugin
        .bastion_totp_secret
        .as_deref()
        .filter(|v| !v.trim().is_empty())
    else {
        return Err(CommandError::new(
            "vm_plugin_config_invalid",
            "bastionTotpSecret is required for password-plus-totp mode",
        ));
    };
    Ok(format!(
        "otp=$(oathtool --totp -b {}) || exit 64; SSHPASS={}$(printf %s \"$otp\")",
        shell_quote(secret),
        shell_quote(&plugin.bastion_password)
    ))
}

pub fn bastion_password_ready_shell_condition(
    plugin: &AwsVmTargetPluginSettings,
) -> Result<String, CommandError> {
    if plugin.bastion_password_mode != "password-plus-totp" {
        return Ok(password_ready_shell_condition(&plugin.bastion_password));
    }
    let Some(secret) = plugin
        .bastion_totp_secret
        .as_deref()
        .filter(|v| !v.trim().is_empty())
    else {
        return Err(CommandError::new(
            "vm_plugin_config_invalid",
            "bastionTotpSecret is required for password-plus-totp mode",
        ));
    };
    Ok(format!(
        "{} && {} && command -v oathtool >/dev/null 2>&1",
        password_ready_shell_condition(&plugin.bastion_password),
        password_ready_shell_condition(secret)
    ))
}

pub fn password_ready_shell_condition(password: &str) -> String {
    if password.is_empty() {
        "false".into()
    } else {
        "true".into()
    }
}

pub fn validate_vm_target(target: &VmTargetInfo) -> Result<(), CommandError> {
    if !is_safe_host(&target.address) {
        return Err(CommandError::new(
            "vm_target_invalid",
            format!("invalid VM target address: {}", target.address),
        ));
    }
    Ok(())
}

fn is_safe_host(value: &str) -> bool {
    if value.is_empty() || value.len() > 253 || value.starts_with('-') {
        return false;
    }
    if let Ok(ip) = value.parse::<IpAddr>() {
        return is_allowed_vm_ip(ip);
    }
    is_safe_dns_name(value)
}

fn is_allowed_vm_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(address) => is_allowed_ipv4(address),
        IpAddr::V6(address) => is_allowed_ipv6(address),
    }
}

fn is_allowed_ipv4(address: Ipv4Addr) -> bool {
    ![
        address.is_loopback(),
        address.is_link_local(),
        address.is_unspecified(),
        address.is_multicast(),
        address == Ipv4Addr::BROADCAST,
    ]
    .into_iter()
    .any(|blocked| blocked)
}

fn is_allowed_ipv6(address: std::net::Ipv6Addr) -> bool {
    ![
        address.is_loopback(),
        address.is_unicast_link_local(),
        address.is_unspecified(),
        address.is_multicast(),
    ]
    .into_iter()
    .any(|blocked| blocked)
}

fn is_safe_dns_name(value: &str) -> bool {
    if value.ends_with('.') {
        return false;
    }
    value.split('.').all(|label| {
        let mut chars = label.chars();
        let Some(first) = chars.next() else {
            return false;
        };
        label.len() <= 63
            && first.is_ascii_alphanumeric()
            && !label.ends_with('-')
            && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
    })
}

pub fn parse_vm_targets(input: &str) -> Result<Vec<VmTargetInfo>, CommandError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    if trimmed.starts_with('[') || trimmed.starts_with('{') {
        parse_vm_targets_json(trimmed)
    } else {
        Ok(parse_vm_targets_lines(trimmed))
    }
}

fn parse_vm_targets_json(input: &str) -> Result<Vec<VmTargetInfo>, CommandError> {
    let value: Value = serde_json::from_str(input).map_err(|e| {
        CommandError::new("vm_discovery_parse_failed", "invalid VM discovery JSON")
            .with_details(e.to_string())
    })?;
    let items = if let Some(items) = value.as_array() {
        items.clone()
    } else if let Some(items) = value.get("items").and_then(Value::as_array) {
        items.clone()
    } else {
        return Err(CommandError::new(
            "vm_discovery_parse_failed",
            "VM discovery JSON must be an array or an object with array items",
        ));
    };
    Ok(items
        .iter()
        .filter_map(vm_target_from_json)
        .filter(|target| validate_vm_target(target).is_ok())
        .collect::<Vec<_>>())
}

fn vm_target_from_json(value: &Value) -> Option<VmTargetInfo> {
    let address = first_string(
        value,
        &[
            "Address",
            "address",
            "ServiceAddress",
            "serviceAddress",
            "ip",
        ],
    )?;
    let name = first_string(
        value,
        &[
            "Node",
            "node",
            "ServiceName",
            "serviceName",
            "name",
            "ID",
            "id",
        ],
    )
    .unwrap_or_else(|| address.clone());
    let id =
        first_string(value, &["ID", "id", "Node", "node", "name"]).unwrap_or_else(|| name.clone());
    let tags = value
        .get("ServiceTags")
        .or_else(|| value.get("serviceTags"))
        .or_else(|| value.get("tags"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(String::from)
                .collect()
        });
    Some(VmTargetInfo {
        id,
        name,
        address,
        service: first_string(value, &["ServiceName", "serviceName", "service"]),
        datacenter: first_string(value, &["Datacenter", "datacenter", "dc"]),
        tags,
        bastion_id: None,
        bastion_name: None,
        module_id: None,
        module_name: None,
    })
}

fn first_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|key| value.get(*key).and_then(Value::as_str))
        .find(|item| !item.trim().is_empty())
        .map(String::from)
}

fn parse_vm_targets_lines(input: &str) -> Vec<VmTargetInfo> {
    input
        .lines()
        .filter_map(|line| {
            let parts = line.split_whitespace().collect::<Vec<_>>();
            let address = parts
                .iter()
                .find(|part| looks_like_address(part))?
                .to_string();
            let name = parts.first().copied().unwrap_or(&address).to_string();
            let target = VmTargetInfo {
                id: name.clone(),
                name,
                address,
                service: parts.get(2).map(|value| value.to_string()),
                datacenter: None,
                tags: None,
                bastion_id: None,
                bastion_name: None,
                module_id: None,
                module_name: None,
            };
            validate_vm_target(&target).ok()?;
            Some(target)
        })
        .collect()
}

fn looks_like_address(value: &str) -> bool {
    value.parse::<IpAddr>().is_ok() || (is_safe_host(value) && value.contains('.'))
}
