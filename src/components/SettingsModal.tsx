import { useEffect, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useLogStore } from '../stores/logStore'
import { useKubeStore } from '../stores/kubeStore'
import { defaultSettings } from '../config/defaultSettings'
import { validateSettings } from '../config/validateSettings'
import type { PersistedSettings } from '../types/settings'
import { sourceLabelsForActivePolicy } from '../utils/sourceLabels'
import {
  assertValidLogPolicy,
  buildLogPathTemplateFromPolicy,
  builtinLogPolicyOptions,
  getLogPolicy,
  logPolicyForBuiltinId,
  sourceTypesFromPolicy,
  type LogPolicy,
  type LogPolicySelectionId,
} from '../utils/logPolicy'

export function SettingsModal({ open, onClose, onRestart = () => window.location.reload() }: { open: boolean; onClose: () => void; onRestart?: () => void }) {
  const { settings, saveSettings, resetSettings, error, loading } = useSettingsStore()
  const recordActionDebug = useLogStore((s) => s.recordActionDebug)
  const [draft, setDraft] = useState<PersistedSettings>(settings ?? defaultSettings)
  const [selectedPolicyId, setSelectedPolicyId] = useState<LogPolicySelectionId>((settings ?? defaultSettings).logPolicyId ?? 'scloud')
  const [policyText, setPolicyText] = useState(() => JSON.stringify((settings ?? defaultSettings).logPolicy ?? getLogPolicy(), null, 2))
  const [notice, setNotice] = useState<string>()
  useEffect(() => {
    const next = settings ?? defaultSettings
    setDraft(next)
    setSelectedPolicyId(next.logPolicyId ?? 'scloud')
    setPolicyText(JSON.stringify(next.logPolicy ?? getLogPolicy(), null, 2))
    setNotice(undefined)
  }, [settings, open])
  if (!open) return null
  let policyDraft: LogPolicy | undefined
  let policyError: string | undefined
  if (selectedPolicyId === 'custom') {
    try {
      const parsed = JSON.parse(policyText) as unknown
      assertValidLogPolicy(parsed)
      policyDraft = parsed
    } catch (error) {
      policyError = error instanceof Error ? error.message : String(error)
    }
  } else {
    policyDraft = logPolicyForBuiltinId(selectedPolicyId)
  }
  const errors = [...validateSettings({ ...draft, logPolicyId: selectedPolicyId, logPolicy: policyDraft ?? draft.logPolicy }), ...(policyError ? [{ field: 'logPolicy', message: policyError }] : [])]
  const previewPolicy = policyDraft ?? getLogPolicy()
  const sourceTypes = sourceTypesFromPolicy(previewPolicy)
  const sourceLabels = sourceLabelsForActivePolicy()
  const setNum = (key: 'initialTailLines' | 'bufferLimit', value: string) => { setNotice(undefined); setDraft({ ...draft, [key]: Number(value) }) }
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
    recordActionDebug(`Save clicked: validationErrors=${errors.length}`)
    setNotice(undefined)
    const nextDraft = { ...draft, logPolicyId: selectedPolicyId, logPolicy: policyDraft }
    const ok = policyDraft ? await saveSettings(nextDraft) : false
    if (ok) onClose()
  }
  const handleClearTargetCache = () => {
    recordActionDebug('Clear target cache clicked')
    useKubeStore.getState().clearCachedTargets()
    setNotice('Target cache cleared. Restart to reload fresh Kubernetes targets.')
  }
  const handleRestart = () => {
    recordActionDebug('Restart app clicked')
    onRestart()
  }
  return <div className="fixed inset-0 z-10 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/60 p-3 sm:p-6">
    <div
      aria-labelledby="settings-title"
      aria-modal="true"
      role="dialog"
      className="flex max-h-[92vh] w-[900px] max-w-[95vw] flex-col overflow-hidden rounded border border-slate-700 bg-slate-900 shadow-2xl"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-slate-700 bg-slate-900 p-4">
        <h2 className="text-lg font-bold" id="settings-title">Settings</h2>
        <button onClick={() => { recordActionDebug('Settings close clicked'); onClose() }}>✕</button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" data-testid="settings-scroll-panel">
        <label className="block">Initial tail lines <input className="text-black ml-2" type="number" value={draft.initialTailLines} onChange={e=>setNum('initialTailLines', e.target.value)} /></label>
        <label className="block">Buffer limit <input className="text-black ml-2" type="number" value={draft.bufferLimit} onChange={e=>setNum('bufferLimit', e.target.value)} /></label>
        {sourceTypes.map((type) => <fieldset className="border border-slate-700 p-2" key={type}><legend>{previewPolicy.sources[type]?.label ?? sourceLabels[type]}</legend>
          <span className="text-slate-300 text-sm">Fixed path: {buildLogPathTemplateFromPolicy(previewPolicy, type)}</span>
        </fieldset>)}
        <section className="rounded border border-slate-700 bg-slate-950/60 p-3">
          <h3 className="text-sm font-semibold text-white">Log policy</h3>
          <p className="mt-1 text-xs text-slate-400">사용할 로그 정책을 선택해. 일반 사용자는 built-in policy를 고르면 되고, 직접 policy를 만들어야 할 때만 Custom JSON을 선택해.</p>
          <label className="mt-2 block text-sm" htmlFor="log-policy-select">Log policy</label>
          <select
            id="log-policy-select"
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white"
            value={selectedPolicyId}
            onChange={(e) => {
              const nextPolicyId = e.target.value as LogPolicySelectionId
              setNotice(undefined)
              setSelectedPolicyId(nextPolicyId)
              if (nextPolicyId !== 'custom') setPolicyText(JSON.stringify(logPolicyForBuiltinId(nextPolicyId), null, 2))
            }}
          >
            {builtinLogPolicyOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            <option value="custom">Custom JSON policy</option>
          </select>
          <p className="mt-1 text-xs text-slate-400">{selectedPolicyId === 'custom' ? 'Custom policy selected. Validate and save the JSON below.' : builtinLogPolicyOptions.find((option) => option.id === selectedPolicyId)?.description}</p>
          {selectedPolicyId === 'custom' && <>
            <label className="mt-2 block text-sm" htmlFor="log-policy-json">Custom policy JSON</label>
            <textarea
              id="log-policy-json"
              className="mt-1 h-64 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-slate-100"
              spellCheck={false}
              value={policyText}
              onChange={(e) => { setNotice(undefined); setPolicyText(e.target.value) }}
            />
          </>}
        </section>
        {errors.length > 0 && <ul className="text-red-300 text-sm">{errors.map(e => <li key={e.field}>{e.field}: {e.message}</li>)}</ul>}
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
      <div className="flex shrink-0 justify-end gap-2 border-t border-slate-700 bg-slate-900 p-4"><button disabled={loading} onClick={handleReset}>Reset</button><button disabled={loading} onClick={handleSave}>Save</button></div>
    </div>
  </div>
}
