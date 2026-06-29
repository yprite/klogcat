import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { handleLogExit } from '../App'
import { defaultSettings } from '../config/defaultSettings'
import { startLogStream } from '../commands/tauriLogs'
import { listPods } from '../commands/tauriKube'
import { resetLogStoreForTests, useLogStore } from '../stores/logStore'
import { useKubeStore } from '../stores/kubeStore'
import { useSettingsStore } from '../stores/settingsStore'
import { buildLogPathFromPolicy, defaultLogPolicy } from '../utils/logPolicy'
import type { ActiveStreamMeta } from '../types/log'

vi.mock('../commands/tauriLogEvents', () => ({
  subscribeLogEvents: vi.fn(),
}))
vi.mock('../commands/tauriLogs', () => ({
  startLogStream: vi.fn(async () => undefined),
}))
vi.mock('../commands/tauriKube', () => ({
  listPods: vi.fn(async (namespace: string, context?: string) => ({ context, namespace, pods: [] })),
  getCurrentContext: vi.fn(async () => 'ctx'),
  listContexts: vi.fn(async () => ({ contexts: [{ name: 'ctx' }] })),
  listNamespaces: vi.fn(async () => ({ namespaces: [{ name: 'ns' }] })),
}))

const meta = (streamId: string): ActiveStreamMeta => ({
  streamId,
  sourceId: 'src',
  sourceType: 'info',
  namespace: 'ns',
  pod: 'pod',
  container: 'app',
  filePath: '/x',
})

describe('Info log exit handling', () => {
  beforeEach(() => {
    resetLogStoreForTests()
    useSettingsStore.setState({
      settings: defaultSettings,
      warning: undefined,
      loading: false,
      error: undefined,
    })
    vi.mocked(startLogStream).mockClear()
    vi.mocked(listPods).mockReset().mockResolvedValue({ context: 'ctx', namespace: 'ns', pods: [] })
    useKubeStore.setState({
      contexts: [{ name: 'ctx' }],
      currentContext: 'ctx',
      selectedContext: 'ctx',
      selectedContexts: ['ctx'],
      namespaces: [{ name: 'ns' }],
      namespacesByContext: { ctx: [{ name: 'ns' }] },
      selectedNamespace: 'ns',
      selectedNamespaces: { ctx: ['ns'] },
      pods: [],
      podsByScope: {},
      selectedPod: undefined,
      selectedPods: {},
      loadingContexts: false,
      loadingNamespaces: false,
      loadingPods: false,
      cacheLoaded: true,
      cacheRefreshing: false,
      cacheLastRefreshAt: undefined,
      error: undefined,
    })
  })

  it('treats requested stops as stopped', () => {
    useLogStore.getState().prepareStarting(meta('s1'))
    handleLogExit({ streamId: 's1', requestedStop: true })
    expect(useLogStore.getState().streamStatus).toBe('stopped')
  })

  it('treats non-requested missing, signal, and nonzero exits as errors', async () => {
    useLogStore.getState().prepareStarting(meta('missing'))
    handleLogExit({ streamId: 'missing', requestedStop: false })
    await waitFor(() => expect(useLogStore.getState().streamStatus).toBe('error'))
    expect(useLogStore.getState().errorMessage).toMatch(/without an exit code/)

    useLogStore.getState().prepareStarting(meta('signal'))
    handleLogExit({ streamId: 'signal', requestedStop: false, signal: 'SIGTERM' })
    await waitFor(() => expect(useLogStore.getState().errorMessage).toMatch(/SIGTERM/))
    expect(useLogStore.getState().streamStatus).toBe('error')

    useLogStore.getState().prepareStarting(meta('code'))
    handleLogExit({ streamId: 'code', requestedStop: false, exitCode: 2 })
    await waitFor(() => expect(useLogStore.getState().errorMessage).toMatch(/code 2/))
    expect(useLogStore.getState().streamStatus).toBe('error')
  })

  it('allows non-requested zero exits', () => {
    useLogStore.getState().prepareStarting(meta('s1'))
    handleLogExit({ streamId: 's1', requestedStop: false, exitCode: 0 })
    expect(useLogStore.getState().streamStatus).toBe('stopped')
  })

  it('reconnects unexpected exits when auto-reconnect is enabled', async () => {
    useLogStore.getState().prepareStarting({ ...meta('s1'), context: 'ctx', initialTailLines: 123 })
    useLogStore.getState().setReconnectEnabled(true)
    handleLogExit({ streamId: 's1', requestedStop: false, exitCode: 2 })

    await waitFor(() => expect(startLogStream).toHaveBeenCalledWith(expect.objectContaining({ context: 'ctx', initialTailLines: 123 })))
    expect(vi.mocked(startLogStream).mock.calls[0][0].streamId).toMatch(/^s1-retry-[0-9a-f-]+$/)
    expect(useLogStore.getState().activeStreamIds).toEqual([vi.mocked(startLogStream).mock.calls[0][0].streamId])
    expect(useLogStore.getState().actionDebugMessages.at(-1)).toMatch(/Reconnect scheduled/)
  })

  it('refreshes pods and retries with a fallback pod when kubectl exits after Error from server NotFound', async () => {
    vi.mocked(listPods).mockResolvedValueOnce({
      context: 'ctx',
      namespace: 'ns',
      pods: [{ name: 'api-64cc9db7fd-k9f2p', namespace: 'ns', phase: 'Running', containers: ['app'] }],
    })
    useKubeStore.setState({
      selectedPods: { 'ctx\u0000ns': ['api-7d9c8f6b8d-x2abc'] },
      podsByScope: {
        'ctx\u0000ns': [{ name: 'api-7d9c8f6b8d-x2abc', namespace: 'ns', phase: 'Running', containers: ['app'] }],
      },
    })
    useLogStore.getState().prepareStarting({ ...meta('s1'), context: 'ctx', pod: 'api-7d9c8f6b8d-x2abc', filePath: '/scloud/ns/logs/api-7d9c8f6b8d-x2abc/ns.log', initialTailLines: 123 })
    useLogStore.getState().recordStderr('s1', 'Error from server (NotFound): pods "api-7d9c8f6b8d-x2abc" not found')

    handleLogExit({ streamId: 's1', requestedStop: false, exitCode: 1 })

    await waitFor(() => expect(startLogStream).toHaveBeenCalledWith(expect.objectContaining({
      context: 'ctx',
      namespace: 'ns',
      pod: 'api-64cc9db7fd-k9f2p',
      container: 'app',
      filePath: '/scloud/ns/logs/api-64cc9db7fd-k9f2p/ns.log',
      initialTailLines: 123,
    })))
    expect(useKubeStore.getState().selectedPods['ctx\u0000ns']).toEqual(['api-64cc9db7fd-k9f2p'])
    expect(useLogStore.getState().actionDebugMessages.some((message) => message.includes('Pod fallback on exit'))).toBe(true)
  })

  it('uses the active log policy for fallback stream file paths', async () => {
    const customPolicy = {
      ...defaultLogPolicy,
      pathTemplate: '/custom/[namespace]/logs/[pod].txt',
    }
    const expectedPath = buildLogPathFromPolicy(customPolicy, 'ns', 'api-64cc9db7fd-k9f2p', 'info')
    useSettingsStore.setState({
      settings: { ...defaultSettings, logPolicy: customPolicy },
      warning: undefined,
      loading: false,
      error: undefined,
    })
    vi.mocked(listPods).mockResolvedValueOnce({
      context: 'ctx',
      namespace: 'ns',
      pods: [{ name: 'api-64cc9db7fd-k9f2p', namespace: 'ns', phase: 'Running', containers: ['app'] }],
    })
    useKubeStore.setState({
      selectedPods: { 'ctx\u0000ns': ['api-7d9c8f6b8d-x2abc'] },
      podsByScope: {
        'ctx\u0000ns': [{ name: 'api-7d9c8f6b8d-x2abc', namespace: 'ns', phase: 'Running', containers: ['app'] }],
      },
    })
    useLogStore.getState().prepareStarting({ ...meta('s1'), context: 'ctx', pod: 'api-7d9c8f6b8d-x2abc' })
    useLogStore.getState().recordStderr('s1', 'Error from server (NotFound): pods "api-7d9c8f6b8d-x2abc" not found')

    handleLogExit({ streamId: 's1', requestedStop: false, exitCode: 1 })

    await waitFor(() => expect(startLogStream).toHaveBeenCalledWith(expect.objectContaining({
      pod: 'api-64cc9db7fd-k9f2p',
      filePath: expectedPath,
    })))
  })
})
