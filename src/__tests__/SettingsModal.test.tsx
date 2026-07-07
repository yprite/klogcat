import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SettingsModal } from '../components/SettingsModal'
import { defaultSettings } from '../config/defaultSettings'
import { useSettingsStore } from '../stores/settingsStore'
import { scopeKey, useKubeStore } from '../stores/kubeStore'
import { defaultLogPolicy, defaultLogSourcesFromPolicy } from '../utils/logPolicy'

vi.mock('../commands/tauriSettings', () => ({
  getSettings: vi.fn(async () => ({ settings: defaultSettings })),
  saveSettings: vi.fn(async (settings) => settings),
  resetSettings: vi.fn(async () => defaultSettings),
}))

vi.mock('../commands/tauriLogs', () => ({
  checkLogPath: vi.fn(async () => ({ exists: true })),
}))

vi.mock('../commands/tauriVm', () => ({
  listVmTargets: vi.fn(async () => ({ targets: [{ id: 'prod:api:api-1', name: 'api-1', address: '10.0.0.7' }] })),
  testVmConnection: vi.fn(async () => ({ targets: [{ id: 'prod:api:api-1', name: 'api-1', address: '10.0.0.7' }] })),
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

function openSettingsSection(name: RegExp) {
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name }))
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

    openSettingsSection(/log source/i)
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

    openSettingsSection(/log source/i)
    fireEvent.change(screen.getByRole('combobox', { name: /profile/i }), { target: { value: 'custom' } })
    openSettingsSection(/advanced/i)
    fireEvent.click(screen.getByRole('button', { name: /advanced raw json/i }))

    expect(screen.getByLabelText(/custom policy json/i)).toBeInTheDocument()
  })

  it('hides container inputs from the normal settings page', () => {
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    expect(screen.queryByLabelText(/container/i)).not.toBeInTheDocument()
    openSettingsSection(/advanced/i)
    fireEvent.click(screen.getByRole('button', { name: /advanced path overrides/i }))
    expect(screen.getByLabelText(/info path template/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/acc path template/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/err path template/i)).toBeInTheDocument()
  })

  it('lets the user edit each log type path with provided template variables', async () => {
    const { saveSettings } = await import('../commands/tauriSettings')
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    openSettingsSection(/log source/i)
    expect(screen.getByText('[namespace]')).toBeInTheDocument()
    expect(screen.getByText('[podname]')).toBeInTheDocument()
    expect(screen.getByText('[suffix]')).toBeInTheDocument()

    openSettingsSection(/advanced/i)
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

  it('writes derived logSources when saving custom policy changes', async () => {
    const { saveSettings } = await import('../commands/tauriSettings')
    const nextPolicy = {
      ...defaultLogPolicy,
      sources: {
        ...defaultLogPolicy.sources,
        info: { ...defaultLogPolicy.sources.info, pathTemplate: '/custom/[namespace]/[podname]/info.log' },
      },
    }
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    openSettingsSection(/advanced/i)
    fireEvent.click(screen.getByRole('button', { name: /advanced path overrides/i }))
    fireEvent.change(screen.getByLabelText(/info path template/i), { target: { value: nextPolicy.sources.info.pathTemplate } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      logPolicyId: 'custom',
      logPolicy: expect.objectContaining({
        sources: expect.objectContaining({
          info: expect.objectContaining({ pathTemplate: nextPolicy.sources.info.pathTemplate }),
        }),
      }),
      logSources: expect.objectContaining(defaultLogSourcesFromPolicy(nextPolicy)),
    })))
  })

  it('saves default namespace without validation errors', async () => {
    const { saveSettings } = await import('../commands/tauriSettings')
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/default namespace/i), { target: { value: 'payments' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      defaultNamespace: 'payments',
    })))
  })

  it('saves editable keyboard shortcuts', async () => {
    const { saveSettings } = await import('../commands/tauriSettings')
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    openSettingsSection(/shortcuts/i)
    fireEvent.change(screen.getByLabelText(/open settings/i), { target: { value: 'Meta+.' } })
    fireEvent.change(screen.getByLabelText(/open target picker/i), { target: { value: 'Meta+P' } })
    fireEvent.change(screen.getByLabelText(/start or stop stream/i), { target: { value: 'Meta+S' } })
    fireEvent.change(screen.getByLabelText(/restart stream/i), { target: { value: 'Meta+R' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      shortcuts: expect.objectContaining({
        openSettings: 'Meta+.',
        openTargetPicker: 'Meta+P',
        restartStream: 'Meta+R',
        toggleStream: 'Meta+S',
      }),
    })))
  })

  it('accepts VM passwords directly and masks them after editing', () => {
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    openSettingsSection(/AWS VM/i)
    const bastionPassword = screen.getByLabelText('Bastion password') as HTMLInputElement
    expect(bastionPassword).toHaveAttribute('type', 'password')

    fireEvent.focus(bastionPassword)
    expect(bastionPassword).toHaveAttribute('type', 'text')
    fireEvent.change(bastionPassword, { target: { value: 'direct-secret' } })
    fireEvent.blur(bastionPassword)

    expect(bastionPassword).toHaveAttribute('type', 'password')
    expect(bastionPassword).toHaveValue('direct-secret')
  })

  it('tests AWS VM connection from the current draft settings', async () => {
    const { testVmConnection } = await import('../commands/tauriVm')
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    openSettingsSection(/AWS VM/i)
    expect(screen.getByRole('button', { name: /test vm connection/i })).toBeDisabled()

    fireEvent.click(screen.getByLabelText('Enabled'))
    fireEvent.click(screen.getByLabelText(/Region\/Bastion 1/))
    fireEvent.change(screen.getByLabelText('Bastion host'), { target: { value: 'bastion.example.com' } })
    fireEvent.change(screen.getByLabelText('Bastion username'), { target: { value: 'ops' } })
    fireEvent.change(screen.getByLabelText('Bastion password'), { target: { value: 'secret' } })
    fireEvent.change(screen.getByLabelText('VM username'), { target: { value: 'app' } })
    fireEvent.change(screen.getByLabelText('VM password'), { target: { value: 'vm-secret' } })
    fireEvent.click(screen.getByRole('button', { name: /test vm connection/i }))

    await waitFor(() => expect(testVmConnection).toHaveBeenCalledWith(expect.objectContaining({
      awsVm: expect.objectContaining({ enabled: true }),
    })))
    expect(await screen.findByText('VM connection test succeeded. Discovered 1 VM targets.')).toBeInTheDocument()
  })

  it('adds a custom log type and derives settings for it', async () => {
    const { saveSettings } = await import('../commands/tauriSettings')
    vi.stubGlobal('prompt', vi.fn(() => 'DEBUG'))
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    openSettingsSection(/log source/i)
    fireEvent.click(screen.getByRole('button', { name: /add log type/i }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' }).at(-1)!)
    fireEvent.click(screen.getByRole('button', { name: /add log type/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      logPolicyId: 'custom',
      logPolicy: expect.objectContaining({
        sources: expect.objectContaining({
          debug: expect.objectContaining({ label: 'DEBUG' }),
        }),
      }),
      logSources: expect.objectContaining({
        debug: expect.objectContaining({ container: 'app', filePath: '/scloud/[namespace]/logs/[podname]/[namespace]_DEBUG.log' }),
      }),
    })))
  })

  it('keeps the settings content in a scrollable panel', () => {
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    const dialog = screen.getByRole('dialog', { name: /settings/i })
    expect(dialog).toHaveClass('max-h-[92vh]', 'overflow-hidden')
    expect(screen.getByTestId('settings-scroll-panel')).toHaveClass('overflow-y-auto')
  })

  it('switches settings sections from the side navigation', () => {
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    openSettingsSection(/appearance/i)
    expect(document.getElementById('settings-appearance')).toBeInTheDocument()
    expect(screen.queryByLabelText(/initial tail lines/i)).not.toBeInTheDocument()
  })

  it('closes with Escape and exposes an accessible close button', async () => {
    const onClose = vi.fn()
    render(<SettingsModal open onClose={onClose} onRestart={vi.fn()} />)

    const closeButton = screen.getByRole('button', { name: /close settings/i })
    await waitFor(() => expect(closeButton).toHaveFocus())

    fireEvent.keyDown(screen.getByRole('dialog', { name: /settings/i }), { key: 'Tab' })
    fireEvent.keyDown(screen.getByRole('dialog', { name: /settings/i }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps Settings modal labels in the draft language before save', () => {
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    openSettingsSection(/appearance/i)
    fireEvent.change(screen.getByLabelText(/language/i), { target: { value: 'ko' } })

    openSettingsSection(/런타임/i)
    expect(screen.getByRole('heading', { name: '런타임' })).toBeInTheDocument()
    openSettingsSection(/로그 소스/i)
    expect(screen.getByRole('heading', { name: '로그 소스 프로필' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '저장' })).toBeInTheDocument()
  })

  it('disables Save and explains blocking path warnings', async () => {
    const { saveSettings } = await import('../commands/tauriSettings')
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    openSettingsSection(/log source/i)
    fireEvent.change(screen.getByLabelText(/path pattern/i), { target: { value: '/logs/app.log' } })

    expect(screen.getAllByText(/include \[namespace\]/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/include \[podname\] or \[pod\]/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('status')).toHaveTextContent(/fix validation errors before saving/i)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('blocks invalid advanced per-source path overrides', async () => {
    const { saveSettings } = await import('../commands/tauriSettings')
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    openSettingsSection(/advanced/i)
    fireEvent.click(screen.getByRole('button', { name: /advanced path overrides/i }))
    fireEvent.change(screen.getByLabelText(/info path template/i), { target: { value: '/logs/info.log' } })

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('presents a product-level log source profile builder with live preview and advanced controls', () => {
    seedSelectedTarget()
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    openSettingsSection(/log source/i)
    expect(screen.getByRole('heading', { name: /log source profile/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/profile/i)).toHaveValue('scloud')
    expect(screen.getByLabelText(/path pattern/i)).toHaveValue('/scloud/[namespace]/logs/[podname]/[namespace][suffix].log')
    expect(screen.getByLabelText(/info suffix/i)).toHaveValue('')
    expect(screen.getByLabelText(/acc suffix/i)).toHaveValue('_ACC')
    expect(screen.getByLabelText(/err suffix/i)).toHaveValue('_ERR')
    expect(screen.getByText(/preview using current target/i)).toBeInTheDocument()
    expect(screen.getByText('/scloud/payment-prod/logs/api-7d9c/payment-prod_ERR.log')).toBeInTheDocument()
    expect(screen.queryByLabelText(/custom policy json/i)).not.toBeInTheDocument()
    expect(within(screen.getByRole('navigation')).getByRole('button', { name: /advanced/i })).toBeInTheDocument()
  })

  it('shows actionable validation for unknown variables and missing namespace or pod tokens', () => {
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    openSettingsSection(/log source/i)
    fireEvent.change(screen.getByLabelText(/path pattern/i), { target: { value: '/logs/[namesapce]/app.log' } })

    expect(screen.getByText(/unknown variable: \[namesapce\]/i)).toBeInTheDocument()
    expect(screen.getByText(/did you mean \[namespace\]/i)).toBeInTheDocument()
    expect(screen.getByText(/include \[podname\] or \[pod\]/i)).toBeInTheDocument()
  })

  it('inserts clicked variables, resets only log paths, and can test paths against the selected target', async () => {
    seedSelectedTarget()
    const { checkLogPath } = await import('../commands/tauriLogs')
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    openSettingsSection(/log source/i)
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

    openSettingsSection(/log source/i)
    fireEvent.click(screen.getByRole('button', { name: /test paths/i }))
    expect(screen.getByText(/select a namespace and pod before testing paths/i)).toBeInTheDocument()
  })

  it('reports per-source path test errors', async () => {
    const { checkLogPath } = await import('../commands/tauriLogs')
    seedSelectedTarget()
    vi.mocked(checkLogPath).mockRejectedValueOnce(new Error('permission denied'))
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    openSettingsSection(/log source/i)
    fireEvent.click(screen.getByRole('button', { name: /test paths/i }))
    await waitFor(() => expect(screen.getByText(/permission denied/i)).toBeInTheDocument())
  })

  it('lets suffix controls switch the profile to a custom policy', async () => {
    const { saveSettings } = await import('../commands/tauriSettings')
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    openSettingsSection(/log source/i)
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

    openSettingsSection(/appearance/i)
    fireEvent.change(screen.getByLabelText(/language/i), { target: { value: 'ko' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      language: 'ko',
    })))
  })
})
