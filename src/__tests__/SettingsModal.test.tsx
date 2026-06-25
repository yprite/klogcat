import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsModal } from '../components/SettingsModal'
import { defaultSettings } from '../config/defaultSettings'
import { useSettingsStore } from '../stores/settingsStore'
import { defaultLogPolicy } from '../utils/logPolicy'

vi.mock('../commands/tauriSettings', () => ({
  getSettings: vi.fn(async () => ({ settings: defaultSettings })),
  saveSettings: vi.fn(async (settings) => settings),
  resetSettings: vi.fn(async () => defaultSettings),
}))

function resetSettingsStore() {
  useSettingsStore.setState({
    settings: defaultSettings,
    warning: undefined,
    loading: false,
    error: undefined,
  })
}

describe('SettingsModal log policy selection', () => {
  beforeEach(() => {
    resetSettingsStore()
    vi.clearAllMocks()
  })

  it('lets the user select the built-in log policy instead of editing JSON by default', async () => {
    const { saveSettings } = await import('../commands/tauriSettings')
    const onClose = vi.fn()
    render(<SettingsModal open onClose={onClose} onRestart={vi.fn()} />)

    const selector = screen.getByRole('combobox', { name: /log policy/i })
    expect(selector).toHaveValue('scloud')
    expect(screen.queryByLabelText(/custom policy json/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      logPolicyId: 'scloud',
      logPolicy: defaultLogPolicy,
    })))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows JSON editing only after the user selects a custom policy', () => {
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    fireEvent.change(screen.getByRole('combobox', { name: /log policy/i }), { target: { value: 'custom' } })

    expect(screen.getByLabelText(/custom policy json/i)).toBeInTheDocument()
    expect(screen.getByText(/custom policy selected/i)).toBeInTheDocument()
  })

  it('hides container inputs from the normal settings page', () => {
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    expect(screen.queryByLabelText(/container/i)).not.toBeInTheDocument()
    expect(screen.getAllByText(/fixed path:/i)).toHaveLength(3)
  })

  it('keeps the settings content in a scrollable panel', () => {
    render(<SettingsModal open onClose={vi.fn()} onRestart={vi.fn()} />)

    const dialog = screen.getByRole('dialog', { name: /settings/i })
    expect(dialog).toHaveClass('max-h-[92vh]', 'overflow-hidden')
    expect(screen.getByTestId('settings-scroll-panel')).toHaveClass('overflow-y-auto')
  })
})
