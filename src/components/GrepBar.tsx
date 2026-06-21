import { useLogStore } from '../stores/logStore'

export function GrepBar() {
  const { grepQuery, setGrepQuery } = useLogStore()
  return <label className="flex-1">Grep <input className="text-black w-full max-w-xl" value={grepQuery} onChange={e => setGrepQuery(e.target.value)} placeholder="raw-line substring" /></label>
}
