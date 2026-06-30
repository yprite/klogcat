use super::vm_username::{validate_bastion_username, validate_vm_username};
use crate::error::CommandError;
use crate::settings::{AwsVmTargetPluginSettings, TargetPluginSettings};
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::{
    io::Read,
    net::{IpAddr, Ipv4Addr},
    process::{Command, Output},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
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
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ListVmTargetsResponse {
    pub targets: Vec<VmTargetInfo>,
}

#[tauri::command]
pub async fn list_vm_targets(
    request: ListVmTargetsRequest,
) -> Result<ListVmTargetsResponse, CommandError> {
    let plugin = request.plugin.aws_vm;
    validate_plugin_enabled(&plugin)?;
    validate_aws_vm_plugin(&plugin)?;
    let command = bastion_shell_command(&plugin, &plugin.consul_catalog_command)?;
    let output = run_shell_with_timeout(&command, Duration::from_secs(20))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        return Err(
            CommandError::new("vm_discovery_failed", "failed to discover VM targets")
                .with_details(stderr),
        );
    }
    Ok(ListVmTargetsResponse {
        targets: parse_vm_targets(&stdout)?,
    })
}

pub fn validate_plugin_enabled(plugin: &AwsVmTargetPluginSettings) -> Result<(), CommandError> {
    if !plugin.enabled {
        return Err(CommandError::new(
            "vm_plugin_disabled",
            "AWS VM target plugin is disabled",
        ));
    }
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

fn run_shell_with_timeout(command: &str, timeout: Duration) -> Result<Output, CommandError> {
    let mut child = spawn_shell_child(command)?;
    let pid = child.id();
    let stdout_rx = read_child_pipe(child.stdout.take(), "stdout")?;
    let stderr_rx = read_child_pipe(child.stderr.take(), "stderr")?;
    wait_for_shell_child(
        &mut child,
        pid,
        stdout_rx,
        stderr_rx,
        Instant::now() + timeout,
    )
}

fn spawn_shell_child(command: &str) -> Result<std::process::Child, CommandError> {
    let mut child_command = Command::new("sh");
    child_command
        .arg("-lc")
        .arg(command)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(unix)]
    {
        child_command.process_group(0);
    }
    child_command.spawn().map_err(|e| {
        CommandError::new(
            "vm_discovery_spawn_failed",
            "failed to spawn VM discovery command",
        )
        .with_details(e.to_string())
    })
}

fn read_child_pipe<T: Read + Send + 'static>(
    pipe: Option<T>,
    name: &str,
) -> Result<mpsc::Receiver<std::io::Result<Vec<u8>>>, CommandError> {
    let pipe = pipe.ok_or_else(|| {
        CommandError::new(
            "vm_discovery_failed",
            format!("failed to capture VM discovery {name}"),
        )
    })?;
    Ok(read_pipe(pipe))
}

fn wait_for_shell_child(
    child: &mut std::process::Child,
    pid: u32,
    stdout_rx: mpsc::Receiver<std::io::Result<Vec<u8>>>,
    stderr_rx: mpsc::Receiver<std::io::Result<Vec<u8>>>,
    deadline: Instant,
) -> Result<Output, CommandError> {
    loop {
        if let Some(status) = try_shell_child_status(child, pid)? {
            return collect_shell_output(status, stdout_rx, stderr_rx);
        }
        if Instant::now() >= deadline {
            return timeout_shell_child(child, pid);
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn try_shell_child_status(
    child: &mut std::process::Child,
    pid: u32,
) -> Result<Option<std::process::ExitStatus>, CommandError> {
    child.try_wait().map_err(|e| {
        kill_process_group(pid);
        let _ = child.kill();
        CommandError::new(
            "vm_discovery_failed",
            "failed to wait for VM discovery command",
        )
        .with_details(e.to_string())
    })
}

fn collect_shell_output(
    status: std::process::ExitStatus,
    stdout_rx: mpsc::Receiver<std::io::Result<Vec<u8>>>,
    stderr_rx: mpsc::Receiver<std::io::Result<Vec<u8>>>,
) -> Result<Output, CommandError> {
    Ok(Output {
        status,
        stdout: collect_pipe(stdout_rx, "stdout")?,
        stderr: collect_pipe(stderr_rx, "stderr")?,
    })
}

fn timeout_shell_child(child: &mut std::process::Child, pid: u32) -> Result<Output, CommandError> {
    kill_process_group(pid);
    let _ = child.kill();
    let _ = child.wait();
    Err(
        CommandError::new("vm_discovery_timeout", "VM discovery timed out")
            .with_details("Timed out while running Consul catalog command through bastion"),
    )
}

fn read_pipe<R: Read + Send + 'static>(mut reader: R) -> mpsc::Receiver<std::io::Result<Vec<u8>>> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut buffer = Vec::new();
        let result = reader.read_to_end(&mut buffer).map(|_| buffer);
        let _ = tx.send(result);
    });
    rx
}

fn collect_pipe(
    rx: mpsc::Receiver<std::io::Result<Vec<u8>>>,
    name: &str,
) -> Result<Vec<u8>, CommandError> {
    match rx.recv_timeout(Duration::from_secs(1)) {
        Ok(Ok(buffer)) => Ok(buffer),
        Ok(Err(e)) => Err(CommandError::new(
            "vm_discovery_failed",
            format!("failed to read VM discovery {name}"),
        )
        .with_details(e.to_string())),
        Err(e) => Err(CommandError::new(
            "vm_discovery_failed",
            format!("failed to collect VM discovery {name}"),
        )
        .with_details(e.to_string())),
    }
}

fn kill_process_group(pid: u32) {
    #[cfg(unix)]
    {
        let _ = unsafe { libc::kill(-(pid as i32), libc::SIGKILL) };
    }
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
            };
            validate_vm_target(&target).ok()?;
            Some(target)
        })
        .collect()
}

fn looks_like_address(value: &str) -> bool {
    value.parse::<IpAddr>().is_ok() || (is_safe_host(value) && value.contains('.'))
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let mut plugin = crate::settings::default_settings().target_plugins.aws_vm;
        plugin.strict_host_key_checking = false;
        let options = ssh_options(&plugin, true);
        assert!(options.contains("BatchMode=yes"));
        assert!(options.contains("ConnectTimeout=10"));
        assert!(options.contains("StrictHostKeyChecking=no"));
    }

    #[test]
    fn allows_email_vm_username_but_not_bastion_username() {
        let mut plugin = crate::settings::default_settings().target_plugins.aws_vm;
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
}
