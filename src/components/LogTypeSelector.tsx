import type { SourceLogType } from '../types/log'
import { sourceLabels, sourceTypes } from '../utils/sourceLabels'

export function LogTypeSelector({ value, onChange }: { value: SourceLogType; onChange: (value: SourceLogType) => void }) {
  return <div className="flex gap-1">{sourceTypes.map(t => <button key={t} className={value === t ? 'bg-blue-700 px-3 py-1 rounded' : 'bg-slate-700 px-3 py-1 rounded'} onClick={() => onChange(t)}>{sourceLabels[t]}</button>)}</div>
}
