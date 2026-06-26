import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsModal } from '../components/SettingsModal'
import { defaultSettings } from '../config/defaultSettings'
import { useSettingsStore } from '../stores/settingsStore'
import { scopeKey, useKubeStore } from '../stores/kubeStore'
import { defaultLogPolicy } from '../utils/logPolicy'

vi.mock('../commands/tauriSettings', () => ({
  getSettings: vi.fn(async () => ({ settings: defaultSettings })),
  saveSettings: vi.fn(async (settings) => settings),
  resetSettings: vi.fn(async () => defaultSettings),
}))

vi.mock('../commands/tauriLogs', () => ({
  checkLogPath: vi.fn(async () => ({ exists: true })),
}))

function resetSettingsStore() {
  useSettingsStore.setState({
    settings: defaultSettings,
    warning: undefined,
    loading: false,
    error: undefined,
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

function seedSelectedTarget() {
  const key = scopeKey('ctx-a', 'payment-prod')
  const pod = { name: 'api-7d9c', namespace: 'payment-prod', phase: 'Running' as const, containers: ['app'] }
  useKubeStore.setState({
    selectedContext: 'ctx-a',
    selectedContexts: ['ctx-a'],
    selectedNamespace: 'payment-prod',
    selectedNamespaces: { 'ctx-a': ['payment-prod'] },
    selectedPod: 'api-7d9c',
    selectedPods: { [key]: ['api-7d9c'] },
    selectedWorkloads: { [key]: ['api'] },
    pods: [pod],
    podsByScope: { [key]: [pod] },
  })
}

describe('SettingsModal log policy selection', () => {
  beforeEach(() => {
    resetSettingsStore()
    resetKubeStore()
    vi.clearAllMocks()
  })

  it('lets the user select the built-in log policy instead of editing JSON by default', async () => {
    const { saveSettings } = await import('../commands/tauriSettings')
    const onClose = vi.fn()
    render(<SettingsModal open onClose={onClose} onRestart={vi.fn()} />)

    const selector = screen.getByRole('combobox', { name: /profile/i })
    expect(selector).toHaveValue('scloud')
    expect(screen.queryByLabelText(/custom policy json/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      logPolicyId: 'scloud',
      logPolicy: defaultLogPolicy,
    })))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows JSON editing only after the user opens advanced raw JSON for a custom policy', () => {
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    fireEvent.change(screen.getByRole('combobox', { name: /profile/i }), { target: { value: 'custom' } })
    fireEvent.click(screen.getByRole('button', { name: /advanced raw json/i }))

    expect(screen.getByLabelText(/custom policy json/i)).toBeInTheDocument()
    expect(screen.getByText(/custom, based on scloud/i)).toBeInTheDocument()
  })

  it('hides container inputs from the normal settings page', () => {
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    expect(screen.queryByLabelText(/container/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /advanced path overrides/i }))
    expect(screen.getByLabelText(/info path template/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/acc path template/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/err path template/i)).toBeInTheDocument()
  })

  it('lets the user edit each log type path with provided template variables', async () => {
    const { saveSettings } = await import('../commands/tauriSettings')
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    expect(screen.getByText('[namespace]')).toBeInTheDocument()
    expect(screen.getByText('[podname]')).toBeInTheDocument()
    expect(screen.getByText('[suffix]')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /advanced path overrides/i }))
    fireEvent.change(screen.getByLabelText(/info path template/i), { target: { value: '/custom/[namespace]/[podname]/info.log' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      logPolicyId: 'custom',
      logPolicy: expect.objectContaining({
        sources: expect.objectContaining({
          info: expect.objectContaining({ pathTemplate: '/custom/[namespace]/[podname]/info.log' }),
        }),
      }),
    })))
  })

  it('keeps the settings content in a scrollable panel', () => {
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    const dialog = screen.getByRole('dialog', { name: /settings/i })
    expect(dialog).toHaveClass('max-h-[92vh]', 'overflow-hidden')
    expect(screen.getByTestId('settings-scroll-panel')).toHaveClass('overflow-y-auto')
  })

  it('presents a product-level log source profile builder with live preview and advanced controls', () => {
    seedSelectedTarget()
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    expect(screen.getByRole('heading', { name: /log source profile/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/profile/i)).toHaveValue('scloud')
    expect(screen.getByLabelText(/path pattern/i)).toHaveValue('/scloud/[namespace]/logs/[podname]/[namespace][suffix].log')
    expect(screen.getByLabelText(/info suffix/i)).toHaveValue('')
    expect(screen.getByLabelText(/acc suffix/i)).toHaveValue('_ACC')
    expect(screen.getByLabelText(/err suffix/i)).toHaveValue('_ERR')
    expect(screen.getByText(/preview using current target/i)).toBeInTheDocument()
    expect(screen.getByText('/scloud/payment-prod/logs/api-7d9c/payment-prod_ERR.log')).toBeInTheDocument()
    expect(screen.queryByLabelText(/custom policy json/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /advanced path overrides/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /advanced raw json/i })).toBeInTheDocument()
  })

  it('shows actionable validation for unknown variables and missing namespace or pod tokens', () => {
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/path pattern/i), { target: { value: '/logs/[namesapce]/app.log' } })

    expect(screen.getByText(/unknown variable: \[namesapce\]/i)).toBeInTheDocument()
    expect(screen.getByText(/did you mean \[namespace\]/i)).toBeInTheDocument()
    expect(screen.getByText(/include \[podname\] or \[pod\]/i)).toBeInTheDocument()
  })

  it('inserts clicked variables, resets only log paths, and can test paths against the selected target', async () => {
    seedSelectedTarget()
    const { checkLogPath } = await import('../commands/tauriLogs')
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/path pattern/i), { target: { value: '/logs/' } })
    fireEvent.click(screen.getByRole('button', { name: '[namespace]' }))
    expect(screen.getByLabelText(/path pattern/i)).toHaveValue('/logs/[namespace]')

    fireEvent.click(screen.getByRole('button', { name: /reset log paths to scloud defaults/i }))
    expect(screen.getByLabelText(/path pattern/i)).toHaveValue('/scloud/[namespace]/logs/[podname]/[namespace][suffix].log')

    fireEvent.click(screen.getByRole('button', { name: /test paths/i }))
    await waitFor(() => expect(checkLogPath).toHaveBeenCalledTimes(3))
    expect(screen.getByText(/info ok/i)).toBeInTheDocument()
    expect(screen.getByText(/acc ok/i)).toBeInTheDocument()
    expect(screen.getByText(/err ok/i)).toBeInTheDocument()
  })

  it('reports path test prerequisites before testing paths', () => {
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /test paths/i }))
    expect(screen.getByText(/select a namespace and pod before testing paths/i)).toBeInTheDocument()
  })

  it('reports per-source path test errors', async () => {
    const { checkLogPath } = await import('../commands/tauriLogs')
    seedSelectedTarget()
    vi.mocked(checkLogPath).mockRejectedValueOnce(new Error('permission denied'))
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /test paths/i }))
    await waitFor(() => expect(screen.getByText(/permission denied/i)).toBeInTheDocument())
  })

  it('lets suffix controls switch the profile to a custom policy', async () => {
    const { saveSettings } = await import('../commands/tauriSettings')
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/acc suffix/i), { target: { value: '_ACCESS' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      logPolicyId: 'custom',
      logPolicy: expect.objectContaining({
        sources: expect.objectContaining({
          access: expect.objectContaining({ pathSuffix: '_ACCESS' }),
        }),
      }),
    })))
  })

  it('saves the selected UI language', async () => {
    const { saveSettings } = await import('../commands/tauriSettings')
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/language/i), { target: { value: 'ko' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      language: 'ko',
    })))
  })
})
