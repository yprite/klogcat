import type { SourceMeta } from '../types/log'
import type { ParsedLogLineWithoutId } from './parserHelpers'
import { base, nonEmptySummary, num, rec, str } from './parserHelpers'

export function parseAccessLog(json: unknown, raw: string, sourceMeta: SourceMeta, receivedAt: number): ParsedLogLineWithoutId {
  const j = rec(json) ?? {}
  const body = rec(j.body) ?? {}
  const status = str(j.status)
  const elapsed = num(j.elapsed)
  const rcode = str(body.rcode), rmsg = str(body.rmsg), exceptionName = str(body.exceptionName), apiName = str(body.api_name)
  return {
    ...base(j, raw, sourceMeta, receivedAt),
    method: str(j.method), url: str(j.url), status, elapsed, length: num(j.length), pSpanId: str(j.pSpanId), spanId: str(j.spanId), srcIp: str(j.srcIp), userId: str(j.userId), appId: str(j.appId), rcode, rmsg, exceptionName, apiName,
    summary: nonEmptySummary([str(j.method), str(j.url), status, elapsed !== undefined ? `${elapsed}ms` : undefined, rcode ? `rcode=${rcode}` : undefined, exceptionName ? `exception=${exceptionName}` : undefined, apiName ? `api=${apiName}` : undefined, rmsg], raw),
  }
}
