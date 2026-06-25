import { useEffect, useMemo, useState } from 'react'
import { checkLogPath } from '../commands/tauriLogs'
import { useSettingsStore } from '../stores/settingsStore'
import { useLogStore } from '../stores/logStore'
import { useKubeStore } from '../stores/kubeStore'
import { defaultSettings } from '../config/defaultSettings'
import { validateSettings } from '../config/validateSettings'
import type { PersistedSettings } from '../types/settings'
import type { SourceLogType } from '../types/log'
import { sourceLabelsForActivePolicy } from '../utils/sourceLabels'
import {
  assertValidLogPolicy,
  buildLogPathFromPolicy,
  buildLogPathTemplateFromPolicy,
  builtinLogPolicyOptions,
  defaultLogPolicy,
  getLogPolicy,
  logPathTemplateTokens,
  logPolicyForBuiltinId,
  sourceTypesFromPolicy,
  type LogPolicy,
  type LogPolicySelectionId,
} from '../utils/logPolicy'

type TestPathResult = { sourceType: SourceLogType; label: string; path: string; ok: boolean; message: string }

const knownPathTokens = new Set<string>(logPathTemplateTokens.map((item) => item.token))

function clonePolicy(policy: LogPolicy): LogPolicy {
  return JSON.parse(JSON.stringify(policy)) as LogPolicy
}

function pathWarnings(pattern: string) {
  const warnings: string[] = []
  const tokens = pattern.match(/\[[^\]]+\]/g) ?? []
  for (const token of tokens) {
    if (!knownPathTokens.has(token)) {
      warnings.push(`Unknown variable: ${token}`)
      if (token === '[namesapce]') warnings.push('Did you mean [namespace]?')
    }
  }
  if (!pattern.trim()) warnings.push('Path pattern cannot be empty.')
  if (!pattern.startsWith('/')) warnings.push('Path pattern should start with /.')
  if (!pattern.includes('[namespace]')) warnings.push('Include [namespace] so namespaces resolve to separate paths.')
  if (!pattern.includes('[podname]') && !pattern.includes('[pod]')) warnings.push('Include [podname] or [pod] so pods resolve to separate paths.')
  return warnings
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

export function SettingsModal({ open, onClose, onRestart = () => window.location.reload() }: { open: boolean; onClose: () => void; onRestart?: () => void }) {
  const { settings, saveSettings, resetSettings, error, loading } = useSettingsStore()
  const recordActionDebug = useLogStore((s) => s.recordActionDebug)
  const clearCachedTargets = useKubeStore((s) => s.clearCachedTargets)
  const [draft, setDraft] = useState<PersistedSettings>(settings ?? defaultSettings)
  const [selectedPolicyId, setSelectedPolicyId] = useState<LogPolicySelectionId>((settings ?? defaultSettings).logPolicyId ?? 'scloud')
  const [policyText, setPolicyText] = useState(() => JSON.stringify((settings ?? defaultSettings).logPolicy ?? getLogPolicy(), null, 2))
  const [showPathOverrides, setShowPathOverrides] = useState(true)
  const [showRawJson, setShowRawJson] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [testResults, setTestResults] = useState<TestPathResult[]>([])
  const [testingPaths, setTestingPaths] = useState(false)

  useEffect(() => {
    const next = settings ?? defaultSettings
    setDraft(next)
    setSelectedPolicyId(next.logPolicyId ?? 'scloud')
    setPolicyText(JSON.stringify(next.logPolicy ?? getLogPolicy(), null, 2))
    setShowPathOverrides(true)
    setShowRawJson(false)
    setNotice(undefined)
    setTestResults([])
  }, [settings, open])

  const parsedCustomPolicy = useMemo(() => {
    try {
      const parsed = JSON.parse(policyText) as unknown
      try {
        assertValidLogPolicy(parsed)
        return { policy: parsed as LogPolicy }
      } catch (error) {
        return { policy: parsed as LogPolicy, error: error instanceof Error ? error.message : String(error) }
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }, [policyText])

  if (!open) return null

  const policyDraft = selectedPolicyId === 'custom'
    ? parsedCustomPolicy.policy
    : logPolicyForBuiltinId(selectedPolicyId)
  const policyError = selectedPolicyId === 'custom' ? parsedCustomPolicy.error : undefined
  const previewPolicy = policyDraft ?? getLogPolicy()
  const sourceTypes = sourceTypesFromPolicy(previewPolicy)
  const sourceLabels = sourceLabelsForActivePolicy()
  const activeTarget = useKubeStore.getState().getSelectedPodTargets()[0]
  const exampleNamespace = activeTarget?.namespace ?? 'example-namespace'
  const examplePod = activeTarget?.pod.name ?? 'example-pod'
  const warnings = pathWarnings(previewPolicy.pathTemplate)
  const errors = [...validateSettings({ ...draft, logPolicyId: selectedPolicyId, logPolicy: policyDraft ?? draft.logPolicy }), ...(policyError ? [{ field: 'logPolicy', message: policyError }] : [])]

  const setNum = (key: 'initialTailLines' | 'bufferLimit', value: string) => { setNotice(undefined); setDraft({ ...draft, [key]: Number(value) }) }
  const setCustomPolicy = (policy: LogPolicy, message = 'Profile: Custom, based on SCloud') => {
    setNotice(message)
    setSelectedPolicyId('custom')
    setPolicyText(JSON.stringify(policy, null, 2))
    setShowRawJson(true)
    setTestResults([])
  }
  const handlePolicySelect = (value: LogPolicySelectionId) => {
    setNotice(undefined)
    setSelectedPolicyId(value)
    setTestResults([])
    if (value !== 'custom') setPolicyText(JSON.stringify(logPolicyForBuiltinId(value), null, 2))
    else {
      setPolicyText(JSON.stringify(clonePolicy(previewPolicy), null, 2))
      setShowRawJson(true)
    }
  }
  const handleReset = async () => {
    recordActionDebug('Reset clicked')
    setNotice(undefined)
    const ok = await resetSettings()
    if (ok) {
      const saved = useSettingsStore.getState().settings ?? defaultSettings
      setDraft(saved)
      setSelectedPolicyId(saved.logPolicyId ?? 'scloud')
      setPolicyText(JSON.stringify(saved.logPolicy ?? getLogPolicy(), null, 2))
      setNotice('Settings reset to defaults')
    }
  }
  const handleSave = async () => {
    recordActionDebug(`Save clicked: validationErrors=${errors.length + warnings.length}`)
    setNotice(undefined)
    const nextDraft = { ...draft, logPolicyId: selectedPolicyId, logPolicy: policyDraft }
    const ok = policyDraft && errors.length === 0 && warnings.filter((warning) => warning.startsWith('Unknown') || warning.includes('cannot')).length === 0 ? await saveSettings(nextDraft) : false
    if (ok) onClose()
  }
  const handleClearTargetCache = () => {
    recordActionDebug('Clear target cache clicked')
    clearCachedTargets()
    setNotice('Target cache cleared. Restart to reload fresh Kubernetes targets.')
  }
  const handleRestart = () => {
    recordActionDebug('Restart app clicked')
    onRestart()
  }
  const handleTestPaths = async () => {
    if (!activeTarget) {
      setNotice('Select a namespace and pod before testing paths.')
      return
    }
    setTestingPaths(true)
    setNotice(undefined)
    try {
      const results = await Promise.all(sourceTypes.map(async (sourceType) => {
        const path = buildLogPathFromPolicy(previewPolicy, activeTarget.namespace, activeTarget.pod.name, sourceType)
        const container = activeTarget.pod.containers.includes(previewPolicy.defaultContainer) ? previewPolicy.defaultContainer : activeTarget.pod.containers[0] ?? previewPolicy.defaultContainer
        try {
          const result = await checkLogPath({ context: activeTarget.context, namespace: activeTarget.namespace, pod: activeTarget.pod.name, container, sourceType, filePath: path })
          return { sourceType, label: previewPolicy.sources[sourceType]?.label ?? sourceType, path, ok: result.exists, message: result.exists ? 'OK' : result.message ?? 'Not found' }
        } catch (error) {
          return { sourceType, label: previewPolicy.sources[sourceType]?.label ?? sourceType, path, ok: false, message: error instanceof Error ? error.message : String(error) }
        }
      }))
      setTestResults(results)
    } finally {
      setTestingPaths(false)
    }
  }

  return <div className="fixed inset-0 z-10 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/60 p-3 sm:p-6">
    <div aria-labelledby="settings-title" aria-modal="true" role="dialog" className="flex max-h-[92vh] w-[960px] max-w-[95vw] flex-col overflow-hidden rounded border border-slate-700 bg-slate-900 shadow-2xl">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-700 bg-slate-900 p-4">
        <h2 className="text-lg font-bold" id="settings-title">Settings</h2>
        <button onClick={() => { recordActionDebug('Settings close clicked'); onClose() }}>✕</button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" data-testid="settings-scroll-panel">
        <section className="rounded border border-slate-700 bg-slate-950/60 p-3">
          <h3 className="text-sm font-semibold text-white">Runtime</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="block text-sm">Initial tail lines <input className="mt-1 w-full rounded p-2 text-black" type="number" value={draft.initialTailLines} onChange={e=>setNum('initialTailLines', e.target.value)} /></label>
            <label className="block text-sm">Buffer limit <input className="mt-1 w-full rounded p-2 text-black" type="number" value={draft.bufferLimit} onChange={e=>setNum('bufferLimit', e.target.value)} /></label>
          </div>
        </section>

        <section className="rounded border border-slate-700 bg-slate-950/60 p-3">
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

          <div className="mt-3 rounded border border-slate-800 bg-slate-900/70 p-2">
            <p className="text-xs font-semibold text-slate-200">Preview using {activeTarget ? 'current target' : 'example target'}</p>
            <p className="mt-1 text-xs text-slate-400">Namespace: {exampleNamespace} · Pod: {examplePod}</p>
            <div className="mt-2 space-y-1 text-xs">
              {sourceTypes.map((type) => {
                const path = buildLogPathFromPolicy(previewPolicy, exampleNamespace, examplePod, type)
                return <p className="font-mono text-slate-200" key={type}>{previewPolicy.sources[type]?.label ?? type} → <span>{path}</span></p>
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="rounded border border-sky-500 px-3 py-1 text-xs text-sky-100 hover:bg-sky-500/10" disabled={testingPaths} onClick={handleTestPaths}>{testingPaths ? 'Testing paths…' : 'Test paths'}</button>
              <button className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-100 hover:bg-slate-700" onClick={() => setCustomPolicy(stripSourcePathOverrides(previewPolicy), 'Log paths reset to SCloud defaults')}>Reset log paths to SCloud defaults</button>
              <button className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-100 hover:bg-slate-700" onClick={() => setShowPathOverrides(true)}>Advanced path overrides</button>
              <button className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-100 hover:bg-slate-700" onClick={() => setShowRawJson(true)}>Advanced raw JSON</button>
            </div>
            {testResults.length > 0 && <ul className="mt-2 space-y-1 text-xs">{testResults.map((result) => <li className={result.ok ? 'text-green-300' : 'text-red-300'} key={result.sourceType}>{result.label} {result.message}: <span className="font-mono">{result.path}</span></li>)}</ul>}
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

          {showRawJson && <div className="mt-3 rounded border border-slate-700 p-2">
            <p className="text-xs text-slate-400">Only edit raw JSON if you need parser fields, query suggestions, severity, grouping, export/import, or a future preset.</p>
            <label className="mt-2 block text-sm" htmlFor="log-policy-json">Custom policy JSON</label>
            <textarea id="log-policy-json" className="mt-1 h-64 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-slate-100" spellCheck={false} value={policyText} onChange={(e) => { setNotice(undefined); setSelectedPolicyId('custom'); setPolicyText(e.target.value) }} />
          </div>}
        </section>

        {errors.length > 0 && <ul className="text-red-300 text-sm">{errors.map((e, index) => <li key={`${e.field}-${index}`}>{e.field}: {e.message}</li>)}</ul>}
        {notice && <p className="text-green-300">{notice}</p>}
        {error && <p className="text-red-300">{error.message}</p>}
        <section className="rounded border border-slate-700 bg-slate-950/60 p-3">
          <h3 className="text-sm font-semibold text-white">Target cache</h3>
          <p className="mt-1 text-xs text-slate-400">캐시된 cluster/namespace/pod 목록을 지워 stale pod 선택 문제를 정리해.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="rounded border border-yellow-500 px-3 py-1 text-sm text-yellow-100 hover:bg-yellow-500/10" disabled={loading} onClick={handleClearTargetCache}>Clear Target Cache</button>
            <button className="rounded border border-red-500 px-3 py-1 text-sm text-red-100 hover:bg-red-500/10" disabled={loading} onClick={handleRestart}>Restart App</button>
          </div>
        </section>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-slate-700 bg-slate-900 p-4"><button aria-label="Reset" disabled={loading} onClick={handleReset}>Reset all settings</button><button disabled={loading} onClick={handleSave}>Save</button></div>
    </div>
  </div>
}
