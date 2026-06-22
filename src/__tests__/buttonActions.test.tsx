import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LogToolbar } from '../components/LogToolbar'
import { SettingsModal } from '../components/SettingsModal'
import { defaultSettings } from '../config/defaultSettings'
import { useKubeStore } from '../stores/kubeStore'
import { resetLogStoreForTests, useLogStore } from '../stores/logStore'
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

function resetStores() {
  resetLogStoreForTests()
  useKubeStore.setState({
    contexts: [{ name: 'ctx' }, { name: 'cluster-a' }],
    currentContext: 'ctx',
    selectedContext: 'ctx',
    namespaces: [],
    selectedNamespace: undefined,
    pods: [],
    selectedPod: undefined,
    loadingNamespaces: false,
    loadingPods: false,
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
  beforeEach(() => resetStores())

  it('keeps Start clickable and reports why it cannot start', () => {
    render(<LogToolbar sourceType="app" />)

    const start = screen.getByRole('button', { name: 'Start' })
    expect(start).toBeEnabled()

    fireEvent.click(start)

    expect(useLogStore.getState().streamStatus).toBe('error')
    expect(useLogStore.getState().errorMessage).toMatch(/select namespace and pod/i)
  })

  it('keeps Stop clickable and reports when no stream is active', () => {
    render(<LogToolbar sourceType="app" />)

    const stop = screen.getByRole('button', { name: 'Stop' })
    expect(stop).toBeEnabled()

    fireEvent.click(stop)

    expect(useLogStore.getState().streamStatus).toBe('error')
    expect(useLogStore.getState().errorMessage).toMatch(/no active stream/i)
  })

  it('auto-selects the pod container when configured app container is missing', () => {
    useKubeStore.setState({
      selectedContext: 'cluster-a',
      selectedNamespace: 'default',
      selectedPod: 'pod-1',
      pods: [{ name: 'pod-1', namespace: 'default', phase: 'Running', containers: ['worker'] }],
    })
    render(<LogToolbar sourceType="app" />)

    expect(screen.getByRole('combobox', { name: /container/i })).toHaveValue('worker')
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    expect(screen.getByText(/Start: enabled/)).toBeInTheDocument()
  })

  it('shows Start enabled after selecting a Running pod with the configured container', () => {
    useKubeStore.setState({
      selectedNamespace: 'default',
      selectedPod: 'pod-1',
      pods: [{ name: 'pod-1', namespace: 'default', phase: 'Running', containers: ['app'] }],
    })
    render(<LogToolbar sourceType="app" />)

    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    expect(screen.getByText(/Start: enabled/)).toBeInTheDocument()
  })

  it('records visible action debug when Start is clicked', () => {
    render(<LogToolbar sourceType="app" />)

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    expect(useLogStore.getState().actionDebugMessages.at(-1)).toMatch(/Start clicked/)
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
})
