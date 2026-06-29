import { describe, expect, it } from 'vitest'
import type { ParsedLogLine } from '../types/log'
import { buildFacetCounts } from '../utils/investigationFacets'
import { buildAnalysisTabs } from '../utils/analysisTabs'
import { createInvestigationBundle, redactEvidenceText } from '../utils/investigationBundle'
import { createAiAnalysisRequest, applyAiFindingResult } from '../utils/aiAnalyzer'
import { validateExtensionManifest } from '../utils/runtimeExtensionManifest'

const base = { streamId: 's1', sourceId: 'src1', context: 'kind-dev', namespace: 'prod', pod: 'checkout-1', container: 'app', filePath: '/x', parseStatus: 'parsed' as const, receivedAt: 1, raw: 'email y@example.com token=abc 10.1.2.3', summary: 'raw' }
const row = (patch: Partial<ParsedLogLine>): ParsedLogLine => ({ id: 1, sourceType: 'access', ...base, ...patch })

describe('roadmap P1/P2 workbench contracts', () => {
  it('builds field facets from the filtered row base', () => {
    expect(buildFacetCounts([row({ id: 1, status: '500' }), row({ id: 2, status: '500' }), row({ id: 3, status: '200' })], 'status')).toEqual([
      { value: '500', count: 2 },
      { value: '200', count: 1 },
    ])
  })

  it('builds first analysis tabs for failed and slow requests', () => {
    const tabs = buildAnalysisTabs([row({ id: 1, status: '503', url: '/checkout', elapsed: 10 }), row({ id: 2, status: '200', url: '/checkout', elapsed: 2500 })], { slowThresholdMs: 1000 })
    expect(tabs.failedRequests.rows).toHaveLength(1)
    expect(tabs.slowRequests.percentiles.p95).toBe(2500)
  })

  it('exports a redacted investigation bundle with notes and EvidenceRefs', () => {
    const bundle = createInvestigationBundle({ rows: [row({ id: 1 })], notes: [{ rowId: 1, text: 'check token secret@example.com' }] })
    expect(bundle.summaryMarkdown).toContain('row 1')
    expect(bundle.summaryMarkdown).toContain('[REDACTED_EMAIL]')
    expect(redactEvidenceText('token=abc password=test 10.1.2.3')).toBe('token=[REDACTED] password=[REDACTED] [REDACTED_IP]')
  })

  it('creates AI analyzer requests from selected redacted rows only and validates returned evidence refs', () => {
    const rows = [row({ id: 1 }), row({ id: 2, raw: 'not selected' })]
    const request = createAiAnalysisRequest(rows, [1])
    expect(request.rows).toEqual([expect.objectContaining({ rowId: 1, raw: expect.stringContaining('[REDACTED_EMAIL]') })])
    expect(applyAiFindingResult(request, { title: 'Likely auth failure', evidenceRowIds: [1] })).toEqual(expect.objectContaining({ title: 'Likely auth failure' }))
    expect(() => applyAiFindingResult(request, { title: 'bad', evidenceRowIds: [2] })).toThrow(/unknown evidence row/)
  })

  it('rejects incompatible third-party runtime extension manifests before execution', () => {
    expect(validateExtensionManifest({ id: 'latency', name: 'Latency', protocol: 'klogcat.logViewer@1', entry: './index.js' })).toEqual({ ok: true })
    expect(validateExtensionManifest({ id: 'future', name: 'Future', protocol: 'klogcat.logViewer@9', entry: './index.js' })).toEqual({ ok: false, reason: 'unsupported_protocol' })
  })
})
