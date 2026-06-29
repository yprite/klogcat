import { useMemo, useState } from 'react'
import type { ParsedLogLine } from '../types/log'
import { analyzeIncidentRows, copyIncidentSummary } from '../utils/incidentTriage'

export function IncidentTriagePanel({ rows }: { rows: ParsedLogLine[] }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const result = useMemo(() => analyzeIncidentRows(rows), [rows])
  const summary = useMemo(() => copyIncidentSummary(result), [result])
  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summary)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return <section role="region" aria-label="Incident triage" className="rounded border border-slate-800 bg-slate-950/60 p-2">
    <div className="mb-2 flex items-center justify-between gap-2">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Incident triage</h3>
        <p className="mt-1 text-xs text-slate-500">Raw Logs remain source of truth</p>
      </div>
      <button type="button" className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-100 hover:bg-slate-800" aria-label="Copy redacted incident summary" onClick={() => void copySummary()}>Copy summary</button>
    </div>
    <div className="mb-2 flex items-center gap-2 text-xs">
      <span className="rounded border border-slate-800 bg-slate-900 px-2 py-1 text-slate-100">{result.findings.length} findings</span>
      <span className="rounded border border-slate-800 bg-slate-900 px-2 py-1 text-slate-100">{rows.length} rows scanned</span>
      {copyState === 'copied' && <span className="text-emerald-300">Copied</span>}
      {copyState === 'failed' && <span className="text-red-300">Copy failed</span>}
    </div>
    {result.findings.length > 0 ? <ul className="space-y-1 text-xs">
      {result.findings.slice(0, 3).map((finding) => <li key={`${finding.ruleId}-${finding.evidenceRefs.map((ref) => ref.rowId).join('-')}`} className="rounded border border-slate-800 bg-slate-900 px-2 py-1">
        <span className={finding.severity === 'critical' ? 'text-red-300' : 'text-yellow-300'}>{finding.title}</span>
        {finding.durationMs !== undefined && <span className="ml-2 text-slate-400">{finding.durationMs}ms</span>}
      </li>)}
    </ul> : <div className="rounded border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-300">
      <p>No finding: {result.noFindingExplanation?.reason ?? 'unknown'}</p>
      {(result.noFindingExplanation?.blindSpots.length ?? 0) > 0 && <p className="mt-1 text-yellow-300">Blind spots: {result.noFindingExplanation?.blindSpots.join(', ')}</p>}
    </div>}
  </section>
}
