import type { ParsedLogLine } from '../types/log'
import { analyzeIncidentRows } from './incidentTriage'

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

export function buildAnalysisTabs(rows: ParsedLogLine[], options: { slowThresholdMs?: number } = {}) {
  const triage = analyzeIncidentRows(rows, options)
  const failedRows = rows.filter((row) => Number(row.status) >= 500)
  const slowRows = rows.filter((row) => typeof row.elapsed === 'number' && row.elapsed > (options.slowThresholdMs ?? 1000))
  const slowDurations = slowRows.map((row) => row.elapsed).filter((value): value is number => typeof value === 'number')
  return {
    failedRequests: {
      rows: failedRows,
      findings: triage.findings.filter((finding) => finding.ruleId === 'failed-request'),
    },
    slowRequests: {
      rows: slowRows,
      findings: triage.findings.filter((finding) => finding.ruleId === 'slow-request'),
      percentiles: { p50: percentile(slowDurations, 50), p95: percentile(slowDurations, 95), p99: percentile(slowDurations, 99) },
    },
  }
}
