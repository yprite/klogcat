import { describe, expect, it } from 'vitest'
import { matchesLogQuery, validateLogQuery } from '../utils/logQuery'
import type { ParsedLogLine } from '../types/log'

const row: ParsedLogLine = { id: 1, streamId: 's', sourceId: 'src', sourceType: 'access', context: 'ctx', namespace: 'prod', pod: 'api-1', container: 'app', filePath: '/x', raw: '{"status":500,"message":"timeout"}', parseStatus: 'parsed', receivedAt: Date.now(), status: '500', method: 'POST', url: '/api/pay', summary: 'POST /api/pay 500 timeout', trId: 't1', level: 'ERROR' }

describe('matchesLogQuery', () => {
  it('matches bare text and field:value terms', () => {
    expect(matchesLogQuery(row, 'timeout status:500 source:access')).toBe(true)
    expect(matchesLogQuery(row, 'namespace:dev')).toBe(false)
  })

  it('supports negation, regex fields, or and parentheses', () => {
    expect(matchesLogQuery(row, '(status:200 | status:500) & -pod:worker')).toBe(true)
    expect(matchesLogQuery(row, 'url~:/api/.+ & method:POST')).toBe(true)
  })

  it('supports severity and stacktrace predicates', () => {
    expect(matchesLogQuery(row, 'level:WARN')).toBe(true)
    expect(matchesLogQuery({ ...row, isStacktrace: true }, 'is:stacktrace')).toBe(true)
  })

  it('validates regex field queries', () => {
    expect(validateLogQuery('url~:[').ok).toBe(false)
    expect(validateLogQuery('(status:500 | source:error)').ok).toBe(true)
  })
})
