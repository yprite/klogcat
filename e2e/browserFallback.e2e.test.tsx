import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../src/App'
import { defaultSettings } from '../src/config/defaultSettings'
import { resetLogStoreForTests } from '../src/stores/logStore'
import { useKubeStore } from '../src/stores/kubeStore'
import { useSettingsStore } from '../src/stores/settingsStore'

vi.mock('../src/commands/tauriLogEvents', () => ({
  subscribeLogEvents: vi.fn(async () => () => undefined),
}))

vi.mock('../src/commands/tauriKube', () => ({
  getCurrentContext: vi.fn(async () => ''),
  listContexts: vi.fn(async () => ({ contexts: [] })),
  listNamespaces: vi.fn(async (context?: string) => ({ context, namespaces: [] })),
  listPods: vi.fn(async (namespace: string, context?: string) => ({ context, namespace, pods: [] })),
}))

vi.mock('../src/commands/tauriLogs', () => ({
  startLogStream: vi.fn(async () => undefined),
  stopLogStream: vi.fn(async () => undefined),
  stopAllLogStreams: vi.fn(async () => undefined),
}))

vi.mock('../src/commands/tauriSettings', () => ({
  getSettings: vi.fn(async () => ({ settings: defaultSettings })),
  saveSettings: vi.fn(async (settings) => settings),
  resetSettings: vi.fn(async () => defaultSettings),
}))

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

describe('browser fallback e2e smoke', () => {
  beforeEach(() => {
    installLocalStorageMock()
    window.localStorage.clear()
    resetLogStoreForTests()
    useSettingsStore.setState({ settings: defaultSettings, loading: false, error: undefined, warning: undefined })
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
      cacheLoaded: true,
      cacheRefreshing: false,
      cacheLastRefreshAt: undefined,
      error: undefined,
    })
  })

  it('boots the app shell outside Tauri and exposes a safe empty-target state', async () => {
    render(<App />)

    expect(await screen.findByText('klogcat')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change Targets' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Raw Logs' })).toHaveAttribute('aria-selected', 'true')

    await waitFor(() => expect(screen.getByText(/Start: enabled \(Select namespace and pod\)/)).toBeInTheDocument())
    expect(screen.getByText('Targets: 0')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await expect(screen.findByText('Select namespace and pod')).resolves.toBeInTheDocument()
  })
})
