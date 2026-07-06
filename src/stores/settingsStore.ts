import { create } from 'zustand'
import { defaultSettings } from '../config/defaultSettings'
import { validateSettings } from '../config/validateSettings'
import { getSettings as getSettingsCommand, resetSettings as resetSettingsCommand, saveSettings as saveSettingsCommand } from '../commands/tauriSettings'
import type { CommandError } from '../commands/types'
import type { PersistedSettings, SettingsWarning } from '../types/settings'
import type { TargetPluginSettings } from '../types/vm'
import { defaultAwsVmTargetPluginSettings } from '../plugins/awsVmTargetPlugin'
import { defaultCsvFileTargetPluginSettings } from '../plugins/csvFileTargetPlugin'
import { applyColorTheme, defaultColorTheme, isColorThemeId } from '../utils/colorTheme'
import { assertValidLogPolicy, getLogPolicy, setActiveLogPolicy } from '../utils/logPolicy'
import { useLogStore } from './logStore'

type LegacySettingsShape = Omit<PersistedSettings, 'plugins'> & {
  targetPlugins?: TargetPluginSettings
  plugins?: Partial<PersistedSettings['plugins']>
}

function withActiveLogPolicy(settings: PersistedSettings): PersistedSettings {
  const legacySettings = settings as LegacySettingsShape
  const { targetPlugins: _legacyTargetPlugins, ...settingsWithoutLegacyTargetPlugins } = legacySettings
  const defaultNamespace = typeof settings.defaultNamespace === 'string' && settings.defaultNamespace.trim() ? settings.defaultNamespace.trim() : undefined
  const targetPluginPatch = (legacySettings.plugins?.targets ?? legacySettings.targetPlugins ?? {}) as Partial<TargetPluginSettings>
  const { bastionTotpProfile: _legacyTotpProfile, streamCommandTemplate: _legacyStreamTemplate, bastionPasswordEnv: _legacyBastionPasswordEnv, bastionTotpSecretEnv: _legacyBastionTotpSecretEnv, vmPasswordEnv: _legacyVmPasswordEnv, ...awsVmPatch } = (targetPluginPatch.awsVm ?? {}) as PersistedSettings['plugins']['targets']['awsVm'] & { bastionTotpProfile?: string; streamCommandTemplate?: string; bastionPasswordEnv?: string; bastionTotpSecretEnv?: string; vmPasswordEnv?: string }
  const targetGroups = Array.isArray(awsVmPatch.targetGroups) ? awsVmPatch.targetGroups : defaultAwsVmTargetPluginSettings.targetGroups
  const awsVm = { ...defaultAwsVmTargetPluginSettings, ...awsVmPatch, logPaths: { ...defaultAwsVmTargetPluginSettings.logPaths, ...(awsVmPatch.logPaths ?? {}) }, targetGroups }
  const csvFile = { ...defaultCsvFileTargetPluginSettings, ...(targetPluginPatch.csvFile ?? {}) }
  return {
    ...settingsWithoutLegacyTargetPlugins,
    defaultNamespace,
    language: settings.language ?? 'en',
    colorTheme: isColorThemeId(settings.colorTheme) ? settings.colorTheme : defaultColorTheme,
    shortcuts: settings.shortcuts ?? defaultSettings.shortcuts,
    logPolicyId: settings.logPolicyId ?? 'scloud',
    logPolicy: settings.logPolicy ?? getLogPolicy(),
    plugins: {
      ...defaultSettings.plugins,
      ...(legacySettings.plugins ?? {}),
      targets: { ...defaultSettings.plugins.targets, ...targetPluginPatch, awsVm, csvFile },
    },
  }
}

function applySettingsLogPolicy(settings: PersistedSettings) {
  if (!settings.logPolicy) return
  assertValidLogPolicy(settings.logPolicy)
  setActiveLogPolicy(settings.logPolicy)
}

function applyRuntimeSettings(settings: PersistedSettings) {
  applySettingsLogPolicy(settings)
  applyColorTheme(settings.colorTheme)
}

type SettingsState = { settings?: PersistedSettings; warning?: SettingsWarning; loading: boolean; error?: CommandError; loadSettings(): Promise<void>; saveSettings(next: PersistedSettings): Promise<boolean>; resetSettings(): Promise<boolean> }
export const useSettingsStore = create<SettingsState>((set) => ({
  settings: defaultSettings,
  loading: false,
  async loadSettings() {
    set({ loading: true, error: undefined })
    try { const res = await getSettingsCommand(); const settings = withActiveLogPolicy(res.settings); applyRuntimeSettings(settings); useLogStore.getState().setBufferLimit(settings.bufferLimit); set({ settings, warning: res.warning, loading: false }) }
    catch (e) { set({ error: e as CommandError, loading: false }) }
  },
  async saveSettings(next) {
    const settings = withActiveLogPolicy(next)
    const errors = validateSettings(settings)
    if (errors.length) { set({ error: { code: 'settings_validation_failed', message: 'Settings validation failed', validationErrors: errors } }); return false }
    set({ loading: true, error: undefined })
    try { const saved = withActiveLogPolicy(await saveSettingsCommand(settings)); applyRuntimeSettings(saved); useLogStore.getState().setBufferLimit(saved.bufferLimit); set({ settings: saved, loading: false, warning: undefined }); return true }
    catch (e) { set({ error: e as CommandError, loading: false }); return false }
  },
  async resetSettings() {
    set({ loading: true, error: undefined })
    try { const saved = withActiveLogPolicy(await resetSettingsCommand()); applyRuntimeSettings(saved); useLogStore.getState().setBufferLimit(saved.bufferLimit); set({ settings: saved, loading: false, warning: undefined }); return true }
    catch (e) { set({ error: e as CommandError, loading: false }); return false }
  },
}))
