import type { SourceMeta } from '../types/log'
import type { ParsedLogLineWithoutId } from './parserHelpers'
import { base, nonEmptySummary, rec, str } from './parserHelpers'

export function parseAppLog(json: unknown, raw: string, sourceMeta: SourceMeta, receivedAt: number): ParsedLogLineWithoutId {
  const j = rec(json) ?? {}
  const body = j.body
  let bodySummary: string | undefined
  if (typeof body === 'string') bodySummary = body
  else if (body !== undefined) {
    try { bodySummary = JSON.stringify(body) } catch { bodySummary = String(body) }
  }
  const message = str(j.message)
  return { ...base(j, raw, sourceMeta, receivedAt), message, summary: message || bodySummary || str(j.logType) || raw }
}
