import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsModal } from '../components/SettingsModal'
import { TopBar } from '../components/TopBar'
import { defaultSettings } from '../config/defaultSettings'
import { useSettingsStore } from '../stores/settingsStore'
import { useKubeStore } from '../stores/kubeStore'

vi.mock('../commands/tauriSettings', () => ({
  getSettings: vi.fn(async () => ({ settings: defaultSettings })),
  saveSettings: vi.fn(async (settings) => settings),
  resetSettings: vi.fn(async () => defaultSettings),
}))

function resetStores() {
  useSettingsStore.setState({ settings: defaultSettings, warning: undefined, loading: false, error: undefined })
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

describe('i18n language settings', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  it('adds a language selector to settings and persists the selected language', async () => {
    const { saveSettings } = await import('../commands/tauriSettings')
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    const selector = screen.getByRole('combobox', { name: /language/i })
    expect(selector).toHaveValue('en')

    fireEvent.change(selector, { target: { value: 'ko' } })
    expect(screen.getByText(/한국어 UI 미리보기/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ language: 'ko' })))
  })

  it('renders top-level navigation labels in Korean after the language is saved', () => {
    useSettingsStore.setState({ settings: { ...defaultSettings, language: 'ko' } })

    render(<TopBar onSettings={vi.fn()} onContextChange={vi.fn()} onNamespaceChange={vi.fn()} onPodChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: '대상 변경' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '설정' })).toBeInTheDocument()
    expect(screen.getByText('대상을 선택하세요')).toBeInTheDocument()
  })
})
