import type { SourceLogType, SourceMeta } from '../types/log'
import { getLogPolicy, type LogPolicy } from './logPolicy'
import { parseAccessLog } from './parseAccessLog'
import { parseInfoLog } from './parseInfoLog'
import { parseErrorLog } from './parseErrorLog'
import type { ParsedLogLineWithoutId } from './parserHelpers'

export function parseLogLine(raw: string, sourceType: SourceLogType, sourceMeta: SourceMeta, receivedAt: number, policy: LogPolicy = getLogPolicy()): ParsedLogLineWithoutId {
  try {
    const json = JSON.parse(raw)
    if (sourceType === 'access') return parseAccessLog(json, raw, sourceMeta, receivedAt, policy)
    if (sourceType === 'error') return parseErrorLog(json, raw, sourceMeta, receivedAt, policy)
    return parseInfoLog(json, raw, sourceMeta, receivedAt, policy)
  } catch {
    return { ...sourceMeta, raw, parseStatus: 'raw', receivedAt, summary: raw }
  }
}
