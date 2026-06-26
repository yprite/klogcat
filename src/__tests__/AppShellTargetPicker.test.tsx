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
    pods: [{ name: 'api-1', namespace, phase: 'Running', containers: ['app'] }],
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
})
