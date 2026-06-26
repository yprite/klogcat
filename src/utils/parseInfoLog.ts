import type { SourceMeta } from '../types/log'
import { getLogPolicy, type LogPolicy } from './logPolicy'
import type { ParsedLogLineWithoutId } from './parserHelpers'
import { base, field, nonEmptySummary, numField, rec, strField } from './parserHelpers'

function bodySummaryFrom(body: unknown) {
  if (typeof body === 'string') return body
  if (body === undefined) return undefined
  try { return JSON.stringify(body) } catch { return String(body) }
}

export function parseInfoLog(json: unknown, raw: string, sourceMeta: SourceMeta, receivedAt: number, policy: LogPolicy = getLogPolicy()): ParsedLogLineWithoutId {
  const j = rec(json) ?? {}
  const body = field(j, policy.parser.base.body)
  const bodySummary = bodySummaryFrom(body)
  const access = policy.parser.access
  const message = strField(j, policy.parser.info.message)
  const status = strField(j, access.status)
  const elapsed = numField(j, access.elapsed)
  const rcode = strField(j, access.rcode), rmsg = strField(j, access.rmsg), exceptionName = strField(j, access.exceptionName), apiName = strField(j, access.apiName)
  const method = strField(j, access.method), url = strField(j, access.url)
  const accessSummary = nonEmptySummary([method, url, status, elapsed !== undefined ? `${elapsed}ms` : undefined, rcode ? `rcode=${rcode}` : undefined, exceptionName ? `exception=${exceptionName}` : undefined, apiName ? `api=${apiName}` : undefined, rmsg], '')
  return {
    ...base(j, raw, sourceMeta, receivedAt, policy),
    message,
    method, url, status, elapsed, length: numField(j, access.length), pSpanId: strField(j, access.pSpanId), spanId: strField(j, access.spanId), srcIp: strField(j, access.srcIp), userId: strField(j, access.userId), appId: strField(j, access.appId), rcode, rmsg, exceptionName, apiName,
    summary: accessSummary || message || bodySummary || strField(j, policy.parser.base.jsonLogType) || raw,
  }
}
