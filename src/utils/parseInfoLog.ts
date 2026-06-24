import type { SourceMeta } from '../types/log'
import type { ParsedLogLineWithoutId } from './parserHelpers'
import { base, nonEmptySummary, num, rec, str } from './parserHelpers'

export function parseInfoLog(json: unknown, raw: string, sourceMeta: SourceMeta, receivedAt: number): ParsedLogLineWithoutId {
  const j = rec(json) ?? {}
  const body = rec(j.body) ?? {}
  let bodySummary: string | undefined
  if (typeof j.body === 'string') bodySummary = j.body
  else if (j.body !== undefined) {
    try { bodySummary = JSON.stringify(j.body) } catch { bodySummary = String(j.body) }
  }
  const message = str(j.message)
  const status = str(j.status)
  const elapsed = num(j.elapsed)
  const rcode = str(body.rcode), rmsg = str(body.rmsg), exceptionName = str(body.exceptionName), apiName = str(body.api_name)
  const accessSummary = nonEmptySummary([str(j.method), str(j.url), status, elapsed !== undefined ? `${elapsed}ms` : undefined, rcode ? `rcode=${rcode}` : undefined, exceptionName ? `exception=${exceptionName}` : undefined, apiName ? `api=${apiName}` : undefined, rmsg], '')
  return {
    ...base(j, raw, sourceMeta, receivedAt),
    message,
    method: str(j.method), url: str(j.url), status, elapsed, length: num(j.length), pSpanId: str(j.pSpanId), spanId: str(j.spanId), srcIp: str(j.srcIp), userId: str(j.userId), appId: str(j.appId), rcode, rmsg, exceptionName, apiName,
    summary: accessSummary || message || bodySummary || str(j.logType) || raw,
  }
}
