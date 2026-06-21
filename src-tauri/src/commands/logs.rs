use crate::error::CommandError;
use crate::process::log_process::{LogProcessState, StartLogStreamRequest};

#[tauri::command]
pub async fn start_log_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, LogProcessState>,
    request: StartLogStreamRequest,
) -> Result<(), CommandError> {
    state.start(app, request)
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
