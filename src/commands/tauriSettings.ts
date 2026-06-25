import { invoke, isTauri } from '@tauri-apps/api/core'
import { defaultSettings } from '../config/defaultSettings'
import type { GetSettingsResponse, PersistedSettings } from '../types/settings'

export const getSettings = (): Promise<GetSettingsResponse> => isTauri()
  ? invoke<GetSettingsResponse>('get_settings')
  : Promise.resolve({ settings: defaultSettings })
export const saveSettings = (settings: PersistedSettings) => isTauri()
  ? invoke<PersistedSettings>('save_settings', { settings })
  : Promise.resolve(settings)
export const resetSettings = () => isTauri()
  ? invoke<PersistedSettings>('reset_settings')
  : Promise.resolve(defaultSettings)
