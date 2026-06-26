import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LogToolbar } from '../components/LogToolbar'
import { SettingsModal } from '../components/SettingsModal'
import { defaultSettings } from '../config/defaultSettings'
import { useKubeStore } from '../stores/kubeStore'
import { resetLogStoreForTests, useLogStore } from '../stores/logStore'
import { useSettingsStore } from '../stores/settingsStore'
import { listPods } from '../commands/tauriKube'

vi.mock('../commands/tauriSettings', () => ({
  getSettings: vi.fn(async () => ({ settings: defaultSettings })),
  saveSettings: vi.fn(async (settings) => settings),
  resetSettings: vi.fn(async () => defaultSettings),
}))

vi.mock('../commands/tauriLogs', () => ({
  startLogStream: vi.fn(async () => undefined),
  stopLogStream: vi.fn(async () => undefined),
  stopAllLogStreams: vi.fn(async () => undefined),
}))

vi.mock('../commands/tauriKube', () => ({
  getCurrentContext: vi.fn(async () => 'ctx'),
  listContexts: vi.fn(async () => ({ contexts: [{ name: 'ctx' }] })),
  listNamespaces: vi.fn(async () => ({ namespaces: [{ name: 'foo' }] })),
  listPods: vi.fn(async (namespace: string, context?: string) => ({ context, namespace, pods: [{ name: 'api-64cc9db7fd-k9f2p', namespace, phase: 'Running', containers: ['app'] }] })),
}))

function resetStores() {
  resetLogStoreForTests()
  useKubeStore.setState({
    contexts: [{ name: 'ctx' }, { name: 'cluster-a' }],
    currentContext: 'ctx',
    selectedContext: 'ctx',
    selectedContexts: ['ctx'],
    namespaces: [],
    namespacesByContext: {},
    selectedNamespace: undefined,
    selectedNamespaces: {},
    pods: [],
    podsByScope: {},
    selectedPod: undefined,
    selectedPods: {},
    loadingContexts: false,
    loadingNamespaces: false,
    loadingPods: false,
    cacheRefreshing: false,
    cacheLoaded: true,
    cacheLastRefreshAt: Date.now(),
    error: undefined,
  })
  useSettingsStore.setState({
    settings: defaultSettings,
    warning: undefined,
    loading: false,
    error: undefined,
  })
}

describe('button actions', () => {
  beforeEach(() => { vi.clearAllMocks(); resetStores() })

  it('disables Start until a live target is selected and explains why', () => {
    render(<LogToolbar sourceType="info" />)

    const start = screen.getByRole('button', { name: 'Start' })
    expect(start).toBeDisabled()
    expect(start).toHaveAttribute('title', expect.stringMatching(/select namespace and pod/i))
    expect(screen.getByText(/Start: unavailable \(Select namespace and pod\)/)).toBeInTheDocument()
  })

  it('groups log source toggles with stream controls while keeping viewer and status groups separate', () => {
    const onSourceTypesChange = vi.fn()
    render(<LogToolbar sourceTypes={['info']} onSourceTypesChange={onSourceTypesChange} />)

    const streamControls = screen.getByLabelText('Stream controls')
    expect(streamControls).toContainElement(screen.getByRole('button', { name: 'ALL' }))
    expect(streamControls).toContainElement(screen.getByRole('button', { name: 'INFO' }))
    expect(streamControls).toContainElement(screen.getByRole('button', { name: 'ACC' }))
    expect(streamControls).toContainElement(screen.getByRole('button', { name: 'ERR' }))
    expect(streamControls).toContainElement(screen.getByRole('button', { name: 'Stop' }))
    expect(screen.getByLabelText('Viewer controls')).toContainElement(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByLabelText('Runtime status')).toHaveTextContent(/Start: unavailable/)

    fireEvent.click(screen.getByRole('button', { name: 'ACC' }))
    expect(onSourceTypesChange).toHaveBeenCalledWith(['info', 'access'])
  })

  it('disables Stop when no stream is active', () => {
    render(<LogToolbar sourceType="info" />)

    const stop = screen.getByRole('button', { name: 'Stop' })
    expect(stop).toBeDisabled()
    expect(stop).toHaveAttribute('title', expect.stringMatching(/no active stream/i))
  })

  it('auto-selects the pod container internally without showing a container picker', () => {
    useKubeStore.setState({
      selectedContext: 'cluster-a',
      selectedNamespace: 'default',
      selectedPod: 'pod-1',
      pods: [{ name: 'pod-1', namespace: 'default', phase: 'Running', containers: ['worker'] }],
    })
    render(<LogToolbar sourceType="info" />)

    expect(screen.queryByRole('combobox', { name: /container/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/container/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    expect(screen.getByText(/Start: enabled/)).toBeInTheDocument()
  })

  it('shows Start enabled after selecting a Running pod with the configured container', () => {
    useKubeStore.setState({
      selectedNamespace: 'default',
      selectedPod: 'pod-1',
      pods: [{ name: 'pod-1', namespace: 'default', phase: 'Running', containers: ['app'] }],
    })
    render(<LogToolbar sourceType="info" />)

    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    expect(screen.getByText(/Start: enabled/)).toBeInTheDocument()
  })

  it('records visible action debug when Start is clicked', () => {
    useKubeStore.setState({
      selectedNamespace: 'default',
      selectedPod: 'pod-1',
      pods: [{ name: 'pod-1', namespace: 'default', phase: 'Running', containers: ['app'] }],
    })
    render(<LogToolbar sourceType="info" />)

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    expect(useLogStore.getState().actionDebugMessages.at(-1)).toMatch(/Start clicked/)
  })

  it('starts one stream for every selected running pod', async () => {
    const { startLogStream } = await import('../commands/tauriLogs')
    vi.mocked(listPods).mockImplementation(async (namespace: string, context?: string) => ({
      context,
      namespace,
      pods: [{ name: namespace === 'prod' ? 'pod-2' : 'pod-1', namespace, phase: 'Running', containers: [namespace === 'prod' ? 'worker' : 'app'] }],
    }))
    useKubeStore.setState({
      currentContext: 'ctx',
      selectedContexts: ['ctx', 'cluster-a'],
      selectedNamespaces: { ctx: ['default'], 'cluster-a': ['prod'] },
      podsByScope: {
        'ctx\u0000default': [{ name: 'pod-1', namespace: 'default', phase: 'Running', containers: ['app'] }],
        'cluster-a\u0000prod': [{ name: 'pod-2', namespace: 'prod', phase: 'Running', containers: ['worker'] }],
      },
      selectedPods: { 'ctx\u0000default': ['pod-1'], 'cluster-a\u0000prod': ['pod-2'] },
    })
    render(<LogToolbar sourceTypes={['info']} />)

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => expect(startLogStream).toHaveBeenCalledTimes(2))
    expect(startLogStream).toHaveBeenNthCalledWith(1, expect.objectContaining({ context: 'ctx', namespace: 'default', pod: 'pod-1', container: 'app' }))
    expect(startLogStream).toHaveBeenNthCalledWith(2, expect.objectContaining({ context: 'cluster-a', namespace: 'prod', pod: 'pod-2', container: 'worker' }))
  })

  it('refreshes pods and retries with a matching fallback pod when a cached pod disappeared', async () => {
    const { startLogStream } = await import('../commands/tauriLogs')
    vi.mocked(startLogStream)
      .mockRejectedValueOnce({ code: 'stream_spawn_failed', message: 'pods "api-7d9c8f6b8d-x2abc" not found' })
      .mockResolvedValueOnce(undefined)
    vi.mocked(listPods)
      .mockResolvedValueOnce({
        context: 'ctx',
        namespace: 'foo',
        pods: [{ name: 'api-7d9c8f6b8d-x2abc', namespace: 'foo', phase: 'Running', containers: ['app'] }],
      })
      .mockResolvedValueOnce({
        context: 'ctx',
        namespace: 'foo',
        pods: [{ name: 'api-64cc9db7fd-k9f2p', namespace: 'foo', phase: 'Running', containers: ['app'] }],
      })
    useKubeStore.setState({
      currentContext: 'ctx',
      selectedContexts: ['ctx'],
      selectedNamespaces: { ctx: ['foo'] },
      podsByScope: {
        'ctx\u0000foo': [{ name: 'api-7d9c8f6b8d-x2abc', namespace: 'foo', phase: 'Running', containers: ['app'] }],
      },
      selectedPods: { 'ctx\u0000foo': ['api-7d9c8f6b8d-x2abc'] },
    })
    render(<LogToolbar sourceTypes={['info']} />)

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => expect(startLogStream).toHaveBeenCalledTimes(2))
    expect(startLogStream).toHaveBeenNthCalledWith(1, expect.objectContaining({ pod: 'api-7d9c8f6b8d-x2abc' }))
    expect(startLogStream).toHaveBeenNthCalledWith(2, expect.objectContaining({ pod: 'api-64cc9db7fd-k9f2p', filePath: '/scloud/foo/logs/api-64cc9db7fd-k9f2p/foo.log' }))
    expect(useKubeStore.getState().selectedPods['ctx\u0000foo']).toEqual(['api-64cc9db7fd-k9f2p'])
    expect(useLogStore.getState().actionDebugMessages.some((message) => message.includes('Pod fallback'))).toBe(true)
  })

  it('refreshes selected pods before starting and uses the current matching pod without launching a stale pod first', async () => {
    const { startLogStream } = await import('../commands/tauriLogs')
    vi.mocked(listPods).mockResolvedValueOnce({
      context: 'ctx',
      namespace: 'foo',
      pods: [{ name: 'api-64cc9db7fd-k9f2p', namespace: 'foo', phase: 'Running', containers: ['app'] }],
    })
    useKubeStore.setState({
      currentContext: 'ctx',
      selectedContexts: ['ctx'],
      selectedNamespaces: { ctx: ['foo'] },
      podsByScope: {
        'ctx\u0000foo': [{ name: 'api-7d9c8f6b8d-x2abc', namespace: 'foo', phase: 'Running', containers: ['app'] }],
      },
      selectedPods: { 'ctx\u0000foo': ['api-7d9c8f6b8d-x2abc'] },
    })
    render(<LogToolbar sourceTypes={['info']} />)

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => expect(startLogStream).toHaveBeenCalledTimes(1))
    expect(listPods).toHaveBeenCalledWith('foo', 'ctx')
    expect(startLogStream).toHaveBeenCalledWith(expect.objectContaining({ pod: 'api-64cc9db7fd-k9f2p' }))
    expect(startLogStream).not.toHaveBeenCalledWith(expect.objectContaining({ pod: 'api-7d9c8f6b8d-x2abc' }))
    expect(useKubeStore.getState().selectedPods['ctx\u0000foo']).toEqual(['api-64cc9db7fd-k9f2p'])
  })

  it('does not launch a selected stale pod when live refresh finds no replacement', async () => {
    const { startLogStream } = await import('../commands/tauriLogs')
    vi.mocked(listPods).mockResolvedValueOnce({ namespace: 'foo', pods: [] })
    useKubeStore.setState({
      currentContext: 'ctx',
      selectedContexts: ['ctx'],
      selectedNamespaces: { ctx: ['foo'] },
      podsByScope: {
        'ctx\u0000foo': [{ name: 'api-7d9c8f6b8d-x2abc', namespace: 'foo', phase: 'Running', containers: ['app'] }],
      },
      selectedPods: { 'ctx\u0000foo': ['api-7d9c8f6b8d-x2abc'] },
    })
    render(<LogToolbar sourceTypes={['info']} />)

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => expect(useLogStore.getState().errorMessage).toMatch(/no live pod/i))
    expect(startLogStream).not.toHaveBeenCalled()
  })

  it('clears Kubernetes target cache from settings and exposes restart', () => {
    const restart = vi.fn()
    const storage = (() => {
      const values = new Map<string, string>()
      return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value) },
        removeItem: (key: string) => { values.delete(key) },
        clear: () => { values.clear() },
        key: (index: number) => Array.from(values.keys())[index] ?? null,
        get length() { return values.size },
      } as Storage
    })()
    vi.stubGlobal('localStorage', storage)
    localStorage.setItem('klogcat:kube-cache:v1', JSON.stringify({ version: 1, savedAt: Date.now(), currentContext: 'ctx', contexts: [{ name: 'ctx' }], namespacesByContext: { ctx: [{ name: 'foo' }] }, podsByScope: { 'ctx\u0000foo': [{ name: 'api-1', namespace: 'foo', phase: 'Running', containers: ['app'] }] } }))
    useKubeStore.setState({
      contexts: [{ name: 'ctx' }],
      currentContext: 'ctx',
      selectedContexts: ['ctx'],
      selectedNamespaces: { ctx: ['foo'] },
      podsByScope: { 'ctx\u0000foo': [{ name: 'api-1', namespace: 'foo', phase: 'Running', containers: ['app'] }] },
      selectedPods: { 'ctx\u0000foo': ['api-1'] },
      cacheLastRefreshAt: Date.now(),
    })

    render(<SettingsModal open onClose={() => {}} onRestart={restart} />)

    fireEvent.click(screen.getByRole('button', { name: /clear target cache/i }))
    expect(localStorage.getItem('klogcat:kube-cache:v1')).toBeNull()
    expect(useKubeStore.getState().selectedPods).toEqual({})
    expect(screen.getByText(/target cache cleared/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /restart app/i }))
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it('shows animated progress while streams are starting', async () => {
    const { startLogStream } = await import('../commands/tauriLogs')
    let resolveStart!: () => void
    vi.mocked(startLogStream).mockImplementationOnce(() => new Promise<void>((resolve) => { resolveStart = resolve }))
    useKubeStore.setState({
      currentContext: 'ctx',
      selectedContexts: ['ctx'],
      selectedNamespaces: { ctx: ['foo'] },
      podsByScope: {
        'ctx\u0000foo': [{ name: 'api-7d9', namespace: 'foo', phase: 'Running', containers: ['app'] }],
      },
      selectedPods: { 'ctx\u0000foo': ['api-7d9'] },
    })
    render(<LogToolbar sourceTypes={['info']} />)

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => expect(screen.getByRole('status', { name: /starting streams/i })).toHaveClass('animate-klogcat-status-glow'))
    expect(screen.getAllByLabelText(/starting streams progress/i).some((element) => Boolean(element.querySelector('.animate-klogcat-progress')))).toBe(true)
    await act(async () => { resolveStart() })
    await waitFor(() => expect(useLogStore.getState().streamStatus).toBe('running'))
  })

  it('starts INFO, ACC, and ERR streams when all source types are selected', async () => {
    const { startLogStream } = await import('../commands/tauriLogs')
    vi.mocked(listPods).mockResolvedValue({ namespace: 'foo', pods: [{ name: 'api-7d9', namespace: 'foo', phase: 'Running', containers: ['app'] }] })
    useKubeStore.setState({
      currentContext: 'ctx',
      selectedContexts: ['ctx'],
      selectedNamespaces: { ctx: ['foo'] },
      podsByScope: {
        'ctx\u0000foo': [{ name: 'api-7d9', namespace: 'foo', phase: 'Running', containers: ['app'] }],
      },
      selectedPods: { 'ctx\u0000foo': ['api-7d9'] },
    })
    render(<LogToolbar sourceTypes={['info', 'access', 'error']} />)

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => expect(startLogStream).toHaveBeenCalledTimes(3))
    expect(startLogStream).toHaveBeenNthCalledWith(1, expect.objectContaining({ sourceType: 'info', filePath: '/scloud/foo/logs/api-7d9/foo.log' }))
    expect(startLogStream).toHaveBeenNthCalledWith(2, expect.objectContaining({ sourceType: 'access', filePath: '/scloud/foo/logs/api-7d9/foo_ACC.log' }))
    expect(startLogStream).toHaveBeenNthCalledWith(3, expect.objectContaining({ sourceType: 'error', filePath: '/scloud/foo/logs/api-7d9/foo_ERR.log' }))
  })

  it('stops launching remaining selected log types when Stop is clicked during batch start', async () => {
    const { startLogStream, stopLogStream } = await import('../commands/tauriLogs')
    let resolveFirst!: () => void
    vi.mocked(startLogStream).mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve }))
    useKubeStore.setState({
      currentContext: 'ctx',
      selectedContexts: ['ctx'],
      selectedNamespaces: { ctx: ['foo'] },
      podsByScope: {
        'ctx\u0000foo': [{ name: 'api-7d9', namespace: 'foo', phase: 'Running', containers: ['app'] }],
      },
      selectedPods: { 'ctx\u0000foo': ['api-7d9'] },
    })
    render(<LogToolbar sourceTypes={['info', 'access', 'error']} />)

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(startLogStream).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(stopLogStream).toHaveBeenCalledTimes(1))

    resolveFirst()
    await waitFor(() => expect(useLogStore.getState().streamStatus).toBe('stopped'))
    expect(startLogStream).toHaveBeenCalledTimes(1)
  })

  it('uses the fixed scloud namespace and pod log path for each source type', async () => {
    const { startLogStream } = await import('../commands/tauriLogs')
    vi.mocked(listPods).mockResolvedValue({ namespace: 'foo', pods: [{ name: 'api-7d9', namespace: 'foo', phase: 'Running', containers: ['app'] }] })
    useKubeStore.setState({
      currentContext: 'ctx',
      selectedContexts: ['ctx'],
      selectedNamespaces: { ctx: ['foo'] },
      podsByScope: {
        'ctx\u0000foo': [{ name: 'api-7d9', namespace: 'foo', phase: 'Running', containers: ['app'] }],
      },
      selectedPods: { 'ctx\u0000foo': ['api-7d9'] },
    })
    const { rerender } = render(<LogToolbar sourceType="info" />)

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(startLogStream).toHaveBeenLastCalledWith(expect.objectContaining({ filePath: '/scloud/foo/logs/api-7d9/foo.log' })))

    act(() => useLogStore.getState().resetForSelectionChange())
    vi.clearAllMocks()
    rerender(<LogToolbar sourceType="access" />)
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(startLogStream).toHaveBeenLastCalledWith(expect.objectContaining({ filePath: '/scloud/foo/logs/api-7d9/foo_ACC.log' })))

    act(() => useLogStore.getState().resetForSelectionChange())
    vi.clearAllMocks()
    rerender(<LogToolbar sourceType="error" />)
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(startLogStream).toHaveBeenLastCalledWith(expect.objectContaining({ filePath: '/scloud/foo/logs/api-7d9/foo_ERR.log' })))
  })

  it('makes Reset visibly update the draft and show feedback', async () => {
    const custom = { ...defaultSettings, initialTailLines: 7, bufferLimit: 11 }
    useSettingsStore.setState({ settings: custom })
    render(<SettingsModal open={true} onClose={() => {}} />)

    expect(screen.getByLabelText(/initial tail lines/i)).toHaveValue(7)

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))

    await waitFor(() => expect(screen.getByLabelText(/initial tail lines/i)).toHaveValue(defaultSettings.initialTailLines))
    expect(screen.getByText(/settings reset to defaults/i)).toBeInTheDocument()
  })

  it('lets Settings select Custom JSON before editing and saving policy details', async () => {
    const { saveSettings } = await import('../commands/tauriSettings')
    render(<SettingsModal open={true} onClose={() => {}} />)

    fireEvent.change(screen.getByRole('combobox', { name: /log policy/i }), { target: { value: 'custom' } })
    fireEvent.click(screen.getByRole('button', { name: /advanced raw json/i }))
    const policyInput = screen.getByLabelText(/custom policy json/i)
    const policy = JSON.parse(policyInput.textContent ?? '')
    policy.pathTemplate = '/custom/[namespace]/[podname][suffix].jsonl'
    policy.sources.info.label = 'APP'

    fireEvent.change(policyInput, { target: { value: JSON.stringify(policy, null, 2) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      logPolicyId: 'custom',
      logPolicy: expect.objectContaining({
        pathTemplate: '/custom/[namespace]/[podname][suffix].jsonl',
        sources: expect.objectContaining({ info: expect.objectContaining({ label: 'APP' }) }),
      }),
    })))
  })
})
