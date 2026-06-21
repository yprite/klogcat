import type { SourceMeta } from '../types/log'
import type { ParsedLogLineWithoutId } from './parserHelpers'
import { base, nonEmptySummary, rec, str } from './parserHelpers'

export function parseErrorLog(json: unknown, raw: string, sourceMeta: SourceMeta, receivedAt: number): ParsedLogLineWithoutId {
  const j = rec(json) ?? {}
  const details = rec(rec(j.body)?.errorDetails) ?? {}
  const errors = Array.isArray(details.errors) ? details.errors : []
  const firstError = rec(errors[0])
  const traceId = str(details.traceId)
  const errorMethod = str(details.method), errorPath = str(details.path), errorReason = str(firstError?.reason)
  return {
    ...base(j, raw, sourceMeta, receivedAt),
    traceId,
    trId: str(j.trId) ?? traceId,
    errorReason,
    errorMethod,
    errorPath,
    errorServerName: str(details.serverName),
    errorTimestamp: str(details.timestamp),
    summary: nonEmptySummary([errorReason, errorMethod, errorPath, str(j.logger)], raw),
  }
}
