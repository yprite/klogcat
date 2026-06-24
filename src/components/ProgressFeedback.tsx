export function ActivityDots({ label = 'Working' }: { label?: string }) {
  return <span aria-label={label} className="inline-flex items-center gap-1">
    <span className="h-1.5 w-1.5 animate-klogcat-dot rounded-full bg-yellow-300 [animation-delay:-0.32s]" />
    <span className="h-1.5 w-1.5 animate-klogcat-dot rounded-full bg-yellow-300 [animation-delay:-0.16s]" />
    <span className="h-1.5 w-1.5 animate-klogcat-dot rounded-full bg-yellow-300" />
  </span>
}

export function ProgressStripe({ label = 'In progress' }: { label?: string }) {
  return <span aria-label={label} className="relative block h-1.5 overflow-hidden rounded-full bg-slate-800">
    <span className="absolute inset-y-0 left-0 w-1/2 animate-klogcat-progress rounded-full bg-gradient-to-r from-yellow-500 via-yellow-200 to-emerald-300" />
  </span>
}

export function ActivityRing({ label = 'Loading' }: { label?: string }) {
  return <span aria-label={label} className="relative inline-flex h-4 w-4 items-center justify-center">
    <span className="absolute h-4 w-4 animate-ping rounded-full bg-yellow-300/25" />
    <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-yellow-300" />
  </span>
}

export function AnimatedStatusPill({ active, label, detail }: { active: boolean; label: string; detail?: string }) {
  return <span role={active ? 'status' : undefined} aria-label={active ? label : undefined} className={`relative inline-flex items-center gap-2 overflow-hidden rounded-full border px-3 py-1 text-xs font-medium ${active ? 'animate-klogcat-status-glow border-yellow-400/70 bg-yellow-400/10 text-yellow-100' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>
    {active && <span className="absolute inset-0 animate-klogcat-sheen bg-gradient-to-r from-transparent via-yellow-200/20 to-transparent" />}
    <span className="relative inline-flex items-center gap-2">
      {active && <ActivityRing label={`${label} activity`} />}
      <span>{label}</span>
      {detail && <span className="text-slate-400">{detail}</span>}
      {active && <ActivityDots label={`${label} progress`} />}
    </span>
  </span>
}
