import type { CommandError } from '../commands/types'
import { TargetPluginSettingsPanels } from '../plugins/pluginSettingsPanels'
import { ViewerPluginSettingsPanels } from '../plugins/viewerPluginSettingsPanels'
import { useKubeStore } from '../stores/kubeStore'
import type { SourceLogType } from '../types/log'
import type { PersistedSettings, SettingsValidationError } from '../types/settings'
import { colorThemeOptions, defaultColorTheme } from '../utils/colorTheme'
import { defaultFontSize, fontSizeOptions } from '../utils/fontScale'
import { t } from '../utils/i18n'
import type { LogPolicy, LogPolicySelectionId } from '../utils/logPolicy'
import { PluginInventoryPanel } from './PluginInventoryPanel'
import { AdvancedSection, LogSourceSection, MaintenanceSection, RuntimeSection, ShortcutsSection, StatusMessages, type SettingsSectionId, type TestPathResult } from './SettingsModalSections'

function AppearanceSection({ draft, language, previewColorTheme, restoreDraftColorTheme, setColorTheme, setFontSize, setLanguage }: { draft: PersistedSettings; language: PersistedSettings['language']; previewColorTheme: (value: PersistedSettings['colorTheme']) => void; restoreDraftColorTheme: () => void; setColorTheme: (value: PersistedSettings['colorTheme']) => void; setFontSize: (key: 'menuFontSize' | 'logViewerFontSize', value: PersistedSettings['menuFontSize']) => void; setLanguage: (value: PersistedSettings['language']) => void }) {
  const selectedTheme = draft.colorTheme ?? defaultColorTheme
  const selectedMenuFontSize = draft.menuFontSize ?? defaultFontSize
  const selectedLogFontSize = draft.logViewerFontSize ?? defaultFontSize
  return <section id="settings-appearance" className="rounded border border-slate-700 bg-slate-950/60 p-3">
    <h3 className="text-sm font-semibold text-white">{t(language, 'Appearance')}</h3>
    <p className="mt-1 text-xs text-slate-400">{t(language, 'Choose the UI language and VS Code color theme used by the app.')}</p>
    <label className="mt-2 block text-sm" htmlFor="settings-language">{t(language, 'Language')}</label>
    <select id="settings-language" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" value={draft.language ?? 'en'} onChange={(e) => setLanguage(e.target.value as PersistedSettings['language'])}>
      <option value="en">English / {t(language, 'English')}</option>
      <option value="ko">한국어 / {t(language, 'Korean')}</option>
    </select>
    <label className="mt-3 block text-sm" htmlFor="settings-color-theme">{t(language, 'Color theme')}</label>
    <select id="settings-color-theme" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" value={selectedTheme} onChange={(e) => setColorTheme(e.target.value as PersistedSettings['colorTheme'])}>
      {colorThemeOptions.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
    </select>
    <div className="mt-3 grid gap-2 sm:grid-cols-2" onMouseLeave={restoreDraftColorTheme}>
      {colorThemeOptions.map((theme) => {
        const selected = theme.id === selectedTheme
        return <button className={`rounded border px-2 py-1 text-left text-xs ${selected ? 'border-yellow-400 bg-yellow-400/10 text-yellow-100' : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-sky-400 hover:text-sky-100'}`} key={theme.id} onClick={() => setColorTheme(theme.id)} onFocus={() => previewColorTheme(theme.id)} onMouseEnter={() => previewColorTheme(theme.id)} type="button">
          {theme.label}
        </button>
      })}
    </div>
    <p className="mt-2 text-xs text-slate-400">{t(language, 'Themes mirror the built-in Visual Studio Code color themes.')}</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="block text-sm" htmlFor="settings-menu-font-size">{t(language, 'Menu font size')}
        <select id="settings-menu-font-size" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" value={selectedMenuFontSize} onChange={(e) => setFontSize('menuFontSize', e.target.value as PersistedSettings['menuFontSize'])}>
          {fontSizeOptions.map((option) => <option key={option.id} value={option.id}>{t(language, option.label)}</option>)}
        </select>
      </label>
      <label className="block text-sm" htmlFor="settings-log-font-size">{t(language, 'Log viewer font size')}
        <select id="settings-log-font-size" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" value={selectedLogFontSize} onChange={(e) => setFontSize('logViewerFontSize', e.target.value as PersistedSettings['logViewerFontSize'])}>
          {fontSizeOptions.map((option) => <option key={option.id} value={option.id}>{t(language, option.label)}</option>)}
        </select>
      </label>
    </div>
    <div className="mt-3 rounded border border-slate-800 bg-slate-900/70 p-3">
      <p className="text-xs font-semibold text-slate-300">{t(language, 'Font preview')}</p>
      <p className="mt-2 text-sm text-slate-100">{t(language, 'Menu text controls navigation, settings, target picker, and toolbar text.')}</p>
      <p className="mt-1 font-mono text-xs text-yellow-100">{t(language, 'Log viewer text controls raw log rows, filters, and row detail text.')}</p>
    </div>
  </section>
}

type SelectedTarget = ReturnType<ReturnType<typeof useKubeStore.getState>['getSelectedPodTargets']>[number]

type SettingsSectionContentProps = {
  activeSection: SettingsSectionId
  activeTarget: SelectedTarget | undefined
  draft: PersistedSettings
  error: CommandError | undefined
  errors: SettingsValidationError[]
  handleClearTargetCache: () => void
  handlePolicySelect: (value: LogPolicySelectionId) => void
  handleRawPolicyTextChange: (value: string) => void
  handleRestart: () => void
  handleTestPaths: () => Promise<void>
  language: PersistedSettings['language']
  loading: boolean
  notice: string | undefined
  policyText: string
  previewColorTheme: (value: PersistedSettings['colorTheme']) => void
  previewPolicy: LogPolicy
  restoreDraftColorTheme: () => void
  selectedPolicyId: LogPolicySelectionId
  setActiveSection: (section: SettingsSectionId) => void
  setCustomPolicy: (policy: LogPolicy, message?: string) => void
  setColorTheme: (value: PersistedSettings['colorTheme']) => void
  setFontSize: (key: 'menuFontSize' | 'logViewerFontSize', value: PersistedSettings['menuFontSize']) => void
  setDefaultNamespace: (value: string) => void
  setLanguage: (value: PersistedSettings['language']) => void
  setNum: (key: 'initialTailLines' | 'bufferLimit', value: string) => void
  setShortcut: (key: keyof NonNullable<PersistedSettings['shortcuts']>, value: string) => void
  setShowPathOverrides: (updater: (value: boolean) => boolean) => void
  setShowRawJson: (updater: (value: boolean) => boolean) => void
  showPathOverrides: boolean
  showRawJson: boolean
  sourceTypes: string[]
  testingPaths: boolean
  testResults: TestPathResult[]
  updateCsvFilePlugin: (patch: Partial<PersistedSettings['plugins']['targets']['csvFile']>) => void
  updateViewerPlugin: (settingsKey: keyof PersistedSettings['plugins']['viewers'], patch: Partial<PersistedSettings['plugins']['viewers'][keyof PersistedSettings['plugins']['viewers']]>) => void
  updateAwsVmLogPath: (sourceType: SourceLogType, path: string) => void
  updateAwsVmPlugin: (patch: Partial<PersistedSettings['plugins']['targets']['awsVm']>) => void
  warnings: string[]
}

export function SettingsSectionContent(props: SettingsSectionContentProps) {
  const { activeSection, activeTarget, draft, error, errors, handleClearTargetCache, handlePolicySelect, handleRawPolicyTextChange, handleRestart, handleTestPaths, language, loading, notice, policyText, previewColorTheme, previewPolicy, restoreDraftColorTheme, selectedPolicyId, setActiveSection, setCustomPolicy, setColorTheme, setFontSize, setDefaultNamespace, setLanguage, setNum, setShortcut, setShowPathOverrides, setShowRawJson, showPathOverrides, showRawJson, sourceTypes, testingPaths, testResults, updateCsvFilePlugin, updateViewerPlugin, updateAwsVmLogPath, updateAwsVmPlugin, warnings } = props
  const targetPluginSettingsKey = activeSection.startsWith('target-plugin:') ? activeSection.slice('target-plugin:'.length) : undefined
  const viewerPluginSettingsKey = activeSection.startsWith('viewer-plugin:') ? activeSection.slice('viewer-plugin:'.length) : undefined
  const visibleErrors = errors.filter((item) => {
    if (item.field.startsWith('plugins.targets.awsVm') && !draft.plugins.targets.awsVm.enabled) return false
    if (item.field.startsWith('plugins.targets.csvFile') && !draft.plugins.targets.csvFile.enabled) return false
    return true
  })
  return <>
    {activeSection === 'runtime' && <RuntimeSection draft={draft} language={language} setDefaultNamespace={setDefaultNamespace} setNum={setNum} />}
    {activeSection === 'appearance' && <AppearanceSection draft={draft} language={language} previewColorTheme={previewColorTheme} restoreDraftColorTheme={restoreDraftColorTheme} setColorTheme={setColorTheme} setFontSize={setFontSize} setLanguage={setLanguage} />}
    {activeSection === 'plugin-inventory' && <PluginInventoryPanel language={language} onOpenTargetPlugin={(settingsKey) => setActiveSection(`target-plugin:${settingsKey}`)} onOpenViewerPlugin={(settingsKey) => setActiveSection(`viewer-plugin:${settingsKey}`)} settings={draft} />}
    {activeSection === 'log-source' && <LogSourceSection activeTarget={activeTarget} handlePolicySelect={handlePolicySelect} handleTestPaths={handleTestPaths} language={language} previewPolicy={previewPolicy} selectedPolicyId={selectedPolicyId} setCustomPolicy={setCustomPolicy} sourceTypes={sourceTypes} testingPaths={testingPaths} testResults={testResults} warnings={warnings} />}
    {targetPluginSettingsKey && <TargetPluginSettingsPanels draft={draft} language={language} settingsKey={targetPluginSettingsKey} sourceTypes={sourceTypes} updateCsvFilePlugin={updateCsvFilePlugin} updateAwsVmLogPath={updateAwsVmLogPath} updateAwsVmPlugin={updateAwsVmPlugin} />}
    {viewerPluginSettingsKey && <ViewerPluginSettingsPanels draft={draft} language={language} settingsKey={viewerPluginSettingsKey} updateViewerPlugin={updateViewerPlugin} />}
    {activeSection === 'advanced' && <AdvancedSection onRawPolicyTextChange={handleRawPolicyTextChange} policyText={policyText} previewPolicy={previewPolicy} setCustomPolicy={setCustomPolicy} setShowPathOverrides={setShowPathOverrides} language={language} setShowRawJson={setShowRawJson} showPathOverrides={showPathOverrides} showRawJson={showRawJson} sourceTypes={sourceTypes} />}
    {activeSection === 'shortcuts' && <ShortcutsSection draft={draft} language={language} setShortcut={setShortcut} />}
    <StatusMessages error={error} errors={visibleErrors} language={language} notice={notice} />
    {activeSection === 'maintenance' && <MaintenanceSection handleClearTargetCache={handleClearTargetCache} handleRestart={handleRestart} language={language} loading={loading} />}
  </>
}
