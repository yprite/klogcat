import { useLogStore } from '../stores/logStore'
import { isValidGrepRegex } from '../utils/grep'

export function GrepBar() {
  const { grepQuery, grepMode, setGrepQuery, setGrepMode } = useLogStore()
  const regexMode = grepMode === 'regex'
  const regexValid = !regexMode || isValidGrepRegex(grepQuery)
  return <div className="flex flex-1 items-end gap-2">
    <label className="flex-1">Grep <input aria-invalid={!regexValid} className={`text-black w-full max-w-xl ${regexValid ? '' : 'outline outline-2 outline-red-500'}`} value={grepQuery} onChange={e => setGrepQuery(e.target.value)} placeholder={regexMode ? 'raw-line regex' : 'raw-line substring'} /></label>
    <button type="button" aria-pressed={regexMode} onClick={() => setGrepMode(regexMode ? 'substring' : 'regex')} className={`rounded border px-2 py-1 text-xs font-semibold ${regexMode ? 'border-yellow-300 bg-yellow-300 text-black' : 'border-slate-600 bg-slate-800 text-slate-200'}`}>Regex</button>
    {!regexValid && <span className="pb-1 text-xs text-red-300">invalid regex</span>}
  </div>
}
