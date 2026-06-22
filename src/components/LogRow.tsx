import type { ParsedLogLine } from '../types/log'
import { formatDisplayTime } from '../utils/formatTime'
import { highlightText } from '../utils/highlight'
import { type LogColumnKey, valueForColumn } from '../utils/logColumns'
import { sourceLabels } from '../utils/sourceLabels'

export function LogRow({ row, grepQuery, visibleColumns }: { row: ParsedLogLine; grepQuery: string; visibleColumns?: LogColumnKey[] }) {
  const time = formatDisplayTime(row)
  const hasColumnView = row.parseStatus === 'parsed' && row.sourceType !== 'app' && visibleColumns && visibleColumns.length > 0
  let mid = ''
  if (row.parseStatus === 'raw') mid = row.raw
  else if (row.sourceType === 'access') mid = [row.status, row.method, row.url, row.elapsed !== undefined ? `${row.elapsed}ms` : undefined, row.summary, row.trId].filter(Boolean).join(' ')
  else if (row.sourceType === 'error') mid = [row.jsonLogType, row.errorMethod, row.errorPath, row.errorReason ?? row.summary, row.trId ?? row.traceId].filter(Boolean).join(' ')
  else mid = [row.jsonLogType, row.summary, row.trId].filter(Boolean).join(' ')
  return <div className="px-2 py-1 whitespace-nowrap border-b border-slate-900 min-w-max" title={row.raw}>
    <span className="inline-block min-w-28 text-slate-400">{time}</span> <span className="inline-block min-w-12 font-bold text-blue-300">{sourceLabels[row.sourceType]}</span>
    <span className="inline-block min-w-24 pr-2 text-slate-400">{row.namespace}/{row.pod}</span>
    {hasColumnView ? <span className="inline-flex gap-2 align-top">
      {visibleColumns.map((key) => {
        const value = valueForColumn(row, key)
        return <span key={key} className="inline-block w-max min-w-24 border-l border-slate-800 pl-2 pr-2 align-top">
          <span className="block text-[10px] uppercase text-slate-500">{key}</span>
          <span>{highlightText(value || '-', grepQuery)}</span>
        </span>
      })}
    </span> : <span className="inline-block w-max pr-2">{highlightText(mid, grepQuery)}</span>}
  </div>
}
