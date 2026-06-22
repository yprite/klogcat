import type { ParsedLogLine, SourceLogType } from '../types/log'

export const accessLogColumns = ['method', 'url', 'status', 'elapsed', 'length', 'srcIp', 'userId', 'appId', 'rcode', 'rmsg', 'exceptionName', 'apiName', 'trId'] as const
export const errorLogColumns = ['errorMethod', 'errorPath', 'errorReason', 'errorServerName', 'errorTimestamp', 'traceId', 'trId', 'logger'] as const
export type LogColumnKey = typeof accessLogColumns[number] | typeof errorLogColumns[number]

export function columnsForSource(sourceType: SourceLogType): LogColumnKey[] {
  if (sourceType === 'access') return [...accessLogColumns]
  if (sourceType === 'error') return [...errorLogColumns]
  return []
}

export function columnsForRows(rows: ParsedLogLine[]): LogColumnKey[] {
  const keys = new Set<LogColumnKey>()
  for (const row of rows) columnsForSource(row.sourceType).forEach((key) => keys.add(key))
  return [...keys]
}

export function valueForColumn(row: ParsedLogLine, key: LogColumnKey) {
  const value = row[key as keyof ParsedLogLine]
  if (value === undefined || value === null || value === '') return ''
  return key === 'elapsed' && typeof value === 'number' ? `${value}ms` : String(value)
}
