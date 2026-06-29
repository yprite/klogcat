import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AppShell } from '../components/AppShell'
import { defaultSettings } from '../config/defaultSettings'
import { useKubeStore } from '../stores/kubeStore'
import { resetLogStoreForTests } from '../stores/logStore'
import { useSettingsStore } from '../stores/settingsStore'

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
  listNamespaces: vi.fn(async () => ({ namespaces: [{ name: 'default' }] })),
  listPods: vi.fn(async (namespace: string, context?: string) => ({
    context,
    namespace,
    pods: [
      { name: 'api-7d9f8c9c6d-aaaaa', namespace, phase: 'Running', containers: ['app'], labels: { app: 'api', tier: 'web' } },
      { name: 'api-7d9f8c9c6d-bbbbb', namespace, phase: 'Running', containers: ['app'], labels: { app: 'api', tier: 'web' } },
      { name: 'worker-55d9-a', namespace, phase: 'Running', containers: ['app'], labels: { app: 'worker' } },
    ],
  })),
}))

function resetStores() {
  resetLogStoreForTests()
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
  useSettingsStore.setState({
    settings: defaultSettings,
    warning: undefined,
    loading: false,
    error: undefined,
  })
}

describe('AppShell target picker entry points', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStores()
  })

  it('opens target picker from the top bar when no target is selected', async () => {
    render(<AppShell />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Choose Target' })[0])

    expect(await screen.findByRole('dialog', { name: 'Select Log Targets' })).toBeInTheDocument()
  })

  it('opens target picker from the empty log surface Choose Target button', async () => {
    render(<AppShell />)

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Choose Target' }).length).toBeGreaterThanOrEqual(2))
    fireEvent.click(screen.getAllByRole('button', { name: 'Choose Target' }).at(-1)!)

    expect(await screen.findByRole('dialog', { name: 'Select Log Targets' })).toBeInTheDocument()
  })

  it('can select a workload group from the target picker without leaving raw logs', async () => {
    useKubeStore.setState({
      contexts: [{ name: 'ctx' }],
      currentContext: 'ctx',
      selectedContext: 'ctx',
      selectedContexts: ['ctx'],
      namespaces: [{ name: 'default' }],
      namespacesByContext: { ctx: [{ name: 'default' }] },
      selectedNamespace: 'default',
      selectedNamespaces: { ctx: ['default'] },
      pods: [
        { name: 'api-7d9f8c9c6d-aaaaa', namespace: 'default', phase: 'Running', containers: ['app'] },
        { name: 'api-7d9f8c9c6d-bbbbb', namespace: 'default', phase: 'Running', containers: ['app'] },
        { name: 'worker-55d9-a', namespace: 'default', phase: 'Running', containers: ['app'] },
      ],
      podsByScope: { 'ctx\u0000default': [
        { name: 'api-7d9f8c9c6d-aaaaa', namespace: 'default', phase: 'Running', containers: ['app'] },
        { name: 'api-7d9f8c9c6d-bbbbb', namespace: 'default', phase: 'Running', containers: ['app'] },
        { name: 'worker-55d9-a', namespace: 'default', phase: 'Running', containers: ['app'] },
      ] },
    })

    render(<AppShell />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Choose Target' })[0])
    expect(await screen.findByRole('dialog', { name: 'Select Log Targets' })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Select workload api across 2 pods' }))

    expect(await screen.findByText('2 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ctx \/ default \/ api-7d9f8c9c6d-aaaaa/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ctx \/ default \/ api-7d9f8c9c6d-bbbbb/ })).toBeInTheDocument()
  })

  it('can select running pods with a bounded label selector without leaving raw logs', async () => {
    useKubeStore.setState({
      contexts: [{ name: 'ctx' }],
      currentContext: 'ctx',
      selectedContext: 'ctx',
      selectedContexts: ['ctx'],
      namespaces: [{ name: 'default' }],
      namespacesByContext: { ctx: [{ name: 'default' }] },
      selectedNamespace: 'default',
      selectedNamespaces: { ctx: ['default'] },
      pods: [
        { name: 'api-1', namespace: 'default', phase: 'Running', containers: ['app'], labels: { app: 'api', tier: 'web' } },
        { name: 'api-2', namespace: 'default', phase: 'Pending', containers: ['app'], labels: { app: 'api', tier: 'web' } },
        { name: 'worker-1', namespace: 'default', phase: 'Running', containers: ['app'], labels: { app: 'worker' } },
      ],
      podsByScope: { 'ctx\u0000default': [
        { name: 'api-1', namespace: 'default', phase: 'Running', containers: ['app'], labels: { app: 'api', tier: 'web' } },
        { name: 'api-2', namespace: 'default', phase: 'Pending', containers: ['app'], labels: { app: 'api', tier: 'web' } },
        { name: 'worker-1', namespace: 'default', phase: 'Running', containers: ['app'], labels: { app: 'worker' } },
      ] },
    })

    render(<AppShell />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Choose Target' })[0])
    expect(await screen.findByRole('dialog', { name: 'Select Log Targets' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Label selector'), { target: { value: 'app=api,tier=web' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select matching running pods' }))

    expect(await screen.findByText('2 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ctx \/ default \/ api-7d9f8c9c6d-aaaaa/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ctx \/ default \/ api-7d9f8c9c6d-bbbbb/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ctx \/ default \/ worker-55d9-a/ })).not.toBeInTheDocument()
    expect(screen.getByText('Raw Logs')).toBeInTheDocument()
  })

  it('does not expose internal action debug logs in the user UI', async () => {
    render(<AppShell />)

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument()

    expect(screen.queryByText('Action debug')).not.toBeInTheDocument()
    expect(screen.queryByText(/Settings clicked/)).not.toBeInTheDocument()
  })
})
