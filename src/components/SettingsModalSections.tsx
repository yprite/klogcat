import type { CommandError } from '../commands/types'
import type { KeyboardShortcuts, PersistedSettings, SettingsValidationError } from '../types/settings'
import type { SourceLogType } from '../types/log'
import type { SelectedPodTarget } from '../stores/kubeStore'
import { targetPluginDefinitions } from '../plugins/targetPluginRegistry'
import { viewerPluginDefinitions } from '../plugins/viewerPluginRegistry'
import {
  buildLogPathFromPolicy,
  buildLogPathTemplateFromPolicy,
  builtinLogPolicyOptions,
  defaultLogPolicy,
  logPathTemplateTokens,
  type LogPolicy,
  type LogPolicySelectionId,
} from '../utils/logPolicy'
import { sourceLabelsForActivePolicy } from '../utils/sourceLabels'
import { t, type Language } from '../utils/i18n'

export type TestPathResult = { sourceType: SourceLogType; label: string; path: string; ok: boolean; message: string }

function clonePolicy(policy: LogPolicy): LogPolicy {
  return JSON.parse(JSON.stringify(policy)) as LogPolicy
}

function policyWithPathPattern(policy: LogPolicy, pathPattern: string) {
  const next = clonePolicy(policy)
  next.pathTemplate = pathPattern
  next.sources = Object.fromEntries(Object.entries(next.sources).map(([key, source]) => [key, { ...source, pathTemplate: undefined }])) as LogPolicy['sources']
  return next
}

function policyWithSourceSuffix(policy: LogPolicy, sourceType: SourceLogType, suffix: string) {
  const next = clonePolicy(policy)
  next.sources[sourceType] = { ...next.sources[sourceType], pathSuffix: suffix }
  return next
}

function policyWithSourcePath(policy: LogPolicy, sourceType: SourceLogType, pathTemplate: string) {
  const next = clonePolicy(policy)
  next.sources[sourceType] = { ...next.sources[sourceType], pathTemplate }
  return next
}

function sourceKeyFromLabel(label: string) {
  return label.trim().toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '')
}

function policyWithAddedSource(policy: LogPolicy, label: string) {
  const key = sourceKeyFromLabel(label)
  if (!key || policy.sources[key]) return policy
  const next = clonePolicy(policy)
  next.sources[key] = {
    label: label.trim().toUpperCase(),
    pathSuffix: `_${label.trim().toUpperCase()}`,
    columns: defaultLogPolicy.sources.info.columns,
  }
  return next
}

function policyWithoutSource(policy: LogPolicy, sourceType: SourceLogType) {
  const next = clonePolicy(policy)
  if (Object.keys(next.sources).length <= 1) return next
  delete next.sources[sourceType]
  return next
}

function stripSourcePathOverrides(policy: LogPolicy) {
  const next = clonePolicy(policy)
  next.pathTemplate = defaultLogPolicy.pathTemplate
  next.sources = Object.fromEntries(Object.entries(next.sources).map(([key, source]) => {
    const defaultSource = defaultLogPolicy.sources[key]
    return [key, { ...source, pathSuffix: defaultSource?.pathSuffix ?? source.pathSuffix, pathTemplate: undefined }]
  })) as LogPolicy['sources']
  return next
}

export type SettingsSectionId = 'runtime' | 'appearance' | 'plugin-inventory' | 'log-source' | `target-plugin:${string}` | `viewer-plugin:${string}` | 'advanced' | 'shortcuts' | 'maintenance'

const settingsSections: Array<{ id: SettingsSectionId; label: string }> = [
  { id: 'runtime', label: 'Runtime' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'plugin-inventory', label: 'Plugins' },
  { id: 'log-source', label: 'Log source' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'maintenance', label: 'Maintenance' },
]

export function SettingsNav({ activeSection, language, onSectionChange }: { activeSection: SettingsSectionId; language?: Language; onSectionChange: (section: SettingsSectionId) => void }) {
  return <nav aria-label={t(language, 'Settings sections')} className="max-h-48 overflow-auto border-b border-slate-800 bg-slate-950/60 p-3 text-sm sm:max-h-none sm:border-b-0 sm:border-r sm:p-4">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t(language, 'Sections')}</p>
    <div className="mt-2 flex gap-2 overflow-x-auto pb-1 sm:mt-0 sm:block sm:overflow-visible sm:pb-0">
    {settingsSections.map((section, index) => <div className="shrink-0 sm:shrink" key={section.id}>
      <button type="button" className={`${index === 0 ? 'sm:mt-3' : 'sm:mt-2'} block w-full min-w-28 rounded border px-3 py-2 text-left sm:min-w-0 ${activeSection === section.id ? 'border-yellow-400 bg-yellow-400/10 text-yellow-100' : 'border-slate-800 text-slate-200 hover:border-slate-600'}`} onClick={() => onSectionChange(section.id)}>{t(language, section.label)}</button>
      {section.id === 'plugin-inventory' && <div className="mt-2 space-y-1 border-l border-slate-800 pl-3">
        <p className="px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t(language, 'Target plugins')}</p>
        {targetPluginDefinitions.map((plugin) => {
          const sectionId = `target-plugin:${plugin.settingsKey}` as SettingsSectionId
          return <button key={plugin.manifest.id} type="button" className={`block w-full rounded border px-2 py-1.5 text-left text-xs ${activeSection === sectionId ? 'border-yellow-400 bg-yellow-400/10 text-yellow-100' : 'border-slate-800 text-slate-300 hover:border-slate-600'}`} onClick={() => onSectionChange(sectionId)}>{t(language, plugin.manifest.label)}</button>
        })}
        <p className="px-2 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t(language, 'Viewer plugins')}</p>
        {viewerPluginDefinitions.map((plugin) => {
          const sectionId = `viewer-plugin:${plugin.settingsKey}` as SettingsSectionId
          return <button key={plugin.manifest.id} type="button" className={`block w-full rounded border px-2 py-1.5 text-left text-xs ${activeSection === sectionId ? 'border-yellow-400 bg-yellow-400/10 text-yellow-100' : 'border-slate-800 text-slate-300 hover:border-slate-600'}`} onClick={() => onSectionChange(sectionId)}>{t(language, plugin.manifest.label)}</button>
        })}
      </div>}
    </div>)}
    </div>
  </nav>
}

export function RuntimeSection({ draft, language, setDefaultNamespace, setNum }: { draft: PersistedSettings; language?: Language; setDefaultNamespace: (value: string) => void; setNum: (key: 'initialTailLines' | 'bufferLimit', value: string) => void }) {
  return <section id="settings-runtime" className="rounded border border-slate-700 bg-slate-950/60 p-3">
    <h3 className="text-sm font-semibold text-white">{t(language, 'Runtime')}</h3>
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <label className="block text-sm">{t(language, 'Initial tail lines')} <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-white" type="number" value={draft.initialTailLines} onChange={e=>setNum('initialTailLines', e.target.value)} /></label>
      <label className="block text-sm">{t(language, 'Buffer limit')} <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-white" type="number" value={draft.bufferLimit} onChange={e=>setNum('bufferLimit', e.target.value)} /></label>
      <label className="block text-sm sm:col-span-2">{t(language, 'Default namespace')} <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-white" value={draft.defaultNamespace ?? ''} onChange={e=>setDefaultNamespace(e.target.value)} placeholder="default" /></label>
    </div>
  </section>
}

type LogSourceSectionProps = {
  activeTarget?: SelectedPodTarget
  handlePolicySelect: (value: LogPolicySelectionId) => void
  handleTestPaths: () => void
  language?: Language
  previewPolicy: LogPolicy
  selectedPolicyId: LogPolicySelectionId
  setCustomPolicy: (policy: LogPolicy, message?: string) => void
  sourceTypes: SourceLogType[]
  testingPaths: boolean
  testResults: TestPathResult[]
  warnings: string[]
}

export function LogSourceSection({ activeTarget, handlePolicySelect, handleTestPaths, language, previewPolicy, selectedPolicyId, setCustomPolicy, sourceTypes, testingPaths, testResults, warnings }: LogSourceSectionProps) {
  const sourceLabels = sourceLabelsForActivePolicy()
  const exampleNamespace = activeTarget?.namespace ?? 'example-namespace'
  const examplePod = activeTarget?.pod.name ?? 'example-pod'
  const addSource = () => {
    const label = window.prompt(t(language, 'New log type label'), 'DEBUG')
    if (!label) return
    setCustomPolicy(policyWithAddedSource(previewPolicy, label), t(language, 'Custom log type added'))
  }

  return <section id="settings-log-source" className="rounded border border-slate-700 bg-slate-950/60 p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold text-white">{t(language, 'Log Source Profile')}</h3>
        <p className="mt-1 text-xs text-slate-400">{t(language, 'Preview, validate, and safely save how Kubernetes log paths are built.')}</p>
      </div>
      <span className="rounded bg-indigo-500/20 px-2 py-1 text-xs text-indigo-100">{t(language, selectedPolicyId === 'custom' ? 'Custom, based on SCloud' : 'SCloud default')}</span>
    </div>

    <label className="mt-3 block text-sm" htmlFor="log-profile-select">{t(language, 'Profile / Log policy')}</label>
    <select id="log-profile-select" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" value={selectedPolicyId} onChange={(e) => handlePolicySelect(e.target.value as LogPolicySelectionId)}>
      {builtinLogPolicyOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      <option value="custom">{t(language, 'Custom profile')}</option>
    </select>

    <label className="mt-3 block text-sm" htmlFor="path-pattern">{t(language, 'Path pattern')}</label>
    <input id="path-pattern" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-slate-100" value={previewPolicy.pathTemplate} onChange={(e) => setCustomPolicy(policyWithPathPattern(previewPolicy, e.target.value))} />

    <div className="mt-3 rounded border border-slate-800 bg-slate-900/70 p-2">
      <p className="text-xs font-semibold text-slate-200">{t(language, 'Available variables — click to insert into Path pattern')}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {logPathTemplateTokens.map((item) => <button className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 hover:border-slate-400" key={item.token} title={item.description} onClick={() => setCustomPolicy(policyWithPathPattern(previewPolicy, `${previewPolicy.pathTemplate}${item.token}`))}>{item.token}</button>)}
      </div>
    </div>

    <div className="mt-3 grid gap-2 sm:grid-cols-3">
      {sourceTypes.map((type) => {
        const label = previewPolicy.sources[type]?.label ?? sourceLabels[type] ?? type
        const inputId = `source-suffix-${type}`
        return <div className="rounded border border-slate-700 p-2" key={type}>
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-semibold text-white" htmlFor={inputId}>{label} {t(language, 'suffix')}</label>
            {sourceTypes.length > 1 && <button type="button" className="rounded border border-slate-700 px-1 text-[10px] text-slate-300 hover:border-red-400 hover:text-red-200" onClick={() => setCustomPolicy(policyWithoutSource(previewPolicy, type), t(language, 'Custom log type removed'))}>Remove</button>}
          </div>
          <input id={inputId} aria-label={`${label} ${t(language, 'suffix')}`} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-slate-100" value={previewPolicy.sources[type]?.pathSuffix ?? ''} onChange={(e) => setCustomPolicy(policyWithSourceSuffix(previewPolicy, type, e.target.value))} />
        </div>
      })}
    </div>
    <button type="button" className="mt-3 rounded border border-sky-500 px-3 py-1 text-xs text-sky-100 hover:bg-sky-500/10" onClick={addSource}>{t(language, 'Add log type')}</button>

    {warnings.length > 0 && <ul className="mt-3 rounded border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs text-yellow-100">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}

    <LogPathPreview activeTarget={activeTarget} exampleNamespace={exampleNamespace} examplePod={examplePod} handleTestPaths={handleTestPaths} language={language} previewPolicy={previewPolicy} setCustomPolicy={setCustomPolicy} sourceTypes={sourceTypes} testingPaths={testingPaths} testResults={testResults} />
  </section>
}

export function ShortcutsSection({ draft, language, setShortcut }: { draft: PersistedSettings; language?: Language; setShortcut: (key: keyof KeyboardShortcuts, value: string) => void }) {
  const shortcuts = draft.shortcuts ?? {}
  return <section id="settings-shortcuts" className="rounded border border-slate-700 bg-slate-950/60 p-3">
    <h3 className="text-sm font-semibold text-white">{t(language, 'Shortcuts')}</h3>
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <ShortcutInput label={t(language, 'Open settings')} value={shortcuts.openSettings ?? ''} onChange={(value) => setShortcut('openSettings', value)} />
      <ShortcutInput label={t(language, 'Open target picker')} value={shortcuts.openTargetPicker ?? ''} onChange={(value) => setShortcut('openTargetPicker', value)} />
      <ShortcutInput label={t(language, 'Start or stop stream')} value={shortcuts.toggleStream ?? ''} onChange={(value) => setShortcut('toggleStream', value)} />
      <ShortcutInput label={t(language, 'Restart stream')} value={shortcuts.restartStream ?? ''} onChange={(value) => setShortcut('restartStream', value)} />
    </div>
  </section>
}

function ShortcutInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-sm">{label}<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-white" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Meta+K" /></label>
}

function LogPathPreview({ activeTarget, exampleNamespace, examplePod, handleTestPaths, language, previewPolicy, setCustomPolicy, sourceTypes, testingPaths, testResults }: Omit<LogSourceSectionProps, 'handlePolicySelect' | 'selectedPolicyId' | 'warnings'> & { exampleNamespace: string; examplePod: string }) {
  return <div className="mt-3 rounded border border-slate-800 bg-slate-900/70 p-2">
    <p className="text-xs font-semibold text-slate-200">{t(language, activeTarget ? 'Preview using current target' : 'Preview using example target')}</p>
    <p className="mt-1 text-xs text-slate-400">{t(language, 'Namespace')}: {exampleNamespace} · {t(language, 'Pod')}: {examplePod}</p>
    <div className="mt-2 space-y-1 text-xs">
      {sourceTypes.map((type) => <p className="font-mono text-slate-200" key={type}>{previewPolicy.sources[type]?.label ?? type} → <span>{buildLogPathFromPolicy(previewPolicy, exampleNamespace, examplePod, type)}</span></p>)}
    </div>
    <div className="mt-2 flex flex-wrap gap-2">
      <button className="rounded border border-sky-500 px-3 py-1 text-xs text-sky-100 hover:bg-sky-500/10" disabled={testingPaths} onClick={handleTestPaths}>{t(language, testingPaths ? 'Testing paths…' : 'Test paths')}</button>
      <button className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-100 hover:bg-slate-700" onClick={() => setCustomPolicy(stripSourcePathOverrides(previewPolicy), t(language, 'Log paths reset to SCloud defaults'))}>{t(language, 'Reset log paths to SCloud defaults')}</button>
    </div>
    {testResults.length > 0 && <ul className="mt-2 space-y-1 text-xs">{testResults.map((result) => <li className={result.ok ? 'text-green-300' : 'text-red-300'} key={result.sourceType}>{result.label} {result.message}: <span className="font-mono">{result.path}</span></li>)}</ul>}
  </div>
}

type AdvancedSectionProps = {
  onRawPolicyTextChange: (value: string) => void
  policyText: string
  previewPolicy: LogPolicy
  setCustomPolicy: (policy: LogPolicy, message?: string) => void
  setShowPathOverrides: (updater: (value: boolean) => boolean) => void
  language?: Language
  setShowRawJson: (updater: (value: boolean) => boolean) => void
  showPathOverrides: boolean
  showRawJson: boolean
  sourceTypes: SourceLogType[]
}

export function AdvancedSection({ onRawPolicyTextChange, policyText, previewPolicy, setCustomPolicy, setShowPathOverrides, language, setShowRawJson, showPathOverrides, showRawJson, sourceTypes }: AdvancedSectionProps) {
  const sourceLabels = sourceLabelsForActivePolicy()
  return <section id="settings-advanced" className="rounded border border-slate-700 bg-slate-950/60 p-3">
    <div className="mb-3 flex items-center justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold text-white">{t(language, 'Advanced')}</h3>
        <p className="mt-1 text-xs text-slate-400">{t(language, 'Path overrides and raw policy JSON are isolated from the normal setup flow.')}</p>
      </div>
      <button className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-100 hover:bg-slate-700" onClick={() => setShowPathOverrides((value) => !value)}>{t(language, showPathOverrides ? 'Hide path overrides' : 'Advanced path overrides')}</button>
    </div>

    {showPathOverrides && <div className="mt-3 rounded border border-slate-700 p-2">
      <p className="text-xs font-semibold text-slate-200">{t(language, 'Advanced: customize each log type path')}</p>
      <div className="mt-2 space-y-2">
        {sourceTypes.map((type) => <label className="block" key={type}>
          <span className="text-sm font-semibold text-white">{previewPolicy.sources[type]?.label ?? sourceLabels[type]} {t(language, 'path template')}</span>
          <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-slate-100" value={buildLogPathTemplateFromPolicy(previewPolicy, type)} onChange={(e) => setCustomPolicy(policyWithSourcePath(previewPolicy, type, e.target.value))} />
        </label>)}
      </div>
    </div>}

    <div className="mt-3">
      <button className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-100 hover:bg-slate-700" onClick={() => setShowRawJson((value) => !value)}>{t(language, showRawJson ? 'Hide advanced raw JSON' : 'Advanced raw JSON')}</button>
    </div>

    {showRawJson && <div className="mt-3 rounded border border-slate-700 p-2">
      <p className="text-xs text-slate-400">{t(language, 'Only edit raw JSON if you need parser fields, query suggestions, severity, grouping, export/import, or a future preset.')}</p>
      <label className="mt-2 block text-sm" htmlFor="log-policy-json">{t(language, 'Custom policy JSON')}</label>
      <textarea id="log-policy-json" className="mt-1 h-64 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-slate-100" spellCheck={false} value={policyText} onChange={(e) => onRawPolicyTextChange(e.target.value)} />
    </div>}
  </section>
}

export function StatusMessages({ error, errors, language, notice }: { error?: CommandError; errors: SettingsValidationError[]; language?: Language; notice?: string }) {
  return <>
    {errors.length > 0 && <ul className="text-red-300 text-sm">{errors.map((e, index) => <li key={`${e.field}-${index}`}>{e.field}: {t(language, e.message)}</li>)}</ul>}
    {notice && <p className="text-green-300">{notice}</p>}
    {error && <p className="text-red-300">{error.message}</p>}
  </>
}

export function MaintenanceSection({ handleClearTargetCache, handleRestart, language, loading }: { handleClearTargetCache: () => void; handleRestart: () => void; language?: Language; loading: boolean }) {
  return <section id="settings-maintenance" className="rounded border border-slate-700 bg-slate-950/60 p-3">
    <h3 className="text-sm font-semibold text-white">{t(language, 'Target cache')}</h3>
    <p className="mt-1 text-xs text-slate-400">{t(language, 'Clear cached cluster, namespace, and pod lists to resolve stale pod selections.')}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <button className="rounded border border-yellow-500 px-3 py-1 text-sm text-yellow-100 hover:bg-yellow-500/10" disabled={loading} onClick={handleClearTargetCache}>{t(language, 'Clear Target Cache')}</button>
      <button className="rounded border border-red-500 px-3 py-1 text-sm text-red-100 hover:bg-red-500/10" disabled={loading} onClick={handleRestart}>{t(language, 'Restart App')}</button>
    </div>
  </section>
}

export function SettingsFooter({ canSave, handleReset, handleSave, language, loading, saveBlockedReason }: { canSave: boolean; handleReset: () => void; handleSave: () => void; language?: Language; loading: boolean; saveBlockedReason?: string }) {
  return <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-700 bg-slate-900 p-3 sm:p-4">
    <button aria-label={t(language, 'Reset')} className="rounded border border-red-500/70 px-3 py-1 text-sm text-red-100 hover:bg-red-500/10" disabled={loading} onClick={handleReset}>{t(language, 'Reset all settings')}</button>
    <div className="flex flex-col items-end gap-1">
      {saveBlockedReason && <p className="max-w-md text-right text-xs text-yellow-200" role="status">{saveBlockedReason}</p>}
      <button className="rounded border border-yellow-400 bg-yellow-300 px-4 py-1 text-sm font-semibold text-slate-950 hover:bg-yellow-200 disabled:cursor-not-allowed disabled:opacity-60" disabled={loading || !canSave} onClick={handleSave}>{t(language, 'Save')}</button>
    </div>
  </div>
}
