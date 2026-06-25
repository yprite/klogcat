use crate::error::CommandError;
use crate::process::log_process::{LogProcessState, StartLogStreamRequest};
use serde::{Deserialize, Serialize};
use std::process::Command;

#[tauri::command]
pub async fn start_log_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, LogProcessState>,
    request: StartLogStreamRequest,
) -> Result<(), CommandError> {
    state.start(app, request)
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CheckLogPathRequest {
    pub context: Option<String>,
    pub namespace: String,
    pub pod: String,
    pub container: String,
    pub source_type: String,
    pub file_path: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CheckLogPathResult {
    pub exists: bool,
    pub message: Option<String>,
}

fn build_check_log_path_args(request: &CheckLogPathRequest) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(context) = request.context.as_deref().filter(|c| !c.trim().is_empty()) {
        args.push("--context".to_string());
        args.push(context.to_string());
    }
    args.extend([
        "exec".to_string(),
        "-n".to_string(),
        request.namespace.clone(),
        request.pod.clone(),
        "-c".to_string(),
        request.container.clone(),
        "--".to_string(),
        "test".to_string(),
        "-f".to_string(),
        request.file_path.clone(),
    ]);
    args
}

#[tauri::command]
pub async fn check_log_path(request: CheckLogPathRequest) -> Result<CheckLogPathResult, CommandError> {
    if request.namespace.trim().is_empty()
        || request.pod.trim().is_empty()
        || request.container.trim().is_empty()
        || request.file_path.trim().is_empty()
    {
        return Err(CommandError::new("path_check_invalid_request", "namespace, pod, container, and filePath are required"));
    }
    let output = Command::new("kubectl")
        .args(build_check_log_path_args(&request))
        .output()
        .map_err(|e| CommandError::new("path_check_spawn_failed", "failed to spawn kubectl exec test").with_details(e.to_string()))?;
    if output.status.success() {
        Ok(CheckLogPathResult { exists: true, message: Some("OK".to_string()) })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Ok(CheckLogPathResult { exists: false, message: Some(if stderr.is_empty() { format!("{} not found", request.source_type) } else { stderr }) })
    }
}

#[tauri::command]
pub async fn stop_log_stream(
    state: tauri::State<'_, LogProcessState>,
    stream_id: String,
) -> Result<(), CommandError> {
    state.stop(&stream_id)
}
#[tauri::command]
pub async fn stop_all_log_streams(
    state: tauri::State<'_, LogProcessState>,
) -> Result<(), CommandError> {
    state.stop_all_blocking();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_log_path_uses_kubectl_exec_test_file_without_shell() {
        let args = build_check_log_path_args(&CheckLogPathRequest {
            context: Some("ctx".to_string()),
            namespace: "ns".to_string(),
            pod: "pod".to_string(),
            container: "app".to_string(),
            source_type: "info".to_string(),
            file_path: "/var/log/app.log".to_string(),
        });
        assert_eq!(args, vec!["--context", "ctx", "exec", "-n", "ns", "pod", "-c", "app", "--", "test", "-f", "/var/log/app.log"]);
    }
}
