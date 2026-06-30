import type { ParsedLogLine, SourceLogType } from '../types/log'

export type EvidenceRef = {
  rowId: number
  streamId: string
  sourceId: string
  context?: string
  namespace: string
  pod: string
  container: string
  sourceType: SourceLogType
  filePath: string
}

export type InvestigationFinding = {
  family: 'request'
  ruleId: 'failed-request' | 'slow-request'
  ruleVersion: 1
  severity: 'critical' | 'warning'
  confidence: 'high' | 'medium'
  title: string
  durationMs?: number
  evidenceRefs: EvidenceRef[]
  prescription: string
}

export type NoFindingExplanation = { reason: 'healthy_no_findings' | 'parser_fields_missing' | 'no_matching_rows'; blindSpots: string[] }
export type IncidentTriageResult = { findings: InvestigationFinding[]; noFindingExplanation?: NoFindingExplanation; redactionStatus: 'redacted' }

type AnalyzeOptions = { slowThresholdMs?: number }

const DEFAULT_SLOW_THRESHOLD_MS = 1000

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

function requestTitle(prefix: string, row: ParsedLogLine) {
  return `${prefix} ${row.method ?? 'UNKNOWN'} ${row.url ?? '(unknown url)'}`
}

function numericStatus(row: ParsedLogLine) {
  const status = Number(row.status)
  return Number.isFinite(status) ? status : undefined
}

function durationMs(row: ParsedLogLine) {
  return typeof row.elapsed === 'number' && Number.isFinite(row.elapsed) ? row.elapsed : undefined
}

function parserBlindSpots(rows: ParsedLogLine[]) {
  const missing = new Set<string>()
  if (rows.some((row) => row.status === undefined)) missing.add('status')
  if (rows.some((row) => row.elapsed === undefined)) missing.add('elapsed')
  return [...missing]
}

export function analyzeIncidentRows(rows: ParsedLogLine[], options: AnalyzeOptions = {}): IncidentTriageResult {
  const slowThresholdMs = options.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS
  const findings: InvestigationFinding[] = []
  for (const row of rows) {
    const status = numericStatus(row)
    const elapsedMs = durationMs(row)
    if (status !== undefined && status >= 500) {
      findings.push({
        family: 'request',
        ruleId: 'failed-request',
        ruleVersion: 1,
        severity: 'critical',
        confidence: 'high',
        title: requestTitle('Failed request', row),
        durationMs: elapsedMs,
        evidenceRefs: [evidenceRef(row)],
        prescription: 'Inspect correlated access/error rows and preserve this row in the incident summary.',
      })
    } else if (elapsedMs !== undefined && elapsedMs > slowThresholdMs) {
      findings.push({
        family: 'request',
        ruleId: 'slow-request',
        ruleVersion: 1,
        severity: 'warning',
        confidence: 'medium',
        title: requestTitle('Slow request', row),
        durationMs: elapsedMs,
        evidenceRefs: [evidenceRef(row)],
        prescription: 'Check upstream latency, pod restarts, and nearby error rows before declaring healthy.',
      })
    }
  }
  if (findings.length > 0) return { findings, redactionStatus: 'redacted' }
  const blindSpots = parserBlindSpots(rows)
  if (blindSpots.length > 0) return { findings, redactionStatus: 'redacted', noFindingExplanation: { reason: 'parser_fields_missing', blindSpots } }
  return { findings, redactionStatus: 'redacted', noFindingExplanation: { reason: rows.length ? 'healthy_no_findings' : 'no_matching_rows', blindSpots: [] } }
}

function redact(value: string) {
  return value
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/(token|secret|password)(\/[^\s?#]*)?/gi, '$1/[REDACTED]')
}

export function copyIncidentSummary(result: IncidentTriageResult) {
  const lines = ['Incident Summary', `Redaction: ${result.redactionStatus}`]
  if (result.findings.length === 0) {
    lines.push(`No finding: ${result.noFindingExplanation?.reason ?? 'unknown'}`)
  }
  for (const finding of result.findings) {
    lines.push(`- [${finding.severity}] ${redact(finding.title)}`)
    lines.push(`  evidence: ${finding.evidenceRefs.map((ref) => `${ref.streamId}#${ref.rowId}`).join(', ')}`)
  }
  return lines.join('\n')
}
