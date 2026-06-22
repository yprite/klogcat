import { useEffect, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { defaultSettings } from '../config/defaultSettings'
import { validateSettings } from '../config/validateSettings'
import type { PersistedSettings } from '../types/settings'
import { sourceLabels, sourceTypes } from '../utils/sourceLabels'

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, saveSettings, resetSettings, error, loading } = useSettingsStore()
  const [draft, setDraft] = useState<PersistedSettings>(settings ?? defaultSettings)
  const [notice, setNotice] = useState<string>()
  useEffect(() => { setDraft(settings ?? defaultSettings); setNotice(undefined) }, [settings, open])
  if (!open) return null
  const errors = validateSettings(draft)
  const setNum = (key: 'initialTailLines' | 'bufferLimit', value: string) => { setNotice(undefined); setDraft({ ...draft, [key]: Number(value) }) }
  const handleReset = async () => {
    setNotice(undefined)
    const ok = await resetSettings()
    if (ok) {
      const saved = useSettingsStore.getState().settings ?? defaultSettings
      setDraft(saved)
      setNotice('Settings reset to defaults')
    }
  }
  const handleSave = async () => {
    setNotice(undefined)
    const ok = await saveSettings(draft)
    if (ok) onClose()
  }
  return <div className="fixed inset-0 bg-black/60 grid place-items-center z-10"><div className="bg-slate-900 border border-slate-700 rounded p-4 w-[720px] max-w-[95vw] space-y-3">
    <div className="flex justify-between"><h2 className="text-lg font-bold">Settings</h2><button onClick={onClose}>✕</button></div>
    <label className="block">Initial tail lines <input className="text-black ml-2" type="number" value={draft.initialTailLines} onChange={e=>setNum('initialTailLines', e.target.value)} /></label>
    <label className="block">Buffer limit <input className="text-black ml-2" type="number" value={draft.bufferLimit} onChange={e=>setNum('bufferLimit', e.target.value)} /></label>
    {sourceTypes.map((type) => <fieldset className="border border-slate-700 p-2" key={type}><legend>{sourceLabels[type]}</legend>
      <label>Container <input className="text-black mx-2" value={draft.logSources[type].container} onChange={e=>setDraft({ ...draft, logSources: { ...draft.logSources, [type]: { ...draft.logSources[type], container: e.target.value } } })} /></label>
      <label>File path <input className="text-black mx-2 w-80" value={draft.logSources[type].filePath} onChange={e=>setDraft({ ...draft, logSources: { ...draft.logSources, [type]: { ...draft.logSources[type], filePath: e.target.value } } })} /></label>
    </fieldset>)}
    {errors.length > 0 && <ul className="text-red-300 text-sm">{errors.map(e => <li key={e.field}>{e.field}: {e.message}</li>)}</ul>}
    {notice && <p className="text-green-300">{notice}</p>}
    {error && <p className="text-red-300">{error.message}</p>}
    <div className="flex gap-2 justify-end"><button disabled={loading} onClick={handleReset}>Reset</button><button disabled={loading || errors.length > 0} onClick={handleSave}>Save</button></div>
  </div></div>
}
