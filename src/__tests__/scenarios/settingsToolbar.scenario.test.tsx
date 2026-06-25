import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GrepBar, applyQuerySuggestion, suggestionsForQuery } from '../../components/GrepBar'
import { LogToolbar } from '../../components/LogToolbar'
import { SettingsModal } from '../../components/SettingsModal'
import { getSettings, resetSettings, saveSettings } from '../../commands/tauriSettings'
import { startLogStream, stopLogStream } from '../../commands/tauriLogs'
import { listPods } from '../../commands/tauriKube'
import { defaultSettings } from '../../config/defaultSettings'
import { scopeKey, useKubeStore } from '../../stores/kubeStore'
import { resetLogStoreForTests, useLogStore } from '../../stores/logStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { defaultLogPolicy } from '../../utils/logPolicy'

vi.mock('../../commands/tauriSettings', () => ({
  getSettings: vi.fn(async () => ({ settings: defaultSettings, warning: { code: 'read_failed', message: 'loaded with warning' } })),
  saveSettings: vi.fn(async (settings) => settings),
  resetSettings: vi.fn(async () => defaultSettings),
}))

vi.mock('../../commands/tauriLogs', () => ({
  startLogStream: vi.fn(async () => undefined),
  stopLogStream: vi.fn(async () => undefined),
  stopAllLogStreams: vi.fn(async () => undefined),
}))

vi.mock('../../commands/tauriKube', () => ({
  getCurrentContext: vi.fn(async () => 'ctx'),
  listContexts: vi.fn(async () => ({ contexts: [{ name: 'ctx' }] })),
  listNamespaces: vi.fn(async () => ({ context: 'ctx', namespaces: [{ name: 'foo' }] })),
  listPods: vi.fn(async (namespace: string, context?: string) => ({
    context,
    namespace,
    pods: [{ name: 'api-64cc9db7fd-k9f2p', namespace, phase: 'Running', containers: ['app'] }],
  })),
}))

function installBrowserMocks() {
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
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 0
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
    namespaces: [{ name: 'foo' }],
    namespacesByContext: { ctx: [{ name: 'foo' }] },
    selectedNamespace: 'foo',
    selectedNamespaces: { ctx: ['foo'] },
    pods: [{ name: 'api-7d9', namespace: 'foo', phase: 'Running', containers: ['app'] }],
    podsByScope: { [scopeKey('ctx', 'foo')]: [{ name: 'api-7d9', namespace: 'foo', phase: 'Running', containers: ['app'] }] },
    selectedPod: 'api-7d9',
    selectedPods: { [scopeKey('ctx', 'foo')]: ['api-7d9'] },
    selectedWorkloads: {},
    loadingContexts: false,
    loadingNamespaces: false,
    loadingPods: false,
    cacheRefreshing: false,
    cacheLoaded: true,
    cacheLastRefreshAt: Date.now(),
    error: undefined,
  })
}

describe('settings and toolbar scenario', () => {
  beforeEach(() => {
    installBrowserMocks()
    window.localStorage.clear()
    vi.clearAllMocks()
    resetStores()
    vi.mocked(getSettings).mockResolvedValue({ settings: defaultSettings, warning: { code: 'read_failed', message: 'loaded with warning' } })
    vi.mocked(saveSettings).mockImplementation(async (settings) => settings)
    vi.mocked(resetSettings).mockResolvedValue(defaultSettings)
    vi.mocked(startLogStream).mockResolvedValue(undefined)
    vi.mocked(stopLogStream).mockResolvedValue(undefined)
    vi.mocked(listPods).mockResolvedValue({ context: 'ctx', namespace: 'foo', pods: [{ name: 'api-7d9', namespace: 'foo', phase: 'Running', containers: ['app'] }] })
  })

  it('loads, saves, rejects, resets, and reports settings through the store', async () => {
    await useSettingsStore.getState().loadSettings()
    expect(useSettingsStore.getState().warning?.message).toBe('loaded with warning')
    expect(useLogStore.getState().bufferLimit).toBe(defaultSettings.bufferLimit)

    await expect(useSettingsStore.getState().saveSettings({ ...defaultSettings, initialTailLines: -1 })).resolves.toBe(false)
    expect(useSettingsStore.getState().error?.code).toBe('settings_validation_failed')

    await expect(useSettingsStore.getState().saveSettings({ ...defaultSettings, logPolicy: defaultLogPolicy })).resolves.toBe(true)
    expect(saveSettings).toHaveBeenCalled()

    vi.mocked(saveSettings).mockRejectedValueOnce({ code: 'save_failed', message: 'save failed' })
    await expect(useSettingsStore.getState().saveSettings(defaultSettings)).resolves.toBe(false)
    expect(useSettingsStore.getState().error?.message).toBe('save failed')

    await expect(useSettingsStore.getState().resetSettings()).resolves.toBe(true)
    vi.mocked(resetSettings).mockRejectedValueOnce({ code: 'reset_failed', message: 'reset failed' })
    await expect(useSettingsStore.getState().resetSettings()).resolves.toBe(false)
    expect(useSettingsStore.getState().error?.message).toBe('reset failed')

    vi.mocked(getSettings).mockRejectedValueOnce({ code: 'load_failed', message: 'load failed' })
    await useSettingsStore.getState().loadSettings()
    expect(useSettingsStore.getState().error?.message).toBe('load failed')
  })

  it('edits settings modal draft, validates policy JSON, saves, resets, clears cache, restarts, and closes', async () => {
    const onClose = vi.fn()
    const onRestart = vi.fn()
    const closed = render(<SettingsModal open={false} onClose={onClose} />)
    expect(closed.container).toBeEmptyDOMElement()
    closed.unmount()

    const modal = render(<SettingsModal open onClose={onClose} onRestart={onRestart} />)

    fireEvent.change(screen.getByLabelText(/initial tail lines/i), { target: { value: '77' } })
    fireEvent.change(screen.getByLabelText(/buffer limit/i), { target: { value: '3000' } })
    fireEvent.change(screen.getAllByLabelText('Container')[0], { target: { value: 'sidecar' } })
    const policyInput = screen.getByLabelText(/log policy json/i)
    fireEvent.change(policyInput, { target: { value: '{' } })
    expect(screen.getByText(/logPolicy:/)).toBeInTheDocument()

    const policy = { ...defaultLogPolicy, pathTemplate: '/custom/[namespace]/[podname][suffix].jsonl' }
    fireEvent.change(policyInput, { target: { value: JSON.stringify(policy, null, 2) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      initialTailLines: 77,
      bufferLimit: 3000,
      logSources: expect.objectContaining({ info: expect.objectContaining({ container: 'sidecar' }) }),
    })))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(screen.getByText(/settings reset to defaults/i)).toBeInTheDocument())
    window.localStorage.setItem('klogcat:kube-cache:v1', JSON.stringify({ version: 1, savedAt: Date.now(), contexts: [], namespacesByContext: {} }))
    fireEvent.click(screen.getByRole('button', { name: /clear target cache/i }))
    expect(window.localStorage.getItem('klogcat:kube-cache:v1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /restart app/i }))
    expect(onRestart).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '✕' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    modal.unmount()

    const defaultRestart = render(<SettingsModal open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /restart app/i }))
    defaultRestart.unmount()
  })

  it('uses query suggestions and regex validation from the grep bar keyboard flow', async () => {
    expect(suggestionsForQuery('sta')[0].insert).toBe('status:')
    expect(applyQuerySuggestion('foo sta bar', 6, 'status:')).toEqual({ query: 'foo status: bar', cursor: 11 })

    render(<GrepBar />)
    const input = screen.getByLabelText('Query')
    fireEvent.focus(input)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(useLogStore.getState().grepQuery).not.toBe(''))
    fireEvent.keyDown(input, { ctrlKey: true, code: 'Space' })
    fireEvent.keyDown(input, { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: 'Regex' }))
    fireEvent.change(input, { target: { value: '[' } })
    expect(screen.getByText('invalid regex')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'ok' } })
    fireEvent.click(screen.getByRole('button', { name: 'Regex' }))
    fireEvent.change(input, { target: { value: '(status:500' } })
    expect(screen.getByText('unbalanced parentheses')).toBeInTheDocument()
  })

  it('drives toolbar start, restart, fallback, cancellation, stop, source toggles, and blocked states', async () => {
    const onSourceTypesChange = vi.fn()
    const view = render(<LogToolbar sourceTypes={['info']} onSourceTypesChange={onSourceTypesChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'ACC' }))
    expect(onSourceTypesChange).toHaveBeenCalledWith(['info', 'access'])
    fireEvent.click(screen.getByLabelText('Auto-scroll'))
    expect(useLogStore.getState().autoScrollEnabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(startLogStream).toHaveBeenCalledTimes(1))
    expect(useLogStore.getState().streamStatus).toBe('running')

    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await waitFor(() => expect(stopLogStream).toHaveBeenCalled())

    act(() => useLogStore.getState().resetForSelectionChange())
    let resolveStart!: () => void
    vi.mocked(startLogStream).mockImplementationOnce(() => new Promise<void>((resolve) => { resolveStart = resolve }))
    vi.mocked(stopLogStream).mockRejectedValueOnce(new Error('best effort stop failed'))
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(startLogStream).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    resolveStart()
    await waitFor(() => expect(useLogStore.getState().streamStatus).toBe('error'))

    act(() => useLogStore.getState().resetForSelectionChange())
    vi.mocked(listPods).mockResolvedValueOnce({
      context: 'ctx',
      namespace: 'foo',
      pods: [{ name: 'api-64cc9db7fd-k9f2p', namespace: 'foo', phase: 'Running', containers: ['app'] }],
    })
    useKubeStore.setState({
      selectedPods: { [scopeKey('ctx', 'foo')]: ['api-7d9'] },
      podsByScope: { [scopeKey('ctx', 'foo')]: [{ name: 'api-7d9', namespace: 'foo', phase: 'Running', containers: ['app'] }] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(useLogStore.getState().actionDebugMessages.some((message) => message.includes('Pod live resolve'))).toBe(true))

    act(() => useLogStore.getState().resetForSelectionChange())
    vi.mocked(startLogStream).mockRejectedValueOnce({ code: 'missing', message: 'pod missing' }).mockResolvedValueOnce(undefined)
    vi.mocked(listPods)
      .mockResolvedValueOnce({ context: 'ctx', namespace: 'foo', pods: [{ name: 'api-7d9', namespace: 'foo', phase: 'Running', containers: ['app'] }] })
      .mockResolvedValueOnce({ context: 'ctx', namespace: 'foo', pods: [{ name: 'api-64cc9db7fd-k9f2p', namespace: 'foo', phase: 'Running', containers: ['app'] }] })
    useKubeStore.setState({
      selectedPods: { [scopeKey('ctx', 'foo')]: ['api-7d9'] },
      podsByScope: { [scopeKey('ctx', 'foo')]: [{ name: 'api-7d9', namespace: 'foo', phase: 'Running', containers: ['app'] }] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(startLogStream).toHaveBeenCalledWith(expect.objectContaining({ pod: 'api-64cc9db7fd-k9f2p' })))

    act(() => useLogStore.getState().resetForSelectionChange())
    vi.mocked(listPods).mockResolvedValueOnce({ context: 'ctx', namespace: 'foo', pods: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(useLogStore.getState().errorMessage).toMatch(/no live pod/i))

    view.unmount()
    resetStores()
    useSettingsStore.setState({ settings: undefined, loading: false, warning: undefined, error: undefined })
    render(<LogToolbar sourceTypes={['info']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(useLogStore.getState().errorMessage).toMatch(/settings/i)
  })
})
