import type { SourceMeta } from '../types/log'
import { defaultLogPolicy, type LogPolicy } from './logPolicy'
import type { ParsedLogLineWithoutId } from './parserHelpers'
import { base, nonEmptySummary, rec, strField } from './parserHelpers'

export function parseErrorLog(json: unknown, raw: string, sourceMeta: SourceMeta, receivedAt: number, policy: LogPolicy = defaultLogPolicy): ParsedLogLineWithoutId {
  const j = rec(json) ?? {}
  const p = policy.parser.error
  const traceId = strField(j, p.traceId)
  const errorMethod = strField(j, p.errorMethod), errorPath = strField(j, p.errorPath), errorReason = strField(j, p.errorReason)
  return {
    ...base(j, raw, sourceMeta, receivedAt, policy),
    traceId,
    trId: strField(j, policy.parser.base.trId) ?? traceId,
    errorReason,
    errorMethod,
    errorPath,
    errorServerName: strField(j, p.errorServerName),
    errorTimestamp: strField(j, p.errorTimestamp),
    summary: nonEmptySummary([errorReason, errorMethod, errorPath, strField(j, policy.parser.base.logger)], raw),
  }
}
