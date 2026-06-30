import { describe, expect, it } from 'vitest'
import type { ParsedLogLine } from '../types/log'
import { analyzeIncidentRows, copyIncidentSummary } from '../utils/incidentTriage'

const base = { streamId: 's1', sourceId: 'src1', context: 'kind-dev', namespace: 'prod', pod: 'checkout-1', container: 'app', filePath: '/x', parseStatus: 'parsed' as const, receivedAt: 1, raw: '{}', summary: '{}' }

const row = (patch: Partial<ParsedLogLine>): ParsedLogLine => ({ id: 1, sourceType: 'access', ...base, ...patch })

describe('incident triage MVP', () => {
  it('finds failed and slow requests with evidence refs and canonical durationMs', () => {
    const result = analyzeIncidentRows([
      row({ id: 1, status: '503', method: 'GET', url: '/checkout', elapsed: 120, trId: 't1' }),
      row({ id: 2, status: '200', method: 'POST', url: '/pay', elapsed: 2500, trId: 't2' }),
    ], { slowThresholdMs: 1000 })
    expect(result.findings).toEqual([
      expect.objectContaining({ ruleId: 'failed-request', severity: 'critical', title: 'Failed request GET /checkout', evidenceRefs: [expect.objectContaining({ rowId: 1, streamId: 's1', sourceType: 'access' })] }),
      expect.objectContaining({ ruleId: 'slow-request', severity: 'warning', title: 'Slow request POST /pay', durationMs: 2500 }),
    ])
    expect(result.noFindingExplanation).toBeUndefined()
  })

  it('does not claim healthy when parser fields are missing', () => {
    const result = analyzeIncidentRows([row({ id: 3, parseStatus: 'raw', raw: 'unstructured line', status: undefined, elapsed: undefined })])
    expect(result.findings).toEqual([])
    expect(result.noFindingExplanation).toEqual({ reason: 'parser_fields_missing', blindSpots: ['status', 'elapsed'] })
  })

  it('renders redacted copy summary without hidden disk writes', () => {
    const result = analyzeIncidentRows([row({ id: 1, status: '500', method: 'GET', url: '/users/123/token/secret', elapsed: 3 })])
    expect(copyIncidentSummary(result)).toContain('/users/:id/token/[REDACTED]')
  })
})
