import { invoke } from '@tauri-apps/api/core'
import type { GetSettingsResponse, PersistedSettings } from '../types/settings'
export const getSettings = () => invoke<GetSettingsResponse>('get_settings')
export const saveSettings = (settings: PersistedSettings) => invoke<PersistedSettings>('save_settings', { settings })
export const resetSettings = () => invoke<PersistedSettings>('reset_settings')
