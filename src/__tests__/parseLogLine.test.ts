import { describe, expect, it } from 'vitest'
import accFixture from '../__fixtures__/acc.valid.jsonl?raw'
import appFixture from '../__fixtures__/app.valid.jsonl?raw'
import errFixture from '../__fixtures__/err.valid.jsonl?raw'
import invalidFixture from '../__fixtures__/invalid.jsonl?raw'
import type { SourceMeta } from '../types/log'
import { parseLogLine } from '../utils/parseLogLine'

const meta = (sourceType: SourceMeta['sourceType']): SourceMeta => ({ streamId: 's1', sourceId: 'ns/p/c/src/file', sourceType, namespace: 'ns', pod: 'pod', container: 'app', filePath: '/x' })
const lines = (s: string) => s.trim().split('\n')

describe('parseLogLine', () => {
  it('parses ACC and preserves best-effort fields', () => {
    const row = parseLogLine(lines(accFixture)[0], 'access', meta('access'), 123)
    expect(row.parseStatus).toBe('parsed')
    expect(row.status).toBe('500'); expect(row.elapsed).toBe(11908); expect(row.method).toBe('POST'); expect(row.url).toContain('migration'); expect(row.trId).toBe('acc-trace-1')
    expect(row.rcode).toBe('5000999'); expect(row.rmsg).toBe('Internal Server Error'); expect(row.exceptionName).toBe('OpenTabMigrationFailedException'); expect(row.apiName).toBe('triggerOpenTabMigration')
    expect(row.host).toBe('h'); expect(row.service).toBe('svc'); expect(row.module).toBe('dapi'); expect(row.serviceId).toBe('sid'); expect(row.epochTime).toBe(1767225600000); expect(row.length).toBe(14)
    expect(row.summary).toContain('POST'); expect(row.summary).toContain('500')
    expect(row.receivedAt).toBe(123)
  })
  it('normalizes ACC status strings and elapsed strings', () => { const row = parseLogLine(lines(accFixture)[1], 'access', meta('access'), 1); expect(row.status).toBe('200'); expect(row.elapsed).toBe(34) })
  it('parses ERR and preserves trace fields', () => {
    const row = parseLogLine(lines(errFixture)[0], 'error', meta('error'), 1)
    expect(row.parseStatus).toBe('parsed'); expect(row.logger).toContain('ErrorLoggingAspect'); expect(row.thread).toContain('http')
    expect(row.errorReason).toContain('OpenTabMigrationFailedException'); expect(row.errorMethod).toBe('POST'); expect(row.errorPath).toContain('migration')
    expect(row.traceId).toBe('body-trace-1'); expect(row.trId).toBe('err-trace-1'); expect(row.errorServerName).toBe('dapi'); expect(row.errorTimestamp).toContain('2026')
  })
  it('keeps ERR parsed with empty errors', () => { const row = parseLogLine(lines(errFixture)[1], 'error', meta('error'), 1); expect(row.parseStatus).toBe('parsed'); expect(row.summary).toBe('GET /x') })
  it('parses APP summaries', () => {
    expect(parseLogLine(lines(appFixture)[0], 'app', meta('app'), 1).summary).toBe('application started')
    expect(parseLogLine(lines(appFixture)[1], 'app', meta('app'), 1).summary).toBe('plain body message')
    expect(parseLogLine(lines(appFixture)[2], 'app', meta('app'), 1).summary).toBe('{"event":"ready","ok":true}')
  })
  it('falls back to raw for invalid JSON', () => { const row = parseLogLine(lines(invalidFixture)[0], 'app', meta('app'), 1); expect(row.parseStatus).toBe('raw'); expect(row.summary).toBe('not json at all'); expect(row.raw).toBe('not json at all') })
})
