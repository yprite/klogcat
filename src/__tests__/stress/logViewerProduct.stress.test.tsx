import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { LogViewerExtensionHost } from '../../components/LogViewerExtensionHost'
import { toLogViewerExtensionSnapshot } from '../../extensions/logViewerSdkAdapter'
import { registerLogViewerExtension, resetLogViewerExtensionsForTests } from '../../extensions/logViewerExtensions'
import { scopeKey, useKubeStore, type KubeStoreState } from '../../stores/kubeStore'
import { resetLogStoreForTests, useLogStore } from '../../stores/logStore'
import { createLogViewerExtensionHostApi, type LogViewerExtensionProps } from '../../sdk/log-viewer'
import type { ActiveStreamMeta, LogLineEvent, ParsedLogLine } from '../../types/log'

const virtualState = vi.hoisted(() => ({ index: 0, scrollToIndex: vi.fn() }))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => {
    const index = count === 0 ? 0 : Math.min(virtualState.index, count - 1)
    return {
      getTotalSize: () => count * 44,
      getVirtualItems: () => count === 0 ? [] : [{ key: `row-${index}`, index, start: index * 44 }],
      scrollToIndex: virtualState.scrollToIndex,
    }
  },
}))

const productStress = {
  bufferRows: 50_000,
  inputSeconds: 30,
  linesPerSecond: 5_000,
  inputBudgetMs: process.env.CI ? 120_000 : 30_000,
  tabSwitchP95Ms: 500,
  queryP95Ms: 2_000,
  detailOpenP95Ms: 150,
  soakCycles: 120,
}

const burstRows = productStress.inputSeconds * productStress.linesPerSecond

const meta: ActiveStreamMeta = {
  streamId: 'stress-stream',
  sourceId: 'ctx/prod/api-0/app/access',
  sourceType: 'access',
  context: 'ctx',
  namespace: 'prod',
  pod: 'api-0',
  container: 'app',
  filePath: '/scloud/prod/logs/api-0/access.log',
}

function accessEvent(index: number, streamId = meta.streamId): LogLineEvent {
  const failed = index % 4 === 0
  return {
    streamId,
    sourceType: 'access',
    receivedAt: Date.UTC(2026, 0, 1) + index,
    raw: JSON.stringify({
      timestamp: `2026-01-01T00:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
      method: failed ? 'POST' : 'GET',
      url: `/orders/${index}`,
      status: failed ? '500' : '200',
      elapsed: failed ? 1_500 + index : 25 + index,
      trId: `tr-${Math.floor(index / 2)}`,
      message: failed ? 'payment timeout' : 'ok',
    }),
  }
}

function parsedRow(index: number): ParsedLogLine {
  const failed = index % 4 === 0
  return {
    ...meta,
    id: index + 1,
    raw: JSON.stringify({ status: failed ? '500' : '200', method: failed ? 'POST' : 'GET', url: `/orders/${index}`, trId: `tr-${Math.floor(index / 2)}` }),
    parseStatus: 'parsed',
    receivedAt: Date.UTC(2026, 0, 1) + index,
    timestamp: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
    method: failed ? 'POST' : 'GET',
    url: `/orders/${index}`,
    status: failed ? '500' : '200',
    elapsed: failed ? 1_500 + index : 25 + index,
    trId: `tr-${Math.floor(index / 2)}`,
    summary: `${failed ? 'POST' : 'GET'} /orders/${index} ${failed ? '500' : '200'}`,
  }
}

function installBrowserMocks() {
  let store: Record<string, string> = {}
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value },
      removeItem: (key: string) => { delete store[key] },
      clear: () => { store = {} },
    },
  })
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  })
}

function installSelectedTargetState() {
  useKubeStore.setState({
    contexts: [{ name: 'ctx' }],
    currentContext: 'ctx',
    selectedContext: 'ctx',
    selectedContexts: ['ctx'],
    namespaces: [{ name: 'prod' }],
    namespacesByContext: { ctx: [{ name: 'prod' }] },
    selectedNamespace: 'prod',
    selectedNamespaces: { ctx: ['prod'] },
    pods: [{ name: 'api-0', namespace: 'prod', phase: 'Running', containers: ['app'] }],
    podsByScope: { [scopeKey('ctx', 'prod')]: [{ name: 'api-0', namespace: 'prod', phase: 'Running', containers: ['app'] }] },
    selectedPod: 'api-0',
    selectedPods: { [scopeKey('ctx', 'prod')]: ['api-0'] },
    selectedWorkloads: {},
    loadingContexts: false,
    loadingNamespaces: false,
    loadingPods: false,
    cacheLoaded: true,
    cacheRefreshing: false,
    cacheLastRefreshAt: Date.now(),
    error: undefined,
  })
}

function kubeState(selectedTargetCount: number) {
  return {
    getSelectedPodTargets: () => Array.from({ length: selectedTargetCount }, (_, index) => ({
      context: 'ctx',
      namespace: 'prod',
      pod: `api-${index}`,
      container: 'app',
    })),
  } as unknown as KubeStoreState
}

function percentile95(samples: readonly number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0
}

function measure(action: () => void) {
  const start = performance.now()
  action()
  return performance.now() - start
}

function SimpleStressViewer({ sdk, snapshot }: LogViewerExtensionProps) {
  useEffect(() => {
    const unsubscribe = sdk.subscribe(() => undefined)
    return unsubscribe
  }, [sdk])
  return <section data-testid="stress-extension">Rows: {snapshot.visibleRowCount}/{snapshot.totalRowCount}</section>
}

function BrokenStressViewer() {
  throw new Error('stress extension failed')
  return null
}

describe('log viewer product stress gate', () => {
  beforeEach(() => {
    vi.useRealTimers()
    virtualState.index = 0
    virtualState.scrollToIndex.mockClear()
    installBrowserMocks()
    installSelectedTargetState()
    resetLogViewerExtensionsForTests()
    resetLogStoreForTests()
  })

  afterEach(() => {
    resetLogViewerExtensionsForTests()
    resetLogStoreForTests()
  })

  it('keeps a 50k buffer stable while ingesting a 5k lines/sec 30s burst', () => {
    const store = useLogStore.getState()
    store.setBufferLimit(productStress.bufferRows)
    store.prepareStarting(meta)
    store.markRunning(meta.streamId)

    const startedAt = performance.now()
    for (let offset = 0; offset < burstRows; offset += productStress.linesPerSecond) {
      store.appendLines(Array.from({ length: productStress.linesPerSecond }, (_, index) => accessEvent(offset + index)))
    }
    const elapsedMs = performance.now() - startedAt
    const state = useLogStore.getState()

    expect(elapsedMs).toBeLessThan(productStress.inputBudgetMs)
    expect(state.rows).toHaveLength(productStress.bufferRows)
    expect(state.visibleRows).toHaveLength(productStress.bufferRows)
    expect(state.totalDroppedCount).toBe(burstRows - productStress.bufferRows)
    expect(state.nextLineId).toBe(burstRows + 1)
    expect(state.streamStatus).toBe('running')
    expect(state.errorMessage).toBeUndefined()

    state.setGrepQuery('status:500')
    const filtered = useLogStore.getState()
    expect(filtered.visibleRows).toHaveLength(productStress.bufferRows / 4)
    expect(filtered.visibleRows.every((row) => row.status === '500')).toBe(true)
  }, 35_000)

  it('keeps core UI interactions within product p95 thresholds at 50k rows', async () => {
    registerLogViewerExtension({
      id: 'vendor.stress',
      ownerId: 'vendor',
      label: 'Stress',
      description: 'Stress extension',
      component: SimpleStressViewer,
      requestedCapabilities: ['logs.read'],
      trustLevel: 'trusted-bundled',
    })
    const rows = Array.from({ length: productStress.bufferRows }, (_, index) => parsedRow(index))
    useLogStore.setState({ rows, visibleRows: rows, bufferLimit: productStress.bufferRows })

    render(<LogViewerExtensionHost><div /></LogViewerExtensionHost>)
    await screen.findByTestId('log-row-1')

    const querySamples: number[] = []
    for (const query of ['status:500', 'pod:api-0', 'method:POST', 'status:200', '']) {
      querySamples.push(measure(() => act(() => useLogStore.getState().setGrepQuery(query))))
    }
    expect(percentile95(querySamples)).toBeLessThan(productStress.queryP95Ms)

    const tabSamples: number[] = []
    for (let i = 0; i < 8; i += 1) {
      tabSamples.push(measure(() => fireEvent.click(screen.getByRole('tab', { name: 'Stress' }))))
      await screen.findByTestId('stress-extension')
      tabSamples.push(measure(() => fireEvent.click(screen.getByRole('tab', { name: 'Raw Logs' }))))
      await screen.findByTestId('log-row-1')
    }
    expect(percentile95(tabSamples)).toBeLessThan(productStress.tabSwitchP95Ms)

    const detailSamples: number[] = []
    for (let i = 0; i < 10; i += 1) {
      detailSamples.push(measure(() => fireEvent.click(screen.getByTestId('log-row-1'))))
      expect(screen.getByRole('complementary', { name: /log row detail/i })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    }
    expect(percentile95(detailSamples)).toBeLessThan(productStress.detailOpenP95Ms)

    virtualState.index = productStress.bufferRows - 1
    act(() => useLogStore.setState({ rows: [...rows], visibleRows: [...rows] }))
    await waitFor(() => expect(screen.getByTestId(`log-row-${productStress.bufferRows}`)).toBeInTheDocument())
  }, 20_000)

  it('exports public SDK rows accurately at 50k rows without leaking host-only fields', () => {
    const rows = Array.from({ length: productStress.bufferRows }, (_, index) => parsedRow(index))
    useLogStore.setState({
      rows,
      visibleRows: rows.filter((row) => row.status === '500'),
      bufferLimit: productStress.bufferRows,
      grepQuery: 'status:500',
    })

    const snapshot = toLogViewerExtensionSnapshot(useLogStore.getState(), kubeState(3))
    const sdk = createLogViewerExtensionHostApi({
      capabilities: ['logs.read', 'logs.export'],
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      actions: {
        setGrepQuery: () => undefined,
        setGrepMode: () => undefined,
        pauseViewer: () => undefined,
        resumeViewer: () => undefined,
        clearViewer: () => undefined,
        setAutoScrollEnabled: () => undefined,
      },
    })

    expect(snapshot.totalRowCount).toBe(productStress.bufferRows)
    expect(snapshot.visibleRowCount).toBe(productStress.bufferRows / 4)
    expect(snapshot.selectedTargetCount).toBe(3)
    expect(snapshot.visibleRows[0]).toMatchObject({
      id: 1,
      sourceType: 'access',
      request: { method: 'POST', status: '500', elapsed: 1_500 },
      target: { context: 'ctx', namespace: 'prod', pod: 'api-0', container: 'app' },
      correlationIds: { trId: 'tr-0' },
    })
    expect(JSON.stringify(snapshot.visibleRows[0])).not.toContain('filePath')

    const exportedRows = sdk.export.rowsAsJsonl().split('\n')
    expect(exportedRows).toHaveLength(snapshot.visibleRowCount)
    expect(JSON.parse(exportedRows[0])).toMatchObject({ id: 1, request: { status: '500' }, fields: { status: '500' } })
    expect(JSON.parse(exportedRows.at(-1) ?? '{}')).toMatchObject({ id: productStress.bufferRows - 3, request: { status: '500' } })
  })

  it('does not retain extension subscriptions or rows after repeated mount, clear, and unmount cycles', () => {
    const rows = Array.from({ length: productStress.bufferRows }, (_, index) => parsedRow(index))
    useLogStore.setState({ rows, visibleRows: rows, bufferLimit: productStress.bufferRows })
    const calls = Array.from({ length: 1_000 }, () => vi.fn())
    const sdk = createLogViewerExtensionHostApi({
      capabilities: ['logs.read'],
      getSnapshot: () => toLogViewerExtensionSnapshot(useLogStore.getState(), kubeState(1)),
      subscribe: (listener) => useLogStore.subscribe(() => listener({ type: 'snapshot', reason: 'log-state', sequence: 1 })),
      actions: {
        setGrepQuery: () => undefined,
        setGrepMode: () => undefined,
        pauseViewer: () => undefined,
        resumeViewer: () => undefined,
        clearViewer: () => undefined,
        setAutoScrollEnabled: () => undefined,
      },
    })
    const unsubs = calls.map((listener) => sdk.subscribe(listener))
    unsubs.forEach((unsubscribe) => unsubscribe())

    useLogStore.getState().appendLine(accessEvent(1, meta.streamId))
    expect(calls.every((listener) => listener.mock.calls.length === 0)).toBe(true)

    useLogStore.getState().clear()
    expect(useLogStore.getState().rows).toHaveLength(0)
    expect(useLogStore.getState().visibleRows).toHaveLength(0)
    expect(useLogStore.getState().totalDroppedCount).toBe(0)
  })

  it('survives condensed soak cycles and isolates broken extensions to their tab', async () => {
    registerLogViewerExtension({
      id: 'vendor.broken-stress',
      ownerId: 'vendor',
      label: 'Broken Stress',
      description: 'Broken stress extension',
      component: BrokenStressViewer,
      requestedCapabilities: ['logs.read'],
      trustLevel: 'trusted-bundled',
    })

    for (let cycle = 0; cycle < productStress.soakCycles; cycle += 1) {
      const streamId = `soak-${cycle}`
      const cycleMeta = { ...meta, streamId, sourceId: `ctx/prod/api-0/app/access/${cycle}` }
      const store = useLogStore.getState()
      store.setBufferLimit(1_000)
      store.prepareStarting(cycleMeta)
      store.markRunning(streamId)
      store.appendLines(Array.from({ length: 250 }, (_, index) => accessEvent(cycle * 250 + index, streamId)))
      store.setGrepQuery(cycle % 2 === 0 ? 'status:500' : '')
      store.pause()
      store.resume()
      store.markStopped(streamId)
      if (cycle % 10 === 0) store.clear()
    }

    expect(useLogStore.getState().activeStreamIds).toEqual([])
    expect(useLogStore.getState().rows.length).toBeLessThanOrEqual(1_000)
    expect(useLogStore.getState().errorMessage).toBeUndefined()

    render(<LogViewerExtensionHost><div /></LogViewerExtensionHost>)
    fireEvent.click(screen.getByRole('tab', { name: 'Broken Stress' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Extension failed: Broken Stress')
    fireEvent.click(screen.getByRole('tab', { name: 'Raw Logs' }))
    expect(screen.getByRole('tab', { name: 'Raw Logs' })).toHaveAttribute('aria-selected', 'true')
  })
})
