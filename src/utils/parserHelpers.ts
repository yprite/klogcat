import type { ParsedLogLine, SourceMeta } from '../types/log'

export type ParsedLogLineWithoutId = Omit<ParsedLogLine, 'id'>
export function str(v: unknown): string | undefined { return typeof v === 'string' ? v : v == null ? undefined : String(v) }
export function num(v: unknown): number | undefined { if (typeof v === 'number' && Number.isFinite(v)) return v; if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v); return undefined }
export function rec(v: unknown): Record<string, unknown> | undefined { return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : undefined }
export function compactJson(v: unknown): string | undefined { if (v === undefined || v === null || v === '') return undefined; return typeof v === 'string' ? v : JSON.stringify(v) }
export function base(json: Record<string, unknown>, raw: string, meta: SourceMeta, receivedAt: number): ParsedLogLineWithoutId {
  const level = str(json.level) || str(json.severity) || str(json.logLevel) || str(json.priority)
  return { ...meta, raw, parseStatus: 'parsed', timestamp: str(json.time), epochTime: num(json.epochTime), receivedAt, jsonLogType: str(json.logType), level, host: str(json.host), service: str(json.service), serviceId: str(json.serviceId), module: str(json.module), submodule: str(json.submodule), trId: str(json.trId), logger: str(json.logger), thread: str(json.thread), body: compactJson(json.body), summary: raw }
}
export function nonEmptySummary(parts: Array<string | undefined>, fallback: string): string {
  const joined = parts.filter((p): p is string => !!p && p.trim() !== '').join(' ')
  return joined || fallback
}
