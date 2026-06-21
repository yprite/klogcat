import type { ParsedLogLine } from '../types/log'
import { formatDisplayTime } from '../utils/formatTime'
import { highlightText } from '../utils/highlight'
import { sourceLabels } from '../utils/sourceLabels'

export function LogRow({ row, grepQuery }: { row: ParsedLogLine; grepQuery: string }) {
  const time = formatDisplayTime(row)
  let mid = ''
  if (row.parseStatus === 'raw') mid = row.raw
  else if (row.sourceType === 'access') mid = [row.status, row.method, row.url, row.elapsed !== undefined ? `${row.elapsed}ms` : undefined, row.summary, row.trId].filter(Boolean).join(' ')
  else if (row.sourceType === 'error') mid = [row.jsonLogType, row.errorMethod, row.errorPath, row.errorReason ?? row.summary, row.trId ?? row.traceId].filter(Boolean).join(' ')
  else mid = [row.jsonLogType, row.summary, row.trId].filter(Boolean).join(' ')
  return <div className="px-2 py-1 whitespace-nowrap overflow-hidden text-ellipsis border-b border-slate-900" title={row.raw}>
    <span className="text-slate-400">{time}</span> <span className="font-bold text-blue-300">{sourceLabels[row.sourceType]}</span> <span>{highlightText(mid, grepQuery)}</span>
  </div>
}
