pub mod commands;
pub mod error;
pub mod process;
pub mod settings;

use tauri::Manager;

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
            commands::logs::stop_log_stream,
            commands::logs::stop_all_log_streams,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app.try_state::<process::log_process::LogProcessState>() {
                    state.stop_all_blocking();
                }
            }
        });
}
