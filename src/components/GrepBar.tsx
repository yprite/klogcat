import { useLogStore } from '../stores/logStore'
import { isValidGrepRegex } from '../utils/grep'
import { validateLogQuery } from '../utils/logQuery'

export function GrepBar() {
  const { grepQuery, grepMode, setGrepQuery, setGrepMode } = useLogStore()
  const regexMode = grepMode === 'regex'
  const queryValidation = regexMode ? undefined : validateLogQuery(grepQuery)
  const regexValid = !regexMode || isValidGrepRegex(grepQuery)
  const valid = regexMode ? regexValid : queryValidation?.ok !== false
  const invalidMessage = regexMode ? 'invalid regex' : queryValidation?.ok === false ? queryValidation.message : undefined
  return <div className="flex flex-1 items-end gap-2">
    <label className="flex-1">Query <input aria-invalid={!valid} className={`text-black w-full max-w-xl ${valid ? '' : 'outline outline-2 outline-red-500'}`} value={grepQuery} onChange={e => setGrepQuery(e.target.value)} placeholder={regexMode ? 'raw-line regex' : 'message text, status:500, source:error, -pod:foo, url~:/api/.*'} /></label>
    <button type="button" aria-pressed={regexMode} onClick={() => setGrepMode(regexMode ? 'substring' : 'regex')} className={`rounded border px-2 py-1 text-xs font-semibold ${regexMode ? 'border-yellow-300 bg-yellow-300 text-black' : 'border-slate-600 bg-slate-800 text-slate-200'}`}>Regex</button>
    {!valid && <span className="pb-1 text-xs text-red-300">{invalidMessage}</span>}
  </div>
}
