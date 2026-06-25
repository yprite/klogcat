pub mod commands;
pub mod error;
pub mod process;
pub mod settings;

use tauri::{Manager, WindowEvent};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AppLifecycleEvent {
    ExitRequested,
    MainWindowCloseRequested,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShutdownRequest {
    None,
    StopStreams,
    StopStreamsAndExit,
}

fn shutdown_request_for_lifecycle_event(event: AppLifecycleEvent) -> ShutdownRequest {
    match event {
        AppLifecycleEvent::ExitRequested => ShutdownRequest::StopStreams,
        AppLifecycleEvent::MainWindowCloseRequested => ShutdownRequest::StopStreamsAndExit,
        AppLifecycleEvent::Other => ShutdownRequest::None,
    }
}

fn stop_all_log_streams<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(state) = app.try_state::<process::log_process::LogProcessState>() {
        state.stop_all_blocking();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(process::log_process::LogProcessState::default())
        .invoke_handler(tauri::generate_handler![
            commands::kube::get_current_context,
            commands::kube::list_contexts,
            commands::kube::list_namespaces,
            commands::kube::list_pods,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::reset_settings,
            commands::logs::start_log_stream,
            commands::logs::check_log_path,
            commands::logs::stop_log_stream,
            commands::logs::stop_all_log_streams,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            let shutdown = match event {
                tauri::RunEvent::ExitRequested { .. } => {
                    shutdown_request_for_lifecycle_event(AppLifecycleEvent::ExitRequested)
                }
                tauri::RunEvent::WindowEvent {
                    label,
                    event: WindowEvent::CloseRequested { .. },
                    ..
                } if label == "main" => shutdown_request_for_lifecycle_event(
                    AppLifecycleEvent::MainWindowCloseRequested,
                ),
                _ => shutdown_request_for_lifecycle_event(AppLifecycleEvent::Other),
            };
            match shutdown {
                ShutdownRequest::None => {}
                ShutdownRequest::StopStreams => stop_all_log_streams(app),
                ShutdownRequest::StopStreamsAndExit => {
                    stop_all_log_streams(app);
                    app.exit(0);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn main_window_close_stops_streams_and_exits_app() {
        assert_eq!(
            shutdown_request_for_lifecycle_event(AppLifecycleEvent::MainWindowCloseRequested),
            ShutdownRequest::StopStreamsAndExit
        );
    }
}
