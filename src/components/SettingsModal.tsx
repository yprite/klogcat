import { useEffect, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useLogStore } from '../stores/logStore'
import { useKubeStore } from '../stores/kubeStore'
import { defaultSettings } from '../config/defaultSettings'
import { validateSettings } from '../config/validateSettings'
import type { PersistedSettings } from '../types/settings'
import { sourceLabelsForActivePolicy, sourceTypesForActivePolicy } from '../utils/sourceLabels'
import { buildLogPathTemplateFromPolicy, getLogPolicy } from '../utils/logPolicy'

export function SettingsModal({ open, onClose, onRestart = () => window.location.reload() }: { open: boolean; onClose: () => void; onRestart?: () => void }) {
  const { settings, saveSettings, resetSettings, error, loading } = useSettingsStore()
  const recordActionDebug = useLogStore((s) => s.recordActionDebug)
  const [draft, setDraft] = useState<PersistedSettings>(settings ?? defaultSettings)
  const [notice, setNotice] = useState<string>()
  useEffect(() => { setDraft(settings ?? defaultSettings); setNotice(undefined) }, [settings, open])
  if (!open) return null
  const errors = validateSettings(draft)
  const sourceTypes = sourceTypesForActivePolicy()
  const sourceLabels = sourceLabelsForActivePolicy()
  const setNum = (key: 'initialTailLines' | 'bufferLimit', value: string) => { setNotice(undefined); setDraft({ ...draft, [key]: Number(value) }) }
  const handleReset = async () => {
    recordActionDebug('Reset clicked')
    setNotice(undefined)
    const ok = await resetSettings()
    if (ok) {
      const saved = useSettingsStore.getState().settings ?? defaultSettings
      setDraft(saved)
      setNotice('Settings reset to defaults')
    }
  }
  const handleSave = async () => {
    recordActionDebug(`Save clicked: validationErrors=${errors.length}`)
    setNotice(undefined)
    const ok = await saveSettings(draft)
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
  return <div className="fixed inset-0 bg-black/60 grid place-items-center z-10"><div className="bg-slate-900 border border-slate-700 rounded p-4 w-[720px] max-w-[95vw] space-y-3">
    <div className="flex justify-between"><h2 className="text-lg font-bold">Settings</h2><button onClick={() => { recordActionDebug('Settings close clicked'); onClose() }}>✕</button></div>
    <label className="block">Initial tail lines <input className="text-black ml-2" type="number" value={draft.initialTailLines} onChange={e=>setNum('initialTailLines', e.target.value)} /></label>
    <label className="block">Buffer limit <input className="text-black ml-2" type="number" value={draft.bufferLimit} onChange={e=>setNum('bufferLimit', e.target.value)} /></label>
    {sourceTypes.map((type) => <fieldset className="border border-slate-700 p-2" key={type}><legend>{sourceLabels[type]}</legend>
      <label>Container <input className="text-black mx-2" value={draft.logSources[type].container} onChange={e=>setDraft({ ...draft, logSources: { ...draft.logSources, [type]: { ...draft.logSources[type], container: e.target.value } } })} /></label>
      <span className="text-slate-300 text-sm">Fixed path: {buildLogPathTemplateFromPolicy(getLogPolicy(), type)}</span>
    </fieldset>)}
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
    <div className="flex gap-2 justify-end"><button disabled={loading} onClick={handleReset}>Reset</button><button disabled={loading} onClick={handleSave}>Save</button></div>
  </div></div>
}
