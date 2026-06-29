import type { ParsedLogLine } from '../types/log'
import { redactEvidenceText } from './investigationBundle'

export type AiAnalysisRequest = {
  requestId: string
  status: 'queued'
  rows: Array<{ rowId: number; raw: string }>
}

export type AiFindingResult = { title: string; evidenceRowIds: number[] }

export function createAiAnalysisRequest(rows: ParsedLogLine[], selectedRowIds: number[]): AiAnalysisRequest {
  const selected = new Set(selectedRowIds)
  return {
    requestId: `ai-${selectedRowIds.join('-') || 'empty'}`,
    status: 'queued',
    rows: rows.filter((row) => selected.has(row.id)).map((row) => ({ rowId: row.id, raw: redactEvidenceText(row.raw) })),
  }
}

export function applyAiFindingResult(request: AiAnalysisRequest, result: AiFindingResult) {
  const allowed = new Set(request.rows.map((row) => row.rowId))
  for (const rowId of result.evidenceRowIds) {
    if (!allowed.has(rowId)) throw new Error(`unknown evidence row ${rowId}`)
  }
  return { ...result, evidenceRefs: result.evidenceRowIds.map((rowId) => ({ rowId })) }
}
