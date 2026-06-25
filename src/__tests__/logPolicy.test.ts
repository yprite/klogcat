import { describe, expect, it } from 'vitest'
import { buildLogPathFromPolicy, buildLogPathTemplateFromPolicy, defaultLogPolicy, defaultLogSourcesFromPolicy, defaultVisibleColumnsForPolicy, fieldPathValueFromPolicy, isFailureRowFromPolicy, labelForColumnFromPolicy, querySuggestionsFromPolicy, rowLevelFromPolicy, sourceTypesFromPolicy } from '../utils/logPolicy'
import type { ParsedLogLine } from '../types/log'

describe('logPolicy', () => {
  it('centralizes source definitions and SCloud path rules outside business code', () => {
    expect(sourceTypesFromPolicy(defaultLogPolicy)).toEqual(['info', 'access', 'error'])
    expect(buildLogPathFromPolicy(defaultLogPolicy, 'demo-ns', 'demo-pod', 'info')).toBe('/scloud/demo-ns/logs/demo-pod/demo-ns.log')
    expect(buildLogPathFromPolicy(defaultLogPolicy, 'demo-ns', 'demo-pod', 'access')).toBe('/scloud/demo-ns/logs/demo-pod/demo-ns_ACC.log')
    expect(buildLogPathFromPolicy(defaultLogPolicy, 'demo-ns', 'demo-pod', 'error')).toBe('/scloud/demo-ns/logs/demo-pod/demo-ns_ERR.log')
    expect(buildLogPathTemplateFromPolicy(defaultLogPolicy, 'access')).toBe('/scloud/[namespace]/logs/[podname]/[namespace]_ACC.log')
    expect(defaultLogSourcesFromPolicy(defaultLogPolicy).error).toEqual({ container: 'app', filePath: '/scloud/[namespace]/logs/[podname]/[namespace]_ERR.log' })
  })

  it('centralizes source column schemas, labels, and default visible columns', () => {
    expect(defaultLogPolicy.sources.info.columns).toEqual(defaultLogPolicy.sources.access.columns)
    expect(defaultLogPolicy.sources.error.columns).toContain('errorReason')
    expect(defaultVisibleColumnsForPolicy(defaultLogPolicy, defaultLogPolicy.sources.access.columns)).toEqual(['trId','method','url','status','elapsed','rcode','rmsg','exceptionName','apiName'])
    expect(labelForColumnFromPolicy(defaultLogPolicy, 'apiName')).toBe('api_name')
    expect(labelForColumnFromPolicy(defaultLogPolicy, 'errorReason')).toBe('errorDetails.errors.reason')
  })

  it('centralizes query suggestion policy and source aliases', () => {
    const suggestions = querySuggestionsFromPolicy(defaultLogPolicy)
    expect(suggestions.map((suggestion) => suggestion.insert)).toEqual(expect.arrayContaining(['source:', 'trId:', 'url~:', 'message~:', 'is:stacktrace']))
    expect(defaultLogPolicy.query.sourceAliases).toEqual(['source', 'type'])
    expect(defaultLogPolicy.query.correlationFields).toEqual(['trId', 'traceId'])
  })

  it('centralizes parser field paths for base, access-like, and error logs', () => {
    expect(defaultLogPolicy.parser.base.timestamp).toBe('time')
    expect(defaultLogPolicy.parser.base.levelCandidates).toEqual(['level', 'severity', 'logLevel', 'priority'])
    expect(defaultLogPolicy.parser.access.apiName).toBe('body.api_name')
    expect(defaultLogPolicy.parser.access.rcode).toBe('body.rcode')
    expect(defaultLogPolicy.parser.error.traceId).toBe('body.errorDetails.traceId')
    expect(defaultLogPolicy.parser.error.errorReason).toBe('body.errorDetails.errors.0.reason')
    expect(fieldPathValueFromPolicy({ body: { errorDetails: { errors: [{ reason: 'boom' }] } } }, defaultLogPolicy.parser.error.errorReason)).toBe('boom')
  })

  it('centralizes severity and failure classification rules', () => {
    const access5xx: ParsedLogLine = { id: 1, streamId: 's', sourceId: 'src', sourceType: 'access', namespace: 'ns', pod: 'p', container: 'c', filePath: '/x', raw: '{}', parseStatus: 'parsed', receivedAt: 1, summary: 'raw', status: '503' }
    const errorRow: ParsedLogLine = { ...access5xx, sourceType: 'error', status: undefined }

    expect(defaultLogPolicy.severity.levelRanks.ERROR).toBeGreaterThan(defaultLogPolicy.severity.levelRanks.WARN)
    expect(defaultLogPolicy.severity.fallbackLevelBySource.error).toBe('ERROR')
    expect(defaultLogPolicy.failure.minimumStatus).toBe(500)
    expect(rowLevelFromPolicy(errorRow, defaultLogPolicy)).toBe('ERROR')
    expect(isFailureRowFromPolicy(access5xx, defaultLogPolicy)).toBe(true)
  })
})
