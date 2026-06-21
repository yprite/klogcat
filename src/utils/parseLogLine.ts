import type { SourceLogType, SourceMeta } from '../types/log'
import { parseAccessLog } from './parseAccessLog'
import { parseAppLog } from './parseAppLog'
import { parseErrorLog } from './parseErrorLog'
import type { ParsedLogLineWithoutId } from './parserHelpers'

export function parseLogLine(raw: string, sourceType: SourceLogType, sourceMeta: SourceMeta, receivedAt: number): ParsedLogLineWithoutId {
  try {
    const json = JSON.parse(raw)
    if (sourceType === 'access') return parseAccessLog(json, raw, sourceMeta, receivedAt)
    if (sourceType === 'error') return parseErrorLog(json, raw, sourceMeta, receivedAt)
    return parseAppLog(json, raw, sourceMeta, receivedAt)
  } catch {
    return { ...sourceMeta, raw, parseStatus: 'raw', receivedAt, summary: raw }
  }
}
