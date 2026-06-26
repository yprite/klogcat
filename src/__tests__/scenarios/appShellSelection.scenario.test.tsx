import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AppShell } from '../../components/AppShell'
import { defaultSettings } from '../../config/defaultSettings'
import { scopeKey, useKubeStore } from '../../stores/kubeStore'
import { resetLogStoreForTests, useLogStore } from '../../stores/logStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { ActiveStreamMeta, ParsedLogLine } from '../../types/log'
import { stopLogStream } from '../../commands/tauriLogs'
import { registerLogViewerExtension, resetLogViewerExtensionsForTests } from '../../extensions/logViewerExtensions'
import type { LogViewerExtensionProps } from '../../sdk/log-viewer'

const settingsResponse = vi.hoisted(() => ({
  defaultNamespace: 'missing',
  warningMessage: 'settings warning',
}))

vi.mock('../../commands/tauriSettings', () => ({
  getSettings: vi.fn(async () => ({
    settings: { ...defaultSettings, defaultNamespace: settingsResponse.defaultNamespace },
    warning: { message: settingsResponse.warningMessage },
  })),
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
    pods: [{ name: 'api-1', namespace, phase: 'Running', containers: ['app'] }],
  })),
}))

const meta: ActiveStreamMeta = {
  streamId: 'active',
  sourceId: 'src',
  sourceType: 'info',
  context: 'ctx',
  namespace: 'foo',
  pod: 'api-1',
  container: 'app',
  filePath: '/scloud/foo/logs/api-1/foo.log',
}

const pluginRow: ParsedLogLine = {
  ...meta,
  id: 1,
  raw: '{"message":"plugin"}',
  parseStatus: 'parsed',
  receivedAt: Date.UTC(2026, 0, 1),
  summary: 'plugin row',
}

function ThirdPartyViewer({ sdk, snapshot }: LogViewerExtensionProps) {
  return <section data-testid="third-party-viewer">
    Vendor rows: {snapshot.visibleRows.length}; protocol: {sdk.protocol.name}@{sdk.protocol.version}
  </section>
}

function BrokenThirdPartyViewer() {
  throw new Error('broken extension render')
  return null
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

describe('app shell selection scenario', () => {
  beforeEach(() => {
    settingsResponse.defaultNamespace = 'missing'
    settingsResponse.warningMessage = 'settings warning'
    installLocalStorageMock()
    window.localStorage.clear()
    resetLogViewerExtensionsForTests()
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
      pods: [{ name: 'api-1', namespace: 'foo', phase: 'Running', containers: ['app'] }],
      podsByScope: { [scopeKey('ctx', 'foo')]: [{ name: 'api-1', namespace: 'foo', phase: 'Running', containers: ['app'] }] },
      selectedPod: 'api-1',
      selectedPods: { [scopeKey('ctx', 'foo')]: ['api-1'] },
      selectedWorkloads: {},
      loadingContexts: false,
      loadingNamespaces: false,
      loadingPods: false,
      cacheLoaded: true,
      cacheRefreshing: false,
      cacheLastRefreshAt: Date.now(),
      error: undefined,
    })
    vi.clearAllMocks()
  })

  it('loads warnings, reports missing default namespace, stops active streams on source change, and closes settings', async () => {
    useLogStore.getState().prepareStarting(meta)
    useLogStore.getState().markRunning('active')

    render(<AppShell eventError="event failed" />)

    expect(screen.getByText('event failed')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('settings warning')).toBeInTheDocument())
    expect(await screen.findByText(/Default namespace "missing" was not found/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ACC' }))
    await waitFor(() => expect(stopLogStream).toHaveBeenCalledWith('active'))
    expect(useLogStore.getState().activeStreamIds).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '✕' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument())
  })

  it('selects an existing default namespace during shell startup', async () => {
    settingsResponse.defaultNamespace = 'foo'
    render(<AppShell />)

    await waitFor(() => expect(useKubeStore.getState().selectedNamespace).toBe('foo'))
    expect(screen.queryByText(/Default namespace/)).not.toBeInTheDocument()
  })

  it('shows a registered third-party log viewer as a selectable tab', async () => {
    const unregister = registerLogViewerExtension({
      id: 'vendor.latency',
      ownerId: 'vendor',
      label: 'Latency Map',
      description: 'Vendor latency breakdown',
      component: ThirdPartyViewer,
      requestedCapabilities: ['logs.read'],
      trustLevel: 'trusted-bundled',
    })
    useLogStore.setState({ rows: [pluginRow], visibleRows: [pluginRow] })

    render(<AppShell />)

    fireEvent.click(screen.getByRole('tab', { name: 'Latency Map' }))

    expect(await screen.findByTestId('third-party-viewer')).toHaveTextContent('Vendor rows: 1; protocol: klogcat.logViewer@1')
    expect(screen.getByText('Vendor latency breakdown')).toBeInTheDocument()

    unregister()
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Raw Logs' })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.queryByRole('tab', { name: 'Latency Map' })).not.toBeInTheDocument()
  })

  it('isolates a broken extension render to the active tab panel', async () => {
    registerLogViewerExtension({
      id: 'vendor.broken',
      ownerId: 'vendor',
      label: 'Broken',
      description: 'Broken viewer',
      component: BrokenThirdPartyViewer,
      requestedCapabilities: ['logs.read'],
      trustLevel: 'trusted-bundled',
    })

    render(<AppShell />)
    fireEvent.click(screen.getByRole('tab', { name: 'Broken' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Extension failed: Broken')
    fireEvent.click(screen.getByRole('tab', { name: 'Raw Logs' }))
    expect(screen.getByRole('tab', { name: 'Raw Logs' })).toHaveAttribute('aria-selected', 'true')
  })
})
