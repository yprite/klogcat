import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AppShell } from '../../components/AppShell'
import { defaultSettings } from '../../config/defaultSettings'
import { useKubeStore, scopeKey } from '../../stores/kubeStore'
import { resetLogStoreForTests, useLogStore } from '../../stores/logStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { ParsedLogLine } from '../../types/log'
import { startLogStream, stopLogStream } from '../../commands/tauriLogs'
import { failedRequestsExtensionModule } from '../../extensions/examples/FailedRequestsExtension'
import { activateKlogcatExtensionModule } from '../../extensions/logViewerExtensionLoader'
import { resetLogViewerExtensionsForTests } from '../../extensions/logViewerExtensions'

vi.mock('../../commands/tauriLogs', () => ({
  startLogStream: vi.fn(async () => undefined),
  stopLogStream: vi.fn(async () => undefined),
  stopAllLogStreams: vi.fn(async () => undefined),
}))

vi.mock('../../commands/tauriKube', () => ({
  getCurrentContext: vi.fn(async () => 'ctx'),
  listContexts: vi.fn(async () => ({ contexts: [{ name: 'ctx' }] })),
  listNamespaces: vi.fn(async () => ({ context: 'ctx', namespaces: [{ name: 'demo' }] })),
  listPods: vi.fn(async () => ({
    context: 'ctx',
    namespace: 'demo',
    pods: [{ name: 'api-7d9c8f6b8d-x2abc', namespace: 'demo', phase: 'Running', containers: ['app'] }],
  })),
}))

const targetPod = { name: 'api-7d9c8f6b8d-x2abc', namespace: 'demo', phase: 'Running' as const, containers: ['app'] }
const targetScope = scopeKey('ctx', 'demo')

const accessRow: ParsedLogLine = {
  id: 1,
  streamId: 'stream-1',
  sourceId: 'source-1',
  sourceType: 'access',
  context: 'ctx',
  namespace: 'demo',
  pod: targetPod.name,
  container: 'app',
  filePath: '/scloud/demo/logs/api-7d9c8f6b8d-x2abc/demo_ACC.log',
  raw: '{"status":500,"method":"GET","url":"/fail","trId":"trx-1"}',
  parseStatus: 'parsed',
  receivedAt: Date.UTC(2026, 0, 1),
  status: '500',
  method: 'GET',
  url: '/fail',
  elapsed: 42,
  summary: 'GET /fail 500 42ms',
  trId: 'trx-1',
}

const errorRow: ParsedLogLine = {
  id: 2,
  streamId: 'stream-1',
  sourceId: 'source-1',
  sourceType: 'error',
  context: 'ctx',
  namespace: 'demo',
  pod: targetPod.name,
  container: 'app',
  filePath: '/scloud/demo/logs/api-7d9c8f6b8d-x2abc/demo_ERR.log',
  raw: '{"errorDetails":{"method":"GET","path":"/fail","errors":[{"reason":"boom"}]},"trId":"trx-1"}',
  parseStatus: 'parsed',
  receivedAt: Date.UTC(2026, 0, 1) + 1,
  errorMethod: 'GET',
  errorPath: '/fail',
  errorReason: 'boom',
  summary: 'boom GET /fail',
  trId: 'trx-1',
}

function installLocalStorageMock() {
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
}

function arrangeReadyAppState() {
  resetLogViewerExtensionsForTests()
  resetLogStoreForTests()
  useSettingsStore.setState({ settings: defaultSettings, warning: undefined, loading: false, error: undefined })
  useKubeStore.setState({
    contexts: [{ name: 'ctx' }],
    currentContext: 'ctx',
    selectedContext: 'ctx',
    selectedContexts: ['ctx'],
    namespaces: [{ name: 'demo' }],
    namespacesByContext: { ctx: [{ name: 'demo' }] },
    selectedNamespace: 'demo',
    selectedNamespaces: { ctx: ['demo'] },
    pods: [targetPod],
    podsByScope: { [targetScope]: [targetPod] },
    selectedPod: targetPod.name,
    selectedPods: { [targetScope]: [targetPod.name] },
    selectedWorkloads: {},
    loadingContexts: false,
    loadingNamespaces: false,
    loadingPods: false,
    cacheLoaded: true,
    cacheRefreshing: false,
    cacheLastRefreshAt: Date.now(),
    error: undefined,
  })
  useLogStore.setState({
    rows: [accessRow, errorRow],
    visibleRows: [accessRow, errorRow],
  })
}

describe('main investigation workflow scenario', () => {
  beforeEach(() => {
    installLocalStorageMock()
    window.localStorage.clear()
    vi.mocked(startLogStream).mockClear()
    vi.mocked(stopLogStream).mockClear()
    arrangeReadyAppState()
  })

  it('moves through target-ready stream controls, raw filtering, extension mode, and settings', async () => {
    activateKlogcatExtensionModule(failedRequestsExtensionModule)

    render(<AppShell />)

    expect(screen.getByText('klogcat')).toBeInTheDocument()
    expect(screen.getByText('Targets: 1 selected')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Raw Logs' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.change(screen.getByLabelText('Query'), { target: { value: 'trx-1' } })
    await waitFor(() => expect(useLogStore.getState().grepQuery).toBe('trx-1'))

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(startLogStream).toHaveBeenCalledWith(expect.objectContaining({
      context: 'ctx',
      namespace: 'demo',
      pod: targetPod.name,
      container: 'app',
      sourceType: 'info',
      initialTailLines: defaultSettings.initialTailLines,
    })))
    await waitFor(() => expect(useLogStore.getState().streamStatus).toBe('running'))

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(useLogStore.getState().viewerPaused).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(useLogStore.getState().viewerPaused).toBe(false)
    fireEvent.click(screen.getByLabelText('Auto-reconnect'))
    expect(useLogStore.getState().reconnectEnabled).toBe(true)

    fireEvent.click(screen.getByRole('tab', { name: 'Failed Requests' }))
    expect(screen.getByTestId('failed-requests-view')).toBeInTheDocument()
    expect(screen.getByText('Request-centric investigation layer')).toBeInTheDocument()
    expect(screen.getByText('trx-1')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(useLogStore.getState().rows).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByText('Target cache')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear Target Cache' }))
    expect(screen.getByText(/Target cache cleared/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(stopLogStream).toHaveBeenCalled())
  })
})
