use crate::error::CommandError;
use crate::settings::{AwsVmTargetPluginSettings, TargetPluginSettings};
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::{
    io::Read,
    net::{IpAddr, Ipv4Addr},
    process::{Child, Command, Output},
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
        ("bastionPasswordEnv", &plugin.bastion_password_env),
        ("vmUsername", &plugin.vm_username),
        ("vmPasswordEnv", &plugin.vm_password_env),
    ] {
        if value.trim().is_empty() {
            return Err(CommandError::new(
                "vm_plugin_config_invalid",
                format!("{field} is required"),
            ));
        }
    }
    validate_ssh_username("bastionUsername", &plugin.bastion_username)?;
    validate_ssh_username("vmUsername", &plugin.vm_username)?;
    Ok(())
}

pub fn validate_aws_vm_plugin(plugin: &AwsVmTargetPluginSettings) -> Result<(), CommandError> {
    validate_bastion_port(plugin)?;
    validate_bastion_password_mode(plugin)?;
    validate_plugin_env_names(plugin)?;
    validate_consul_catalog_command(plugin)?;
    validate_plugin_usernames(plugin)
}

fn validate_bastion_port(plugin: &AwsVmTargetPluginSettings) -> Result<(), CommandError> {
    if plugin.bastion_port == 0 {
        return Err(CommandError::new(
            "vm_plugin_config_invalid",
            "bastionPort must be 1..65535",
        ));
    }
    Ok(())
}

fn validate_bastion_password_mode(plugin: &AwsVmTargetPluginSettings) -> Result<(), CommandError> {
    if matches!(
        plugin.bastion_password_mode.as_str(),
        "password" | "password-plus-totp"
    ) {
        return Ok(());
    }
    Err(CommandError::new(
        "vm_plugin_config_invalid",
        "bastionPasswordMode must be password or password-plus-totp",
    ))
}

fn validate_plugin_env_names(plugin: &AwsVmTargetPluginSettings) -> Result<(), CommandError> {
    validate_env_name(&plugin.bastion_password_env)?;
    validate_env_name(&plugin.vm_password_env)?;
    if let Some(secret_env) = non_empty_totp_secret_env(plugin) {
        validate_env_name(secret_env)?;
    }
    Ok(())
}

fn validate_consul_catalog_command(plugin: &AwsVmTargetPluginSettings) -> Result<(), CommandError> {
    if plugin.consul_catalog_command.trim().is_empty() {
        return Err(CommandError::new(
            "vm_plugin_config_invalid",
            "consulCatalogCommand is required",
        ));
    }
    Ok(())
}

fn validate_plugin_usernames(plugin: &AwsVmTargetPluginSettings) -> Result<(), CommandError> {
    validate_ssh_username("bastionUsername", &plugin.bastion_username)?;
    validate_ssh_username("vmUsername", &plugin.vm_username)
}

fn non_empty_totp_secret_env(plugin: &AwsVmTargetPluginSettings) -> Option<&str> {
    plugin
        .bastion_totp_secret_env
        .as_deref()
        .filter(|value| !value.trim().is_empty())
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

pub fn password_shell_expr(env_name: &str) -> Result<String, CommandError> {
    validate_env_name(env_name)?;
    Ok(format!("${{{env_name}:?missing {env_name}}}"))
}

pub fn bastion_password_shell_expr(
    plugin: &AwsVmTargetPluginSettings,
) -> Result<String, CommandError> {
    let password = password_shell_expr(&plugin.bastion_password_env)?;
    if plugin.bastion_password_mode != "password-plus-totp" {
        return Ok(password);
    }
    let Some(secret_env) = plugin
        .bastion_totp_secret_env
        .as_deref()
        .filter(|v| !v.trim().is_empty())
    else {
        return Err(CommandError::new(
            "vm_plugin_config_invalid",
            "bastionTotpSecretEnv is required for password-plus-totp mode",
        ));
    };
    validate_env_name(secret_env)?;
    Ok(format!(
        "{password}$(oathtool --totp -b \"${{{secret_env}:?missing {secret_env}}}\")"
    ))
}

pub fn bastion_sshpass_password_setup(
    plugin: &AwsVmTargetPluginSettings,
) -> Result<String, CommandError> {
    validate_env_name(&plugin.bastion_password_env)?;
    if plugin.bastion_password_mode != "password-plus-totp" {
        return Ok(format!(
            "SSHPASS=\"${{{}:?missing {}}}\"",
            plugin.bastion_password_env, plugin.bastion_password_env
        ));
    }
    let Some(secret_env) = plugin
        .bastion_totp_secret_env
        .as_deref()
        .filter(|v| !v.trim().is_empty())
    else {
        return Err(CommandError::new(
            "vm_plugin_config_invalid",
            "bastionTotpSecretEnv is required for password-plus-totp mode",
        ));
    };
    validate_env_name(secret_env)?;
    Ok(format!(
        "otp=$(oathtool --totp -b \"${{{secret_env}:?missing {secret_env}}}\") || exit 64; SSHPASS=\"${{{}:?missing {}}}${{otp}}\"",
        plugin.bastion_password_env, plugin.bastion_password_env
    ))
}

pub fn bastion_password_ready_shell_condition(
    plugin: &AwsVmTargetPluginSettings,
) -> Result<String, CommandError> {
    validate_env_name(&plugin.bastion_password_env)?;
    if plugin.bastion_password_mode != "password-plus-totp" {
        return Ok(format!("[ -n \"${{{}:-}}\" ]", plugin.bastion_password_env));
    }
    let Some(secret_env) = plugin
        .bastion_totp_secret_env
        .as_deref()
        .filter(|v| !v.trim().is_empty())
    else {
        return Err(CommandError::new(
            "vm_plugin_config_invalid",
            "bastionTotpSecretEnv is required for password-plus-totp mode",
        ));
    };
    validate_env_name(secret_env)?;
    Ok(format!(
        "[ -n \"${{{}:-}}\" ] && [ -n \"${{{secret_env}:-}}\" ] && command -v oathtool >/dev/null 2>&1",
        plugin.bastion_password_env
    ))
}

fn validate_env_name(name: &str) -> Result<(), CommandError> {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return Err(invalid_env_name(name));
    };
    if !(first == '_' || first.is_ascii_alphabetic())
        || !chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
    {
        return Err(invalid_env_name(name));
    }
    Ok(())
}

fn validate_ssh_username(field: &str, value: &str) -> Result<(), CommandError> {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return Err(invalid_ssh_username(field));
    };
    if !(first.is_ascii_alphanumeric() || first == '.' || first == '_')
        || value.len() > 64
        || value.contains('@')
        || !chars.all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
    {
        return Err(invalid_ssh_username(field));
    }
    Ok(())
}

fn invalid_ssh_username(field: &str) -> CommandError {
    CommandError::new(
        "vm_plugin_config_invalid",
        format!("{field} must be a safe SSH username"),
    )
}

fn invalid_env_name(name: &str) -> CommandError {
    CommandError::new(
        "vm_plugin_config_invalid",
        format!("invalid environment variable name: {name}"),
    )
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
    let mut child = spawn_shell(command)?;
    let pid = child.id();
    let pipes = capture_child_pipes(&mut child)?;
    let deadline = Instant::now() + timeout;
    wait_for_shell(child, pid, pipes, deadline)
}

struct ShellPipes {
    stdout: mpsc::Receiver<std::io::Result<Vec<u8>>>,
    stderr: mpsc::Receiver<std::io::Result<Vec<u8>>>,
}

fn spawn_shell(command: &str) -> Result<Child, CommandError> {
    let mut child_command = Command::new("sh");
    child_command
        .arg("-lc")
        .arg(command)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(unix)]
    child_command.process_group(0);
    child_command.spawn().map_err(|e| {
        CommandError::new(
            "vm_discovery_spawn_failed",
            "failed to spawn VM discovery command",
        )
        .with_details(e.to_string())
    })
}

fn capture_child_pipes(child: &mut Child) -> Result<ShellPipes, CommandError> {
    let stdout = child.stdout.take().ok_or_else(|| capture_error("stdout"))?;
    let stderr = child.stderr.take().ok_or_else(|| capture_error("stderr"))?;
    Ok(ShellPipes {
        stdout: read_pipe(stdout),
        stderr: read_pipe(stderr),
    })
}

fn wait_for_shell(
    mut child: Child,
    pid: u32,
    pipes: ShellPipes,
    deadline: Instant,
) -> Result<Output, CommandError> {
    loop {
        let output = try_collect_finished_shell(&mut child, &pipes).map_err(|error| {
            kill_process_group(pid);
            let _ = child.kill();
            error
        })?;
        if let Some(output) = output {
            return Ok(output);
        }
        if Instant::now() >= deadline {
            return Err(stop_timed_out_shell(&mut child, pid));
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn try_collect_finished_shell(
    child: &mut Child,
    pipes: &ShellPipes,
) -> Result<Option<Output>, CommandError> {
    let status = match child.try_wait().map_err(wait_error)? {
        Some(status) => status,
        None => return Ok(None),
    };
    Ok(Some(Output {
        status,
        stdout: collect_pipe(&pipes.stdout, "stdout")?,
        stderr: collect_pipe(&pipes.stderr, "stderr")?,
    }))
}

fn stop_timed_out_shell(child: &mut Child, pid: u32) -> CommandError {
    kill_process_group(pid);
    let _ = child.kill();
    let _ = child.wait();
    CommandError::new("vm_discovery_timeout", "VM discovery timed out")
        .with_details("Timed out while running Consul catalog command through bastion")
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
    rx: &mpsc::Receiver<std::io::Result<Vec<u8>>>,
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

fn capture_error(name: &str) -> CommandError {
    CommandError::new(
        "vm_discovery_failed",
        format!("failed to capture VM discovery {name}"),
    )
}

fn wait_error(error: std::io::Error) -> CommandError {
    CommandError::new(
        "vm_discovery_failed",
        "failed to wait for VM discovery command",
    )
    .with_details(error.to_string())
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
    !address.is_loopback()
        && !address.is_link_local()
        && !address.is_unspecified()
        && !address.is_multicast()
        && address != Ipv4Addr::BROADCAST
}

fn is_allowed_ipv6(address: std::net::Ipv6Addr) -> bool {
    !address.is_loopback()
        && !address.is_unicast_link_local()
        && !address.is_unspecified()
        && !address.is_multicast()
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
    fn validates_env_names_and_ssh_options() {
        assert!(password_shell_expr("KLOGCAT_VM_PASSWORD").is_ok());
        assert!(password_shell_expr("bad-name").is_err());
        let mut plugin = crate::settings::default_settings().target_plugins.aws_vm;
        plugin.strict_host_key_checking = false;
        let options = ssh_options(&plugin, true);
        assert!(options.contains("BatchMode=yes"));
        assert!(options.contains("ConnectTimeout=10"));
        assert!(options.contains("StrictHostKeyChecking=no"));
    }
}
