use crate::error::CommandError;
use crate::settings::{self, GetSettingsResponse, PersistedSettings};

#[tauri::command]
pub async fn get_settings(app: tauri::AppHandle) -> Result<GetSettingsResponse, CommandError> {
    settings::load(&app)
}
#[tauri::command]
pub async fn save_settings(
    app: tauri::AppHandle,
    settings: PersistedSettings,
) -> Result<PersistedSettings, CommandError> {
    settings::save(&app, settings)
}
#[tauri::command]
pub async fn reset_settings(app: tauri::AppHandle) -> Result<PersistedSettings, CommandError> {
    settings::reset(&app)
}
