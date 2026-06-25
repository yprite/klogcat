export type InvestigationMode = 'raw' | 'failed'

const modes: Array<{ value: InvestigationMode; label: string; description: string }> = [
  { value: 'raw', label: 'Raw Logs', description: 'Source-of-truth log stream' },
  { value: 'failed', label: 'Failed Requests', description: 'trId-based failure investigation' },
]

export function InvestigationModeSelector({ value, onChange }: { value: InvestigationMode; onChange: (mode: InvestigationMode) => void }) {
  return <div className="flex shrink-0 items-center justify-between gap-3 rounded border border-slate-800 bg-slate-950 px-2 py-1" aria-label="Investigation mode selector">
    <div role="tablist" aria-label="Investigation mode" className="flex items-center gap-1">
      {modes.map((mode) => {
        const selected = value === mode.value
        return <button
          key={mode.value}
          type="button"
          role="tab"
          aria-selected={selected}
          className={`rounded px-3 py-1 text-xs font-semibold transition ${selected ? 'bg-yellow-300 text-slate-950' : 'border border-slate-700 bg-slate-900 text-slate-200 hover:border-yellow-300 hover:text-yellow-200'}`}
          onClick={() => onChange(mode.value)}
        >
          {mode.label}
        </button>
      })}
    </div>
    <span className="hidden text-[11px] text-slate-400 sm:inline">{modes.find((mode) => mode.value === value)?.description}</span>
  </div>
}
