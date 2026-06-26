import type { CommandError } from '../commands/types'
import type { PersistedSettings, SettingsValidationError } from '../types/settings'
import type { SourceLogType } from '../types/log'
import type { SelectedPodTarget } from '../stores/kubeStore'
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

function stripSourcePathOverrides(policy: LogPolicy) {
  const next = clonePolicy(policy)
  next.pathTemplate = defaultLogPolicy.pathTemplate
  next.sources = Object.fromEntries(Object.entries(defaultLogPolicy.sources).map(([key, source]) => [key, { ...next.sources[key as SourceLogType], pathSuffix: source.pathSuffix, pathTemplate: undefined }])) as LogPolicy['sources']
  return next
}

export function SettingsNav() {
  return <nav aria-label="Settings sections" className="border-r border-slate-800 bg-slate-950/60 p-4 text-sm">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sections</p>
    <a className="mt-3 block rounded border border-slate-800 px-3 py-2 text-slate-200 hover:border-slate-600" href="#settings-runtime">Runtime</a>
    <a className="mt-2 block rounded border border-slate-800 px-3 py-2 text-slate-200 hover:border-slate-600" href="#settings-log-source">Log source</a>
    <a className="mt-2 block rounded border border-slate-800 px-3 py-2 text-slate-200 hover:border-slate-600" href="#settings-advanced">Advanced</a>
    <a className="mt-2 block rounded border border-slate-800 px-3 py-2 text-slate-200 hover:border-slate-600" href="#settings-maintenance">Maintenance</a>
  </nav>
}

export function RuntimeSection({ draft, setNum }: { draft: PersistedSettings; setNum: (key: 'initialTailLines' | 'bufferLimit', value: string) => void }) {
  return <section id="settings-runtime" className="rounded border border-slate-700 bg-slate-950/60 p-3">
    <h3 className="text-sm font-semibold text-white">Runtime</h3>
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <label className="block text-sm">Initial tail lines <input className="mt-1 w-full rounded p-2 text-black" type="number" value={draft.initialTailLines} onChange={e=>setNum('initialTailLines', e.target.value)} /></label>
      <label className="block text-sm">Buffer limit <input className="mt-1 w-full rounded p-2 text-black" type="number" value={draft.bufferLimit} onChange={e=>setNum('bufferLimit', e.target.value)} /></label>
    </div>
  </section>
}

type LogSourceSectionProps = {
  activeTarget?: SelectedPodTarget
  handlePolicySelect: (value: LogPolicySelectionId) => void
  handleTestPaths: () => void
  previewPolicy: LogPolicy
  selectedPolicyId: LogPolicySelectionId
  setCustomPolicy: (policy: LogPolicy, message?: string) => void
  sourceTypes: SourceLogType[]
  testingPaths: boolean
  testResults: TestPathResult[]
  warnings: string[]
}

export function LogSourceSection({ activeTarget, handlePolicySelect, handleTestPaths, previewPolicy, selectedPolicyId, setCustomPolicy, sourceTypes, testingPaths, testResults, warnings }: LogSourceSectionProps) {
  const sourceLabels = sourceLabelsForActivePolicy()
  const exampleNamespace = activeTarget?.namespace ?? 'example-namespace'
  const examplePod = activeTarget?.pod.name ?? 'example-pod'

  return <section id="settings-log-source" className="rounded border border-slate-700 bg-slate-950/60 p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold text-white">Log Source Profile</h3>
        <p className="mt-1 text-xs text-slate-400">내 Kubernetes 로그 경로가 어떻게 만들어지는지 미리 보고, 검증하고, 안전하게 저장해.</p>
      </div>
      <span className="rounded bg-indigo-500/20 px-2 py-1 text-xs text-indigo-100">{selectedPolicyId === 'custom' ? 'Custom, based on SCloud' : 'SCloud default'}</span>
    </div>

    <label className="mt-3 block text-sm" htmlFor="log-profile-select">Profile / Log policy</label>
    <select id="log-profile-select" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" value={selectedPolicyId} onChange={(e) => handlePolicySelect(e.target.value as LogPolicySelectionId)}>
      {builtinLogPolicyOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      <option value="custom">Custom profile</option>
    </select>

    <label className="mt-3 block text-sm" htmlFor="path-pattern">Path pattern</label>
    <input id="path-pattern" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-slate-100" value={previewPolicy.pathTemplate} onChange={(e) => setCustomPolicy(policyWithPathPattern(previewPolicy, e.target.value))} />

    <div className="mt-3 rounded border border-slate-800 bg-slate-900/70 p-2">
      <p className="text-xs font-semibold text-slate-200">Available variables — click to insert into Path pattern</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {logPathTemplateTokens.map((item) => <button className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 hover:border-slate-400" key={item.token} title={item.description} onClick={() => setCustomPolicy(policyWithPathPattern(previewPolicy, `${previewPolicy.pathTemplate}${item.token}`))}>{item.token}</button>)}
      </div>
    </div>

    <div className="mt-3 grid gap-2 sm:grid-cols-3">
      {sourceTypes.map((type) => <label className="block rounded border border-slate-700 p-2" key={type}>
        <span className="text-xs font-semibold text-white">{previewPolicy.sources[type]?.label ?? sourceLabels[type]} suffix</span>
        <input aria-label={`${previewPolicy.sources[type]?.label ?? sourceLabels[type]} suffix`} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-slate-100" value={previewPolicy.sources[type]?.pathSuffix ?? ''} onChange={(e) => setCustomPolicy(policyWithSourceSuffix(previewPolicy, type, e.target.value))} />
      </label>)}
    </div>

    {warnings.length > 0 && <ul className="mt-3 rounded border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs text-yellow-100">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}

    <LogPathPreview activeTarget={activeTarget} exampleNamespace={exampleNamespace} examplePod={examplePod} handleTestPaths={handleTestPaths} previewPolicy={previewPolicy} setCustomPolicy={setCustomPolicy} sourceTypes={sourceTypes} testingPaths={testingPaths} testResults={testResults} />
  </section>
}

function LogPathPreview({ activeTarget, exampleNamespace, examplePod, handleTestPaths, previewPolicy, setCustomPolicy, sourceTypes, testingPaths, testResults }: Omit<LogSourceSectionProps, 'handlePolicySelect' | 'selectedPolicyId' | 'warnings'> & { exampleNamespace: string; examplePod: string }) {
  return <div className="mt-3 rounded border border-slate-800 bg-slate-900/70 p-2">
    <p className="text-xs font-semibold text-slate-200">Preview using {activeTarget ? 'current target' : 'example target'}</p>
    <p className="mt-1 text-xs text-slate-400">Namespace: {exampleNamespace} · Pod: {examplePod}</p>
    <div className="mt-2 space-y-1 text-xs">
      {sourceTypes.map((type) => <p className="font-mono text-slate-200" key={type}>{previewPolicy.sources[type]?.label ?? type} → <span>{buildLogPathFromPolicy(previewPolicy, exampleNamespace, examplePod, type)}</span></p>)}
    </div>
    <div className="mt-2 flex flex-wrap gap-2">
      <button className="rounded border border-sky-500 px-3 py-1 text-xs text-sky-100 hover:bg-sky-500/10" disabled={testingPaths} onClick={handleTestPaths}>{testingPaths ? 'Testing paths…' : 'Test paths'}</button>
      <button className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-100 hover:bg-slate-700" onClick={() => setCustomPolicy(stripSourcePathOverrides(previewPolicy), 'Log paths reset to SCloud defaults')}>Reset log paths to SCloud defaults</button>
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
  setShowRawJson: (updater: (value: boolean) => boolean) => void
  showPathOverrides: boolean
  showRawJson: boolean
  sourceTypes: SourceLogType[]
}

export function AdvancedSection({ onRawPolicyTextChange, policyText, previewPolicy, setCustomPolicy, setShowPathOverrides, setShowRawJson, showPathOverrides, showRawJson, sourceTypes }: AdvancedSectionProps) {
  const sourceLabels = sourceLabelsForActivePolicy()
  return <section id="settings-advanced" className="rounded border border-slate-700 bg-slate-950/60 p-3">
    <div className="mb-3 flex items-center justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold text-white">Advanced</h3>
        <p className="mt-1 text-xs text-slate-400">Path overrides and raw policy JSON are isolated from the normal setup flow.</p>
      </div>
      <button className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-100 hover:bg-slate-700" onClick={() => setShowPathOverrides((value) => !value)}>{showPathOverrides ? 'Hide path overrides' : 'Advanced path overrides'}</button>
    </div>

    {showPathOverrides && <div className="mt-3 rounded border border-slate-700 p-2">
      <p className="text-xs font-semibold text-slate-200">Advanced: customize each log type path</p>
      <div className="mt-2 space-y-2">
        {sourceTypes.map((type) => <label className="block" key={type}>
          <span className="text-sm font-semibold text-white">{previewPolicy.sources[type]?.label ?? sourceLabels[type]} path template</span>
          <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-slate-100" value={buildLogPathTemplateFromPolicy(previewPolicy, type)} onChange={(e) => setCustomPolicy(policyWithSourcePath(previewPolicy, type, e.target.value))} />
        </label>)}
      </div>
    </div>}

    <div className="mt-3">
      <button className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-100 hover:bg-slate-700" onClick={() => setShowRawJson((value) => !value)}>{showRawJson ? 'Hide advanced raw JSON' : 'Advanced raw JSON'}</button>
    </div>

    {showRawJson && <div className="mt-3 rounded border border-slate-700 p-2">
      <p className="text-xs text-slate-400">Only edit raw JSON if you need parser fields, query suggestions, severity, grouping, export/import, or a future preset.</p>
      <label className="mt-2 block text-sm" htmlFor="log-policy-json">Custom policy JSON</label>
      <textarea id="log-policy-json" className="mt-1 h-64 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-slate-100" spellCheck={false} value={policyText} onChange={(e) => onRawPolicyTextChange(e.target.value)} />
    </div>}
  </section>
}

export function StatusMessages({ error, errors, notice }: { error?: CommandError; errors: SettingsValidationError[]; notice?: string }) {
  return <>
    {errors.length > 0 && <ul className="text-red-300 text-sm">{errors.map((e, index) => <li key={`${e.field}-${index}`}>{e.field}: {e.message}</li>)}</ul>}
    {notice && <p className="text-green-300">{notice}</p>}
    {error && <p className="text-red-300">{error.message}</p>}
  </>
}

export function MaintenanceSection({ handleClearTargetCache, handleRestart, loading }: { handleClearTargetCache: () => void; handleRestart: () => void; loading: boolean }) {
  return <section id="settings-maintenance" className="rounded border border-slate-700 bg-slate-950/60 p-3">
    <h3 className="text-sm font-semibold text-white">Target cache</h3>
    <p className="mt-1 text-xs text-slate-400">캐시된 cluster/namespace/pod 목록을 지워 stale pod 선택 문제를 정리해.</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <button className="rounded border border-yellow-500 px-3 py-1 text-sm text-yellow-100 hover:bg-yellow-500/10" disabled={loading} onClick={handleClearTargetCache}>Clear Target Cache</button>
      <button className="rounded border border-red-500 px-3 py-1 text-sm text-red-100 hover:bg-red-500/10" disabled={loading} onClick={handleRestart}>Restart App</button>
    </div>
  </section>
}

export function SettingsFooter({ handleReset, handleSave, loading }: { handleReset: () => void; handleSave: () => void; loading: boolean }) {
  return <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-700 bg-slate-900 p-4">
    <button aria-label="Reset" className="rounded border border-red-500/70 px-3 py-1 text-sm text-red-100 hover:bg-red-500/10" disabled={loading} onClick={handleReset}>Reset all settings</button>
    <button className="rounded border border-yellow-400 bg-yellow-300 px-4 py-1 text-sm font-semibold text-slate-950 hover:bg-yellow-200" disabled={loading} onClick={handleSave}>Save</button>
  </div>
}
