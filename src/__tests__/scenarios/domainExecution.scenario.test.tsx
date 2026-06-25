import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import accFixture from '../../__fixtures__/acc.valid.jsonl?raw'
import errFixture from '../../__fixtures__/err.valid.jsonl?raw'
import infoFixture from '../../__fixtures__/info.valid.jsonl?raw'
import invalidFixture from '../../__fixtures__/invalid.jsonl?raw'
import { resetLogStoreForTests, useLogStore } from '../../stores/logStore'
import type { ActiveStreamMeta, LogLineEvent, ParsedLogLine, SourceLogType } from '../../types/log'
import { formatDisplayTime } from '../../utils/formatTime'
import { matchesGrep } from '../../utils/grep'
import { highlightText } from '../../utils/highlight'
import {
  assertValidLogPolicy,
  buildLogPathFromPolicy,
  columnsForSourceFromPolicy,
  correlationKeyFromPolicy,
  defaultLogPolicy,
  defaultLogSourcesFromPolicy,
  defaultVisibleColumnsForPolicy,
  fieldPathValueFromPolicy,
  groupFailedRequestsFromPolicy,
  isFailureRowFromPolicy,
  labelForColumnFromPolicy,
  levelMeetsMinimumFromPolicy,
  loadLogPolicyConfig,
  querySuggestionsFromPolicy,
  rowLevelFromPolicy,
  setActiveLogPolicy,
  sourceTypesFromPolicy,
} from '../../utils/logPolicy'
import { matchesLogQuery, validateLogQuery } from '../../utils/logQuery'
import { parseLogLine } from '../../utils/parseLogLine'
import { appendWithLimit } from '../../utils/ringBuffer'
import { sourceLabelsForActivePolicy, sourceTypesForActivePolicy } from '../../utils/sourceLabels'
import { buildScloudLogPath } from '../../utils/logPath'

const lines = (input: string) => input.trim().split('\n')
const meta = (sourceType: SourceLogType, streamId = sourceType): ActiveStreamMeta => ({
  streamId,
  sourceId: `ctx/default/api/app/${sourceType}`,
  sourceType,
  context: 'ctx',
  namespace: 'default',
  pod: 'api-7d9c8f6b8d-x2abc',
  container: 'app',
  filePath: buildScloudLogPath('default', 'api-7d9c8f6b8d-x2abc', sourceType),
  initialTailLines: 10,
})
const event = (sourceType: SourceLogType, raw: string, receivedAt: number): LogLineEvent => ({
  streamId: sourceType,
  sourceType,
  raw,
  receivedAt,
})

function installLocalStorageMock() {
  let store: Record<string, string> = {}
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value },
      removeItem: (key: string) => { delete store[key] },
      clear: () => { store = {} },
      key: (index: number) => Object.keys(store)[index] ?? null,
      get length() { return Object.keys(store).length },
    },
  })
}

describe('domain execution scenario', () => {
  beforeEach(() => {
    installLocalStorageMock()
    window.localStorage.clear()
    resetLogStoreForTests()
    setActiveLogPolicy(defaultLogPolicy)
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('ingests real fixture logs through store parsing, filtering, buffering, and failure grouping', () => {
    const store = useLogStore.getState()
    store.prepareStarting(meta('info'))
    store.prepareStarting(meta('access'))
    store.prepareStarting(meta('error'))
    store.markRunning('info')
    store.markRunning('access')
    store.markRunning('error')

    useLogStore.getState().appendLines([
      event('access', lines(accFixture)[0], Date.UTC(2026, 0, 1, 0, 0, 0)),
      event('access', lines(accFixture)[1], Date.UTC(2026, 0, 1, 0, 0, 1)),
      event('error', lines(errFixture)[0], Date.UTC(2026, 0, 1, 0, 0, 2)),
      event('error', lines(errFixture)[1], Date.UTC(2026, 0, 1, 0, 0, 3)),
      event('info', lines(infoFixture)[0], Date.UTC(2026, 0, 1, 0, 0, 4)),
      event('info', lines(infoFixture)[1], Date.UTC(2026, 0, 1, 0, 0, 5)),
      event('info', lines(infoFixture)[2], Date.UTC(2026, 0, 1, 0, 0, 6)),
      event('info', lines(invalidFixture)[0], Date.UTC(2026, 0, 1, 0, 0, 7)),
      event('info', '{"message":"RuntimeException: boom"}', Date.UTC(2026, 0, 1, 0, 0, 8)),
      event('info', '    at com.example.App.run(App.java:1)', Date.UTC(2026, 0, 1, 0, 0, 9)),
    ])

    const state = useLogStore.getState()
    expect(state.rows.some((row) => row.parseStatus === 'raw')).toBe(true)
    expect(state.rows.some((row) => row.isStacktrace)).toBe(true)
    expect(state.rows.find((row) => row.status === '500')?.apiName).toBe('triggerOpenTabMigration')

    state.setGrepQuery('(status:500 | level:ERROR) & -pod:worker')
    expect(useLogStore.getState().visibleRows.length).toBeGreaterThan(0)
    state.setGrepMode('regex')
    state.setGrepQuery('OpenTabMigration.*')
    expect(useLogStore.getState().visibleRows.length).toBeGreaterThan(0)
    state.pause()
    state.appendLine(event('info', '{"message":"hidden while paused"}', Date.now()))
    expect(useLogStore.getState().viewerPaused).toBe(true)
    state.resume()
    state.setBufferLimit(2)
    expect(useLogStore.getState().totalDroppedCount).toBeGreaterThan(0)
    state.recordStderr('info', 'pods "api-old" not found')
    expect(useLogStore.getState().latestStderr).toContain('not found')
    state.markStopping('info')
    state.markStopped('info')
    state.markStartRejected('access', new Error('start rejected'))
    state.markError('error', 'tail failed')
    state.clear()
    state.resetForSelectionChange()
    expect(useLogStore.getState().rows).toEqual([])
    useLogStore.getState().prepareStarting(meta('info'))
    useLogStore.getState().appendLine(event('info', '    at com.example.Standalone.run(App.java:1)', Date.now()))
    useLogStore.getState().setAutoScrollEnabled(false)
    expect(useLogStore.getState().rows[0]?.isStacktrace).toBe(true)
    expect(useLogStore.getState().autoScrollEnabled).toBe(false)
  })

  it('executes parser, query, display, and policy utilities as one investigation workflow', async () => {
    const accessRow = parseLogLine(lines(accFixture)[0], 'access', meta('access'), Date.now())
    const errorRow = parseLogLine(lines(errFixture)[0], 'error', meta('error'), Date.now())
    const infoRow = parseLogLine(lines(infoFixture)[2], 'info', meta('info'), Date.now())
    const rows = [
      { ...accessRow, id: 1 },
      { ...errorRow, id: 2, trId: accessRow.trId },
      { ...infoRow, id: 3 },
    ] satisfies ParsedLogLine[]

    expect(matchesGrep(accessRow.raw, 'migration')).toBe(true)
    expect(matchesGrep(accessRow.raw, 'migration$', 'regex')).toBe(false)
    expect(validateLogQuery('url~:[').ok).toBe(false)
    expect(validateLogQuery('(status:500 | source:error)').ok).toBe(true)
    expect(matchesLogQuery(rows[0], '(status:500 | source:error) & method:POST')).toBe(true)
    expect(matchesLogQuery(rows[0], 'status:500 |')).toBe(true)
    expect(matchesLogQuery(rows[0], '!')).toBe(true)
    expect(matchesLogQuery(rows[0], '&')).toBe(true)
    expect(matchesLogQuery(rows[0], '"POST /api/pay" status:500')).toBe(false)
    expect(matchesLogQuery(rows[0], 'status:')).toBe(true)
    expect(matchesLogQuery(rows[0], 'url~:[')).toBe(false)
    expect(matchesLogQuery(rows[0], 'is:unknown')).toBe(false)
    expect(matchesLogQuery({ ...rows[0], level: 'INFO' }, 'level:WARN')).toBe(false)
    expect(matchesLogQuery({ ...rows[0], isStacktrace: true }, 'is:stacktrace')).toBe(true)
    expect(matchesLogQuery({ ...rows[0], epochTime: Date.now() }, 'age:5m')).toBe(true)
    expect(matchesLogQuery(rows[0], 'age:soon')).toBe(false)

    expect(rowLevelFromPolicy({ ...rows[1], level: undefined, jsonLogType: undefined })).toBe('ERROR')
    expect(levelMeetsMinimumFromPolicy('ERROR', 'WARN')).toBe(true)
    expect(isFailureRowFromPolicy(rows[0])).toBe(true)
    expect(correlationKeyFromPolicy(rows[1])).toBe(accessRow.trId)
    expect(groupFailedRequestsFromPolicy(rows)).toHaveLength(1)
    expect(sourceTypesFromPolicy()).toEqual(['info', 'access', 'error'])
    expect(sourceTypesForActivePolicy()).toEqual(['info', 'access', 'error'])
    expect(sourceLabelsForActivePolicy().access).toBe('ACC')
    expect(querySuggestionsFromPolicy().length).toBeGreaterThan(0)
    expect(columnsForSourceFromPolicy(defaultLogPolicy, 'access')).toContain('status')
    expect(defaultVisibleColumnsForPolicy(defaultLogPolicy, ['foo' as never, 'bar' as never])).toEqual(['foo', 'bar'])
    expect(labelForColumnFromPolicy(defaultLogPolicy, 'apiName')).toBe('api_name')
    expect(defaultLogSourcesFromPolicy(defaultLogPolicy).info.filePath).toContain('[podname]')
    expect(buildLogPathFromPolicy(defaultLogPolicy, 'ns', 'pod', 'error')).toContain('_ERR.log')
    expect(fieldPathValueFromPolicy({ body: { errors: [{ reason: 'boom' }] } }, 'body.errors.0.reason')).toBe('boom')
    expect(formatDisplayTime({ epochTime: Date.UTC(2026, 0, 1), receivedAt: 1 })).toMatch(/\d\d:\d\d:\d\d\.\d\d\d/)
    expect(appendWithLimit([1, 2], 3, 2)).toEqual({ items: [2, 3], dropped: 1 })

    render(<div>{highlightText('OpenTabMigrationFailedException', 'migration')}</div>)
    expect(screen.getByText('Migration')).toBeInTheDocument()
    render(<div>{highlightText('HTTP 503', '5\\d\\d', 'regex')}</div>)
    expect(screen.getByText('503')).toBeInTheDocument()

    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404 })))
    await expect(loadLogPolicyConfig('/missing.json')).resolves.toEqual({ loaded: false, source: '/missing.json', error: 'HTTP 404' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    await expect(loadLogPolicyConfig('/broken.json')).resolves.toEqual({ loaded: false, source: '/broken.json', error: 'network down' })
    expect(() => assertValidLogPolicy({ ...defaultLogPolicy, pathTemplate: '/missing-pod' })).toThrow('[namespace]')
  })
})
