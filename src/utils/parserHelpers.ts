import type { ParsedLogLine, SourceMeta } from '../types/log'
import { fieldPathValueFromPolicy, getLogPolicy, type FieldPath, type LogPolicy } from './logPolicy'

export type ParsedLogLineWithoutId = Omit<ParsedLogLine, 'id'>
export function str(v: unknown): string | undefined { return typeof v === 'string' ? v : v == null ? undefined : String(v) }
export function num(v: unknown): number | undefined { if (typeof v === 'number' && Number.isFinite(v)) return v; if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v); return undefined }
export function rec(v: unknown): Record<string, unknown> | undefined { return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : undefined }
export function compactJson(v: unknown): string | undefined { if (v === undefined || v === null || v === '') return undefined; return typeof v === 'string' ? v : JSON.stringify(v) }
export function field(json: unknown, path: FieldPath): unknown { return fieldPathValueFromPolicy(json, path) }
export function strField(json: unknown, path: FieldPath): string | undefined { return str(field(json, path)) }
export function numField(json: unknown, path: FieldPath): number | undefined { return num(field(json, path)) }
export function base(json: Record<string, unknown>, raw: string, meta: SourceMeta, receivedAt: number, policy: LogPolicy = getLogPolicy()): ParsedLogLineWithoutId {
  const p = policy.parser.base
  const level = p.levelCandidates.map((candidate) => strField(json, candidate)).find(Boolean)
  return {
    ...meta,
    raw,
    parseStatus: 'parsed',
    timestamp: strField(json, p.timestamp),
    epochTime: numField(json, p.epochTime),
    receivedAt,
    jsonLogType: strField(json, p.jsonLogType),
    level,
    host: strField(json, p.host),
    service: strField(json, p.service),
    serviceId: strField(json, p.serviceId),
    module: strField(json, p.module),
    submodule: strField(json, p.submodule),
    trId: strField(json, p.trId),
    logger: strField(json, p.logger),
    thread: strField(json, p.thread),
    body: compactJson(field(json, p.body)),
    summary: raw,
  }
}
export function nonEmptySummary(parts: Array<string | undefined>, fallback: string): string {
  const joined = parts.filter((p): p is string => !!p && p.trim() !== '').join(' ')
  return joined || fallback
}
