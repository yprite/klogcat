import { describe, expect, it, vi } from 'vitest'
import { subscribeLogEvents } from '../commands/tauriLogEvents'

describe('subscribeLogEvents', () => {
  it('is a no-op outside the Tauri runtime so browser preview does not show transformCallback errors', async () => {
    vi.stubGlobal('isTauri', false)
    const cleanup = await subscribeLogEvents({
      onStarted: vi.fn(),
      onLine: vi.fn(),
      onStderr: vi.fn(),
      onExit: vi.fn(),
      onError: vi.fn(),
    })

    expect(cleanup).toEqual(expect.any(Function))
    expect(() => cleanup()).not.toThrow()
    vi.unstubAllGlobals()
  })
})
