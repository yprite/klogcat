import type { ParsedLogLine, SourceLogType } from '../types/log'

export const accessLogColumns = ['timestamp', 'jsonLogType', 'host', 'service', 'module', 'serviceId', 'trId', 'epochTime', 'pSpanId', 'spanId', 'method', 'url', 'length', 'srcIp', 'elapsed', 'status', 'userId', 'appId', 'body', 'rcode', 'rmsg', 'exceptionName', 'apiName'] as const
export const errorLogColumns = ['timestamp', 'jsonLogType', 'host', 'logger', 'service', 'module', 'submodule', 'trId', 'epochTime', 'thread', 'body', 'errorServerName', 'errorPath', 'errorMethod', 'errorTimestamp', 'traceId', 'errorReason'] as const
export type LogColumnKey = typeof accessLogColumns[number] | typeof errorLogColumns[number]

export function columnsForSource(sourceType: SourceLogType): LogColumnKey[] {
  if (sourceType === 'info') return [...accessLogColumns]
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

export function labelForColumn(key: LogColumnKey) {
  const labels: Partial<Record<LogColumnKey, string>> = {
    timestamp: 'time',
    jsonLogType: 'logType',
    apiName: 'api_name',
    errorServerName: 'errorDetails.serverName',
    errorPath: 'errorDetails.path',
    errorMethod: 'errorDetails.method',
    errorTimestamp: 'errorDetails.timestamp',
    errorReason: 'errorDetails.errors.reason',
  }
  return labels[key] ?? key
}
