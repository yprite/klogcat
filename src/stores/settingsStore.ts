import { create } from 'zustand'
import { defaultSettings } from '../config/defaultSettings'
import { validateSettings } from '../config/validateSettings'
import { getSettings as getSettingsCommand, resetSettings as resetSettingsCommand, saveSettings as saveSettingsCommand } from '../commands/tauriSettings'
import type { CommandError } from '../commands/types'
import type { PersistedSettings, SettingsWarning } from '../types/settings'
import { useLogStore } from './logStore'

type SettingsState = { settings?: PersistedSettings; warning?: SettingsWarning; loading: boolean; error?: CommandError; loadSettings(): Promise<void>; saveSettings(next: PersistedSettings): Promise<void>; resetSettings(): Promise<void> }
export const useSettingsStore = create<SettingsState>((set) => ({
  settings: defaultSettings,
  loading: false,
  async loadSettings() {
    set({ loading: true, error: undefined })
    try { const res = await getSettingsCommand(); useLogStore.getState().setBufferLimit(res.settings.bufferLimit); set({ settings: res.settings, warning: res.warning, loading: false }) }
    catch (e) { set({ error: e as CommandError, loading: false }) }
  },
  async saveSettings(next) {
    const errors = validateSettings(next)
    if (errors.length) { set({ error: { code: 'settings_validation_failed', message: 'Settings validation failed', validationErrors: errors } }); return }
    set({ loading: true, error: undefined })
    try { const saved = await saveSettingsCommand(next); useLogStore.getState().setBufferLimit(saved.bufferLimit); set({ settings: saved, loading: false, warning: undefined }) }
    catch (e) { set({ error: e as CommandError, loading: false }) }
  },
  async resetSettings() {
    set({ loading: true, error: undefined })
    try { const saved = await resetSettingsCommand(); useLogStore.getState().setBufferLimit(saved.bufferLimit); set({ settings: saved, loading: false, warning: undefined }) }
    catch (e) { set({ error: e as CommandError, loading: false }) }
  },
}))
