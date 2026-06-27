import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from '../src/App'
import accFixture from '../src/__fixtures__/acc.valid.jsonl?raw'
import errFixture from '../src/__fixtures__/err.valid.jsonl?raw'
import { defaultSettings } from '../src/config/defaultSettings'
import { getSettings, saveSettings } from '../src/commands/tauriSettings'
import { startLogStream, stopLogStream } from '../src/commands/tauriLogs'
import { resetLogStoreForTests, useLogStore } from '../src/stores/logStore'
import { useKubeStore } from '../src/stores/kubeStore'
import { useSettingsStore } from '../src/stores/settingsStore'
import { failedRequestsExtensionModule } from '../src/extensions/examples/FailedRequestsExtension'
import { activateKlogcatExtensionModule } from '../src/extensions/logViewerExtensionLoader'
import { resetLogViewerExtensionsForTests } from '../src/extensions/logViewerExtensions'
import type { GetSettingsResponse, PersistedSettings, SettingsWarning } from '../src/types/settings'
import type { ContextInfo, PodInfo } from '../src/types/kube'
import type {
  LogLineEvent,
  LogLinesEvent,
  LogStreamErrorEvent,
  LogStreamExitEvent,
  LogStreamStartedEvent,
  LogStreamStderrEvent,
} from '../src/types/log'

type LogEventHandlers = {
  onStarted: (event: LogStreamStartedEvent) => void
  onLine: (event: LogLineEvent) => void
  onLines?: (event: LogLinesEvent) => void
  onStderr: (event: LogStreamStderrEvent) => void
  onExit: (event: LogStreamExitEvent) => void
  onError: (event: LogStreamErrorEvent) => void
}

type StartRequest = {
  streamId: string
  context?: string
  namespace: string
  pod: string
  container: string
  filePath: string
  sourceType: string
  initialTailLines: number
}

const fakeBackend = vi.hoisted(() => ({
  currentContext: 'cluster-a',
  contexts: [] as ContextInfo[],
  namespacesByContext: {} as Record<string, { name: string }[]>,
  podsByScope: {} as Record<string, PodInfo[]>,
  settings: undefined as PersistedSettings | undefined,
  warning: undefined as SettingsWarning | undefined,
  handlers: undefined as LogEventHandlers | undefined,
  cleanup: vi.fn(),
  startRequests: [] as StartRequest[],
  stopRequests: [] as string[],
}))

vi.mock('../src/commands/tauriLogEvents', () => ({
  subscribeLogEvents: vi.fn(async (handlers: LogEventHandlers) => {
    fakeBackend.handlers = handlers
    return fakeBackend.cleanup
  }),
}))

vi.mock('../src/commands/tauriKube', () => ({
  getCurrentContext: vi.fn(async () => fakeBackend.currentContext),
  listContexts: vi.fn(async () => ({ contexts: fakeBackend.contexts })),
  listNamespaces: vi.fn(async (context?: string) => ({ context, namespaces: fakeBackend.namespacesByContext[context ?? ''] ?? [] })),
  listPods: vi.fn(async (namespace: string, context?: string) => ({ context, namespace, pods: fakeBackend.podsByScope[`${context ?? ''}\u0000${namespace}`] ?? [] })),
}))

vi.mock('../src/commands/tauriLogs', () => ({
  startLogStream: vi.fn(async (request: StartRequest) => {
    fakeBackend.startRequests.push(request)
  }),
  stopLogStream: vi.fn(async (streamId: string) => {
    fakeBackend.stopRequests.push(streamId)
  }),
  stopAllLogStreams: vi.fn(async () => undefined),
}))

vi.mock('../src/commands/tauriSettings', () => ({
  getSettings: vi.fn(async (): Promise<GetSettingsResponse> => ({ settings: fakeBackend.settings!, warning: fakeBackend.warning })),
  saveSettings: vi.fn(async (settings: PersistedSettings) => {
    fakeBackend.settings = settings
    return settings
  }),
  resetSettings: vi.fn(async () => {
    fakeBackend.settings = defaultSettings
    return defaultSettings
  }),
}))

const repoRoot = path.resolve(__dirname, '..')
const prodAssets = [
  path.join(repoRoot, 'dist', 'index.html'),
]

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

function resetKubeStore() {
  useKubeStore.setState({
    contexts: [],
    currentContext: undefined,
    selectedContext: undefined,
    selectedContexts: [],
    namespaces: [],
    namespacesByContext: {},
    selectedNamespace: undefined,
    selectedNamespaces: {},
    pods: [],
    podsByScope: {},
    selectedPod: undefined,
    selectedPods: {},
    selectedWorkloads: {},
    loadingContexts: false,
    loadingNamespaces: false,
    loadingPods: false,
    cacheLoaded: false,
    cacheRefreshing: false,
    cacheLastRefreshAt: undefined,
    error: undefined,
  })
}

function resetFakeBackend() {
  fakeBackend.currentContext = 'cluster-a'
  fakeBackend.contexts = []
  fakeBackend.namespacesByContext = {}
  fakeBackend.podsByScope = {}
  fakeBackend.settings = { ...defaultSettings, logSources: { ...defaultSettings.logSources } }
  fakeBackend.warning = undefined
  fakeBackend.handlers = undefined
  fakeBackend.cleanup = vi.fn()
  fakeBackend.startRequests = []
  fakeBackend.stopRequests = []
}

function seedKubernetesTargets() {
  fakeBackend.contexts = [{ name: 'cluster-a' }]
  fakeBackend.namespacesByContext = { 'cluster-a': [{ name: 'prod' }] }
  fakeBackend.podsByScope = {
    'cluster-a\u0000prod': [
      { name: 'api-7d9c8f6b8d-x2abc', namespace: 'prod', phase: 'Running', containers: ['app'] },
      { name: 'api-pending', namespace: 'prod', phase: 'Pending', containers: ['app'] },
    ],
  }
}

function renderProductApp() {
  render(<App />)
  return screen.findByText('klogcat')
}

function firstFixtureLine(input: string) {
  return input.trim().split('\n')[0]!
}

function correlatedErrorLine() {
  const error = JSON.parse(firstFixtureLine(errFixture)) as Record<string, unknown>
  error.trId = 'acc-trace-1'
  return JSON.stringify(error)
}

describe('product quality e2e', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    installLocalStorageMock()
    window.localStorage.clear()
    resetLogViewerExtensionsForTests()
    resetLogStoreForTests()
    resetKubeStore()
    resetFakeBackend()
    useSettingsStore.setState({ settings: defaultSettings, loading: false, error: undefined, warning: undefined })
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.clearAllMocks()
  })

  afterEach(() => {
    const appConsoleErrors = consoleErrorSpy.mock.calls.filter(([message]) => !String(message).includes('not wrapped in act'))
    expect(appConsoleErrors).toEqual([])
    consoleErrorSpy.mockRestore()
  })

  it('boots from production assets and keeps browser fallback states recoverable', async () => {
    fakeBackend.warning = { code: 'read_failed', message: 'loaded with fallback settings' }
    for (const asset of prodAssets) expect(fs.existsSync(asset)).toBe(true)

    await renderProductApp()

    expect(getSettings).toHaveBeenCalled()
    expect(screen.getByText('loaded with fallback settings')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change Targets' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Choose Target' })[0]).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Raw Logs' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: 'Failed Requests' })).not.toBeInTheDocument()

    await waitFor(() => expect(screen.getByText(/Start: unavailable \(Select namespace and pod\)/)).toBeInTheDocument())
    expect(screen.getByLabelText('Runtime status')).toHaveTextContent(/Targets\s*0/)

    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Start' })).toHaveAttribute('title', expect.stringMatching(/Select namespace and pod/))

    fireEvent.click(screen.getAllByRole('button', { name: 'Choose Target' })[0])
    const targetDialog = await screen.findByRole('dialog', { name: /select log targets/i })
    expect(within(targetDialog).getByText('No selectable pods loaded')).toBeInTheDocument()
    expect(within(targetDialog).getByText(/Check kubectl access/)).toBeInTheDocument()
    expect(within(targetDialog).getByText('No pods selected')).toBeInTheDocument()
    fireEvent.click(within(targetDialog).getByRole('button', { name: 'Close' }))

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Initial tail lines/), { target: { value: '321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saveSettings).toHaveBeenCalled())
    expect(fakeBackend.settings?.initialTailLines).toBe(321)
  })

  it('drives the Kubernetes target, stream contract, log event, failed request, and cleanup flow', async () => {
    activateKlogcatExtensionModule(failedRequestsExtensionModule)
    seedKubernetesTargets()
    fakeBackend.settings = { ...defaultSettings, initialTailLines: 77 }

    await renderProductApp()
    fireEvent.click(screen.getAllByRole('button', { name: 'Choose Target' })[0])
    const targetDialog = await screen.findByRole('dialog', { name: /select log targets/i })
    await waitFor(() => expect(within(targetDialog).getByText('api-7d9c8f6b8d-x2abc')).toBeInTheDocument())

    fireEvent.click(within(targetDialog).getByText('prod').closest('label')!.querySelector('input')!)
    await waitFor(() => expect(within(targetDialog).getByLabelText('cluster-a / prod / api-7d9c8f6b8d-x2abc')).toBeEnabled())
    fireEvent.click(within(targetDialog).getByLabelText('cluster-a / prod / api-7d9c8f6b8d-x2abc'))
    await waitFor(() => expect(within(targetDialog).getByText(/cluster-a \/ prod \/ api-7d9c8f6b8d-x2abc/)).toBeInTheDocument())
    await waitFor(() => expect(screen.getAllByText(/Targets: 1/).length).toBeGreaterThan(0))
    fireEvent.click(within(targetDialog).getByRole('button', { name: 'Close' }))

    fireEvent.click(screen.getByRole('button', { name: 'ALL' }))
    await act(async () => undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => expect(startLogStream).toHaveBeenCalledTimes(3))
    expect(fakeBackend.startRequests.map((request) => request.sourceType)).toEqual(['info', 'access', 'error'])
    expect(fakeBackend.startRequests[0]).toEqual(expect.objectContaining({
      context: 'cluster-a',
      namespace: 'prod',
      pod: 'api-7d9c8f6b8d-x2abc',
      container: 'app',
      initialTailLines: 77,
    }))
    expect(fakeBackend.startRequests[1]?.filePath).toContain('_ACC.log')
    expect(fakeBackend.startRequests[2]?.filePath).toContain('_ERR.log')

    await act(async () => {
      fakeBackend.startRequests.forEach((request, index) => {
        fakeBackend.handlers?.onStarted({ streamId: request.streamId, receivedAt: index + 1 })
      })
      fakeBackend.handlers?.onLines?.({
        emittedAt: 10,
        lines: [
          { streamId: fakeBackend.startRequests[1]!.streamId, sourceType: 'access', raw: firstFixtureLine(accFixture), receivedAt: 10 },
          { streamId: fakeBackend.startRequests[2]!.streamId, sourceType: 'error', raw: correlatedErrorLine(), receivedAt: 11 },
        ],
      })
    })

    await waitFor(() => expect(useLogStore.getState().visibleRows).toHaveLength(2))
    await waitFor(() => expect(screen.getAllByText('Rows: 2/2').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('tab', { name: 'Failed Requests' }))
    const failedView = await screen.findByTestId('failed-requests-view')
    expect(within(failedView).getByText('Request-centric investigation layer')).toBeInTheDocument()
    expect(within(failedView).getByText('Failed request groups')).toBeInTheDocument()
    expect(within(failedView).getByText('1')).toBeInTheDocument()
    expect(within(failedView).getByText(/OpenTabMigrationFailedException/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Change Targets' }))
    const cleanupDialog = await screen.findByRole('dialog', { name: /select log targets/i })
    fireEvent.click(within(cleanupDialog).getByText(/cluster-a \/ prod \/ api-7d9c8f6b8d-x2abc/))
    await waitFor(() => expect(stopLogStream).toHaveBeenCalledTimes(3))
    expect(fakeBackend.stopRequests).toEqual(fakeBackend.startRequests.map((request) => request.streamId))
  })

  it('keeps desktop release validation explicit through the protected-branch gate', () => {
    const prePush = fs.readFileSync(path.join(repoRoot, 'scripts', 'harness', 'pre-push.sh'), 'utf8')
    const reportScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'harness', 'prepush-report.mjs'), 'utf8')
    const releaseBinary = path.join(repoRoot, 'src-tauri', 'target', 'release', process.platform === 'win32' ? 'klogcat.exe' : 'klogcat')

    expect(prePush).toContain('refs/heads/main')
    expect(prePush).toContain('refs/heads/release/*')
    expect(prePush).toContain('refs/tags/v*')
    expect(prePush).toContain('npm run tauri build -- --no-bundle')
    expect(prePush).toContain('src-tauri/target/release/klogcat')
    expect(reportScript).toContain("tauriBuild: releaseGate")

    if (fs.existsSync(releaseBinary)) {
      expect(fs.statSync(releaseBinary).mode & 0o111).toBeGreaterThan(0)
    }
  })
})
