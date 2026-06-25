import type { SourceMeta } from '../types/log'
import { defaultLogPolicy, type LogPolicy } from './logPolicy'
import type { ParsedLogLineWithoutId } from './parserHelpers'
import { base, nonEmptySummary, numField, rec, strField } from './parserHelpers'

export function parseAccessLog(json: unknown, raw: string, sourceMeta: SourceMeta, receivedAt: number, policy: LogPolicy = defaultLogPolicy): ParsedLogLineWithoutId {
  const j = rec(json) ?? {}
  const p = policy.parser.access
  const status = strField(j, p.status)
  const elapsed = numField(j, p.elapsed)
  const rcode = strField(j, p.rcode), rmsg = strField(j, p.rmsg), exceptionName = strField(j, p.exceptionName), apiName = strField(j, p.apiName)
  const method = strField(j, p.method), url = strField(j, p.url)
  return {
    ...base(j, raw, sourceMeta, receivedAt, policy),
    method, url, status, elapsed, length: numField(j, p.length), pSpanId: strField(j, p.pSpanId), spanId: strField(j, p.spanId), srcIp: strField(j, p.srcIp), userId: strField(j, p.userId), appId: strField(j, p.appId), rcode, rmsg, exceptionName, apiName,
    summary: nonEmptySummary([method, url, status, elapsed !== undefined ? `${elapsed}ms` : undefined, rcode ? `rcode=${rcode}` : undefined, exceptionName ? `exception=${exceptionName}` : undefined, apiName ? `api=${apiName}` : undefined, rmsg], raw),
  }
}
