import { describe, expect, it, vi } from 'vitest'
import { checkLogPath } from '../commands/tauriLogs'
import type { SelectedPodTarget } from '../stores/kubeStore'
import { defaultLogPolicy } from '../utils/logPolicy'
import { testLogPaths, trapTabFocus } from '../components/SettingsModalLogic'

vi.mock('../commands/tauriLogs', () => ({
  checkLogPath: vi.fn(async () => ({ exists: true })),
}))

function keyboardEvent(key: string, shiftKey = false) {
  return { key, shiftKey, preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLDivElement>
}

describe('SettingsModalLogic', () => {
  it('traps tab focus inside the settings dialog', () => {
    const dialog = document.createElement('div')
    const first = document.createElement('button')
    const last = document.createElement('button')
    dialog.append(first, last)
    document.body.append(dialog)

    first.focus()
    const backward = keyboardEvent('Tab', true)
    trapTabFocus(backward, { current: dialog })
    expect(backward.preventDefault).toHaveBeenCalled()
    expect(last).toHaveFocus()

    last.focus()
    const forward = keyboardEvent('Tab')
    trapTabFocus(forward, { current: dialog })
    expect(forward.preventDefault).toHaveBeenCalled()
    expect(first).toHaveFocus()

    const ignored = keyboardEvent('Escape')
    trapTabFocus(ignored, { current: dialog })
    expect(ignored.preventDefault).not.toHaveBeenCalled()
    dialog.remove()
  })

  it('tests log paths with fallback containers and failed path checks', async () => {
    vi.mocked(checkLogPath)
      .mockResolvedValueOnce({ exists: false, message: 'missing' })
      .mockRejectedValueOnce(new Error('boom'))

    const target: SelectedPodTarget = {
      context: 'ctx',
      namespace: 'demo',
      pod: { name: 'api-1', namespace: 'demo', phase: 'Running', containers: ['sidecar'] },
    }
    const results = await testLogPaths(target, ['info', 'error'], defaultLogPolicy)

    expect(checkLogPath).toHaveBeenNthCalledWith(1, expect.objectContaining({ container: 'sidecar', sourceType: 'info' }))
    expect(results[0]).toEqual(expect.objectContaining({ ok: false, message: 'missing' }))
    expect(results[1]).toEqual(expect.objectContaining({ ok: false, message: 'boom' }))
  })
})
