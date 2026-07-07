import type { PersistedSettings } from '../types/settings'
import { defaultAwsVmTargetPluginSettings } from '../plugins/awsVmTargetPlugin'
import { defaultCsvFileTargetPluginSettings } from '../plugins/csvFileTargetPlugin'
import { defaultColorTheme } from '../utils/colorTheme'
import { defaultFontSize } from '../utils/fontScale'
import { defaultLogSourcesFromPolicy, getLogPolicy } from '../utils/logPolicy'
import { defaultViewerPluginSettings } from '../plugins/viewerPluginRegistry'

export const defaultSettings: PersistedSettings = {
  schemaVersion: 1,
  language: 'en',
  colorTheme: defaultColorTheme,
  menuFontSize: defaultFontSize,
  logViewerFontSize: defaultFontSize,
  initialTailLines: 200,
  bufferLimit: 50_000,
  logSources: defaultLogSourcesFromPolicy(getLogPolicy()),
  shortcuts: {
    openSettings: 'Meta+,',
    openTargetPicker: 'Meta+K',
    toggleStream: 'Meta+Enter',
    restartStream: 'Meta+Shift+Enter',
  },
  logPolicyId: 'scloud',
  logPolicy: getLogPolicy(),
  plugins: {
    targets: {
      awsVm: defaultAwsVmTargetPluginSettings,
      csvFile: defaultCsvFileTargetPluginSettings,
    },
    viewers: defaultViewerPluginSettings,
  },
}
