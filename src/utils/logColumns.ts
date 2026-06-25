import type { ParsedLogLine, SourceLogType, LogColumnKey } from '../types/log'
import { columnsForSourceFromPolicy, getLogPolicy, labelForColumnFromPolicy } from './logPolicy'

export type { LogColumnKey } from '../types/log'
export const accessLogColumns = [...getLogPolicy().sources.access.columns]
export const errorLogColumns = [...getLogPolicy().sources.error.columns]

export function columnsForSource(sourceType: SourceLogType): LogColumnKey[] {
  return columnsForSourceFromPolicy(getLogPolicy(), sourceType)
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
  return labelForColumnFromPolicy(getLogPolicy(), key)
}
