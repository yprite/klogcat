import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import App, { handleLogExit } from '../../App'
import { subscribeLogEvents } from '../../commands/tauriLogEvents'
import { startLogStream } from '../../commands/tauriLogs'
import { listPods } from '../../commands/tauriKube'
import { defaultSettings } from '../../config/defaultSettings'
import { resetLogStoreForTests, useLogStore } from '../../stores/logStore'
import { scopeKey, useKubeStore } from '../../stores/kubeStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { ActiveStreamMeta } from '../../types/log'

type LogEventHandlers = Parameters<typeof subscribeLogEvents>[0]
let capturedHandlers: LogEventHandlers | undefined
let cleanup = vi.fn()

vi.mock('../../commands/tauriLogEvents', () => ({
  subscribeLogEvents: vi.fn(async (handlers: LogEventHandlers) => {
    capturedHandlers = handlers
    return cleanup
  }),
}))

vi.mock('../../commands/tauriLogs', () => ({
  startLogStream: vi.fn(async () => undefined),
  stopLogStream: vi.fn(async () => undefined),
  stopAllLogStreams: vi.fn(async () => undefined),
}))

vi.mock('../../commands/tauriKube', () => ({
  getCurrentContext: vi.fn(async () => 'ctx'),
  listContexts: vi.fn(async () => ({ contexts: [{ name: 'ctx' }] })),
  listNamespaces: vi.fn(async () => ({ context: 'ctx', namespaces: [{ name: 'ns' }] })),
  listPods: vi.fn(async (namespace: string, context?: string) => ({ context, namespace, pods: [] })),
}))

vi.mock('../../commands/tauriSettings', () => ({
  getSettings: vi.fn(async () => ({ settings: defaultSettings })),
  saveSettings: vi.fn(async (settings) => settings),
  resetSettings: vi.fn(async () => defaultSettings),
}))

const meta = (streamId: string): ActiveStreamMeta => ({
  streamId,
  sourceId: `src-${streamId}`,
  sourceType: 'info',
  context: 'ctx',
  namespace: 'ns',
  pod: 'api-7d9c8f6b8d-x2abc',
  container: 'app',
  filePath: '/scloud/ns/logs/api-7d9c8f6b8d-x2abc/ns.log',
  initialTailLines: 123,
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

function resetStores() {
  resetLogStoreForTests()
  useSettingsStore.setState({ settings: defaultSettings, warning: undefined, loading: false, error: undefined })
  useKubeStore.setState({
    contexts: [{ name: 'ctx' }],
    currentContext: 'ctx',
    selectedContext: 'ctx',
    selectedContexts: ['ctx'],
    namespaces: [{ name: 'ns' }],
    namespacesByContext: { ctx: [{ name: 'ns' }] },
    selectedNamespace: 'ns',
    selectedNamespaces: { ctx: ['ns'] },
    pods: [{ name: 'api-7d9c8f6b8d-x2abc', namespace: 'ns', phase: 'Running', containers: ['app'] }],
    podsByScope: { [scopeKey('ctx', 'ns')]: [{ name: 'api-7d9c8f6b8d-x2abc', namespace: 'ns', phase: 'Running', containers: ['app'] }] },
    selectedPod: 'api-7d9c8f6b8d-x2abc',
    selectedPods: { [scopeKey('ctx', 'ns')]: ['api-7d9c8f6b8d-x2abc'] },
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

describe('app runtime event scenario', () => {
  beforeEach(() => {
    installLocalStorageMock()
    window.localStorage.clear()
    capturedHandlers = undefined
    cleanup = vi.fn()
    vi.clearAllMocks()
    resetStores()
  })

  it('subscribes to log events and applies started, line, batch, stderr, error, exit, and cleanup callbacks', async () => {
    useLogStore.getState().prepareStarting(meta('s1'))
    const rendered = render(<App />)

    await waitFor(() => expect(subscribeLogEvents).toHaveBeenCalled())
    expect(await screen.findByText('klogcat')).toBeInTheDocument()

    capturedHandlers?.onStarted({ streamId: 's1', receivedAt: 1 })
    expect(useLogStore.getState().streamStatus).toBe('running')
    capturedHandlers?.onLine({ streamId: 's1', sourceType: 'info', raw: '{"message":"one"}', receivedAt: 1 })
    capturedHandlers?.onLines?.({ lines: [{ streamId: 's1', sourceType: 'info', raw: '{"message":"two"}', receivedAt: 2 }], emittedAt: 2 })
    expect(useLogStore.getState().rows.map((row) => row.summary)).toEqual(['one', 'two'])
    expect(useLogStore.getState().actionDebugMessages.some((message) => message.includes('Receiving batched ordered logs'))).toBe(true)
    capturedHandlers?.onStderr({ streamId: 's1', line: 'stderr line', receivedAt: 3 })
    expect(useLogStore.getState().latestStderr).toBe('stderr line')
    capturedHandlers?.onError({ streamId: 's1', code: 'stream_failed', message: 'stream failed' })
    expect(useLogStore.getState().errorMessage).toBe('stream failed')

    useLogStore.getState().prepareStarting(meta('s2'))
    capturedHandlers?.onExit({ streamId: 's2', requestedStop: true })
    expect(useLogStore.getState().activeStreamIds).not.toContain('s2')

    rendered.unmount()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('handles exit errors, reconnect, and pod fallback paths from App', async () => {
    useLogStore.getState().prepareStarting(meta('missing'))
    handleLogExit({ streamId: 'missing', requestedStop: false })
    await waitFor(() => expect(useLogStore.getState().errorMessage).toMatch(/without an exit code/))

    useLogStore.getState().prepareStarting(meta('clean'))
    handleLogExit({ streamId: 'clean', requestedStop: false, exitCode: 0 })
    expect(useLogStore.getState().activeStreamIds).not.toContain('clean')

    useLogStore.getState().prepareStarting(meta('signal'))
    handleLogExit({ streamId: 'signal', requestedStop: false, signal: 'SIGTERM' })
    await waitFor(() => expect(useLogStore.getState().errorMessage).toMatch(/SIGTERM/))

    useLogStore.getState().prepareStarting(meta('reconnect'))
    useLogStore.getState().setReconnectEnabled(true)
    vi.mocked(startLogStream).mockRejectedValueOnce(new Error('reconnect rejected'))
    handleLogExit({ streamId: 'reconnect', requestedStop: false, exitCode: 2 })
    await waitFor(() => expect(startLogStream).toHaveBeenCalledWith(expect.objectContaining({ context: 'ctx', initialTailLines: 123 })))
    await waitFor(() => expect(useLogStore.getState().errorMessage).toBe('reconnect rejected'))

    useLogStore.getState().prepareStarting(meta('reconnect-ok'))
    useLogStore.getState().setReconnectEnabled(true)
    vi.mocked(startLogStream).mockResolvedValueOnce(undefined)
    handleLogExit({ streamId: 'reconnect-ok', requestedStop: false, exitCode: 2 })
    await waitFor(() => expect(useLogStore.getState().streamStatus).toBe('running'))

    useLogStore.getState().setReconnectEnabled(false)
    useLogStore.getState().prepareStarting(meta('plain-error'))
    handleLogExit({ streamId: 'plain-error', requestedStop: false, exitCode: 9 })
    await waitFor(() => expect(useLogStore.getState().errorMessage).toMatch(/code 9/))

    useLogStore.getState().prepareStarting(meta('fallback-missing'))
    useLogStore.getState().recordStderr('fallback-missing', 'pods "api-7d9c8f6b8d-x2abc" not found')
    vi.mocked(listPods).mockResolvedValueOnce({ context: 'ctx', namespace: 'ns', pods: [] })
    handleLogExit({ streamId: 'fallback-missing', requestedStop: false, exitCode: 1 })
    await waitFor(() => expect(useLogStore.getState().errorMessage).toContain('not found'))

    vi.mocked(listPods).mockResolvedValueOnce({
      context: 'ctx',
      namespace: 'ns',
      pods: [{ name: 'api-64cc9db7fd-k9f2p', namespace: 'ns', phase: 'Running', containers: ['app'] }],
    })
    vi.mocked(startLogStream).mockRejectedValueOnce(new Error('fallback rejected'))
    useLogStore.getState().prepareStarting(meta('fallback'))
    useLogStore.getState().recordStderr('fallback', 'Error from server (NotFound): pods "api-7d9c8f6b8d-x2abc" not found')
    useKubeStore.setState({
      selectedPods: { [scopeKey('ctx', 'ns')]: ['api-7d9c8f6b8d-x2abc'] },
      podsByScope: { [scopeKey('ctx', 'ns')]: [{ name: 'api-7d9c8f6b8d-x2abc', namespace: 'ns', phase: 'Running', containers: ['app'] }] },
    })
    handleLogExit({ streamId: 'fallback', requestedStop: false, exitCode: 1 })
    await waitFor(() => expect(startLogStream).toHaveBeenCalledWith(expect.objectContaining({ pod: 'api-64cc9db7fd-k9f2p' })))
    await waitFor(() => expect(useLogStore.getState().errorMessage).toBe('fallback rejected'))

    vi.mocked(listPods).mockResolvedValueOnce({
      context: 'ctx',
      namespace: 'ns',
      pods: [{ name: 'api-64cc9db7fd-k9f2p', namespace: 'ns', phase: 'Running', containers: ['app'] }],
    })
    vi.mocked(startLogStream).mockResolvedValueOnce(undefined)
    useLogStore.getState().prepareStarting(meta('fallback-ok'))
    useLogStore.getState().recordStderr('fallback-ok', 'pods "api-7d9c8f6b8d-x2abc" not found')
    handleLogExit({ streamId: 'fallback-ok', requestedStop: false, exitCode: 1 })
    await waitFor(() => expect(useLogStore.getState().streamStatus).toBe('running'))
  })
})
