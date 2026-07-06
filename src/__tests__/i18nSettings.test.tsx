import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  document.documentElement.dataset.colorTheme = 'dark-plus'
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

    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: /appearance/i }))
    const selector = screen.getByRole('combobox', { name: /language/i })
    expect(selector).toHaveValue('en')

    fireEvent.change(selector, { target: { value: 'ko' } })
    expect(selector).toHaveValue('ko')
    expect(screen.getAllByText('화면 표시').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /Save|저장/ }))

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ language: 'ko' })))
  })

  it('adds a VS Code color theme selector to appearance settings', async () => {
    const { saveSettings } = await import('../commands/tauriSettings')
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: /appearance/i }))
    const selector = screen.getByRole('combobox', { name: /color theme/i })

    fireEvent.change(selector, { target: { value: 'monokai' } })
    expect(document.documentElement.dataset.colorTheme).toBe('monokai')
    fireEvent.click(screen.getByRole('button', { name: /Save|저장/ }))

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ colorTheme: 'monokai' })))
  })

  it('previews a color theme on hover and restores the saved theme when closed without saving', async () => {
    const { saveSettings } = await import('../commands/tauriSettings')
    const onClose = vi.fn()
    render(<SettingsModal open onClose={onClose} onRestart={vi.fn()} />)

    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: /appearance/i }))
    const monokaiPreview = screen.getByRole('button', { name: 'Monokai' })

    fireEvent.mouseEnter(monokaiPreview)
    expect(document.documentElement.dataset.colorTheme).toBe('monokai')

    fireEvent.mouseLeave(monokaiPreview.parentElement!)
    expect(document.documentElement.dataset.colorTheme).toBe('dark-plus')

    fireEvent.change(screen.getByRole('combobox', { name: /color theme/i }), { target: { value: 'monokai' } })
    expect(document.documentElement.dataset.colorTheme).toBe('monokai')

    fireEvent.click(screen.getByLabelText('Close settings'))
    expect(onClose).toHaveBeenCalled()
    expect(saveSettings).not.toHaveBeenCalled()
    expect(document.documentElement.dataset.colorTheme).toBe('dark-plus')
  })

  it('renders top-level navigation labels in Korean after the language is saved', () => {
    useSettingsStore.setState({ settings: { ...defaultSettings, language: 'ko' } })

    render(<TopBar onSettings={vi.fn()} onContextChange={vi.fn()} onNamespaceChange={vi.fn()} onPodChange={vi.fn()} />)

    expect(screen.queryByRole('button', { name: '대상 변경' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '설정' })).toBeInTheDocument()
    expect(screen.getByText('대상을 선택하세요')).toBeInTheDocument()
  })
})
