import type { ParsedLogLine } from '../types/log'
import type { EvidenceRef } from './incidentTriage'

export type InvestigationNote = { rowId: number; text: string }
export type InvestigationBundle = {
  schemaVersion: 1
  evidenceRefs: EvidenceRef[]
  notes: InvestigationNote[]
  rows: Array<{ rowId: number; raw: string }>
  summaryMarkdown: string
}

export function redactEvidenceText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[REDACTED_IP]')
    .replace(/\b(token|password|secret)=\S+/gi, '$1=[REDACTED]')
}

function evidenceRef(row: ParsedLogLine): EvidenceRef {
  return {
    rowId: row.id,
    streamId: row.streamId,
    sourceId: row.sourceId,
    context: row.context,
    namespace: row.namespace,
    pod: row.pod,
    container: row.container,
    sourceType: row.sourceType,
    filePath: row.filePath,
  }
}

export function createInvestigationBundle(input: { rows: ParsedLogLine[]; notes: InvestigationNote[] }): InvestigationBundle {
  const rowIds = new Set(input.rows.map((row) => row.id))
  const notes = input.notes.filter((note) => rowIds.has(note.rowId)).map((note) => ({ ...note, text: redactEvidenceText(note.text) }))
  const rows = input.rows.map((row) => ({ rowId: row.id, raw: redactEvidenceText(row.raw) }))
  const evidenceRefs = input.rows.map(evidenceRef)
  const summaryMarkdown = [
    '# klogcat Investigation Bundle',
    ...notes.map((note) => `- row ${note.rowId}: ${note.text}`),
    ...rows.map((row) => `- evidence row ${row.rowId}: ${row.raw}`),
  ].join('\n')
  return { schemaVersion: 1, evidenceRefs, notes, rows, summaryMarkdown }
}
