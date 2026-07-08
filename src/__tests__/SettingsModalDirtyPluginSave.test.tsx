import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsModal } from '../components/SettingsModal'
import { defaultSettings } from '../config/defaultSettings'
import { saveSettings } from '../commands/tauriSettings'
import { useSettingsStore } from '../stores/settingsStore'

vi.mock('../commands/tauriSettings', () => ({
  getSettings: vi.fn(async () => ({ settings: defaultSettings })),
  saveSettings: vi.fn(async (settings) => settings),
  resetSettings: vi.fn(async () => defaultSettings),
}))

vi.mock('../commands/tauriLogs', () => ({
  checkLogPath: vi.fn(async () => ({ exists: true })),
  stopLogStream: vi.fn(async () => undefined),
}))

vi.mock('../commands/tauriVm', () => ({
  listVmTargets: vi.fn(async () => ({ targets: [] })),
  testVmConnection: vi.fn(async () => ({ targets: [] })),
}))

function dirtyPluginSettings() {
  return {
    ...defaultSettings,
    plugins: {
      ...defaultSettings.plugins,
      extensionRoot: { schema: 1, enabled: true },
      targets: {
        ...defaultSettings.plugins.targets,
        thirdPartyTarget: { enabled: true, endpoint: 'https://example.invalid/targets' },
      },
      viewers: {
        ...defaultSettings.plugins.viewers,
        raw: { enabled: false },
        thirdPartyViewer: { enabled: false, layout: 'timeline' },
      },
    },
  } as unknown as typeof defaultSettings
}

describe('SettingsModal dirty plugin save regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({
      settings: dirtyPluginSettings(),
      warning: undefined,
      loading: false,
      error: undefined,
    })
  })

  it('saves a language-only change without surfacing invalid settings args', async () => {
    const onClose = vi.fn()
    render(<SettingsModal open onClose={onClose} onRestart={vi.fn()} />)

    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: /appearance/i }))
    const saveButton = screen.getByRole('button', { name: 'Save' })
    fireEvent.change(screen.getByLabelText(/language/i), { target: { value: 'ko' } })
    fireEvent.click(saveButton)

    await waitFor(() => expect(saveSettings).toHaveBeenCalled())
    expect(screen.queryByText(/invalid args 'settings'/i)).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalled()

    const saved = vi.mocked(saveSettings).mock.calls[0]?.[0] as typeof defaultSettings & {
      plugins: typeof defaultSettings.plugins & {
        extensionRoot: { schema: number; enabled: boolean }
        targets: typeof defaultSettings.plugins.targets & { thirdPartyTarget: { enabled: boolean; endpoint: string } }
        viewers: typeof defaultSettings.plugins.viewers & { thirdPartyViewer: { enabled: boolean; layout: string } }
      }
    }
    expect(saved.language).toBe('ko')
    expect(saved.plugins.extensionRoot).toEqual({ schema: 1, enabled: true })
    expect(saved.plugins.targets.thirdPartyTarget).toEqual({ enabled: true, endpoint: 'https://example.invalid/targets' })
    expect(saved.plugins.viewers.raw.enabled).toBe(true)
    expect(saved.plugins.viewers.thirdPartyViewer).toEqual({ enabled: false, layout: 'timeline' })
  })
})
