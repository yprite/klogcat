import { describe, expect, it, vi } from 'vitest'

const listeners = new Map<string, (event: { payload: unknown }) => void>()
const unlisteners = Array.from({ length: 6 }, () => vi.fn())
let unlistenIndex = 0

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
    listeners.set(name, callback)
    return unlisteners[unlistenIndex++]
  }),
}))

describe('tauri event subscription scenario', () => {
  it('binds every desktop log event and cleans up all listeners', async () => {
    const { subscribeLogEvents } = await import('../../commands/tauriLogEvents')
    const handlers = {
      onStarted: vi.fn(),
      onLine: vi.fn(),
      onLines: vi.fn(),
      onStderr: vi.fn(),
      onExit: vi.fn(),
      onError: vi.fn(),
    }

    const cleanup = await subscribeLogEvents(handlers)

    listeners.get('log://started')?.({ payload: { streamId: 's1', receivedAt: 1 } })
    listeners.get('log://lines')?.({ payload: { emittedAt: 2, lines: [] } })
    listeners.get('log://line')?.({ payload: { streamId: 's1', sourceType: 'info', raw: 'x', receivedAt: 3 } })
    listeners.get('log://stderr')?.({ payload: { streamId: 's1', line: 'stderr', receivedAt: 4 } })
    listeners.get('log://exit')?.({ payload: { streamId: 's1', exitCode: 0, requestedStop: false } })
    listeners.get('log://error')?.({ payload: { streamId: 's1', code: 'x', message: 'failed' } })

    expect(handlers.onStarted).toHaveBeenCalledWith({ streamId: 's1', receivedAt: 1 })
    expect(handlers.onLines).toHaveBeenCalledWith({ emittedAt: 2, lines: [] })
    expect(handlers.onLine).toHaveBeenCalledWith({ streamId: 's1', sourceType: 'info', raw: 'x', receivedAt: 3 })
    expect(handlers.onStderr).toHaveBeenCalledWith({ streamId: 's1', line: 'stderr', receivedAt: 4 })
    expect(handlers.onExit).toHaveBeenCalledWith({ streamId: 's1', exitCode: 0, requestedStop: false })
    expect(handlers.onError).toHaveBeenCalledWith({ streamId: 's1', code: 'x', message: 'failed' })

    cleanup()
    expect(unlisteners.every((unlisten) => unlisten.mock.calls.length === 1)).toBe(true)
  })
})
