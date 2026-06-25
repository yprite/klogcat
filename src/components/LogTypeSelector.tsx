import type { SourceLogType } from '../types/log'
import { sourceLabelsForActivePolicy, sourceTypesForActivePolicy } from '../utils/sourceLabels'

const activeClass = 'bg-blue-700 px-3 py-1 rounded'
const inactiveClass = 'bg-slate-700 px-3 py-1 rounded'

export function LogTypeSelector({ value, onChange }: { value: SourceLogType[]; onChange: (value: SourceLogType[]) => void }) {
  const sourceTypes = sourceTypesForActivePolicy()
  const sourceLabels = sourceLabelsForActivePolicy()
  const selected = new Set(value)
  const allSelected = sourceTypes.every((type) => selected.has(type))
  const toggleAll = () => onChange(allSelected ? [] : [...sourceTypes])
  const toggleType = (type: SourceLogType) => {
    if (selected.has(type)) onChange(value.filter((selectedType) => selectedType !== type))
    else onChange(sourceTypes.filter((sourceType) => sourceType === type || selected.has(sourceType)))
  }

  return <div className="flex gap-1">
    <button className={allSelected ? activeClass : inactiveClass} onClick={toggleAll}>ALL</button>
    {sourceTypes.map((type) => <button key={type} className={selected.has(type) ? activeClass : inactiveClass} onClick={() => toggleType(type)}>{sourceLabels[type]}</button>)}
  </div>
}
