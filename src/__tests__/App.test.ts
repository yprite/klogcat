import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleLogExit } from '../App'
import { startLogStream } from '../commands/tauriLogs'
import { resetLogStoreForTests, useLogStore } from '../stores/logStore'
import type { ActiveStreamMeta } from '../types/log'

vi.mock('../commands/tauriLogEvents', () => ({
  subscribeLogEvents: vi.fn(),
}))
vi.mock('../commands/tauriLogs', () => ({
  startLogStream: vi.fn(async () => undefined),
}))

const meta = (streamId: string): ActiveStreamMeta => ({
  streamId,
  sourceId: 'src',
  sourceType: 'app',
  namespace: 'ns',
  pod: 'pod',
  container: 'app',
  filePath: '/x',
})

describe('App log exit handling', () => {
  beforeEach(() => { resetLogStoreForTests(); vi.mocked(startLogStream).mockClear() })

  it('treats requested stops as stopped', () => {
    useLogStore.getState().prepareStarting(meta('s1'))
    handleLogExit({ streamId: 's1', requestedStop: true })
    expect(useLogStore.getState().streamStatus).toBe('stopped')
  })

  it('treats non-requested missing, signal, and nonzero exits as errors', () => {
    useLogStore.getState().prepareStarting(meta('missing'))
    handleLogExit({ streamId: 'missing', requestedStop: false })
    expect(useLogStore.getState().streamStatus).toBe('error')
    expect(useLogStore.getState().errorMessage).toMatch(/without an exit code/)

    useLogStore.getState().prepareStarting(meta('signal'))
    handleLogExit({ streamId: 'signal', requestedStop: false, signal: 'SIGTERM' })
    expect(useLogStore.getState().streamStatus).toBe('error')
    expect(useLogStore.getState().errorMessage).toMatch(/SIGTERM/)

    useLogStore.getState().prepareStarting(meta('code'))
    handleLogExit({ streamId: 'code', requestedStop: false, exitCode: 2 })
    expect(useLogStore.getState().streamStatus).toBe('error')
    expect(useLogStore.getState().errorMessage).toMatch(/code 2/)
  })

  it('allows non-requested zero exits', () => {
    useLogStore.getState().prepareStarting(meta('s1'))
    handleLogExit({ streamId: 's1', requestedStop: false, exitCode: 0 })
    expect(useLogStore.getState().streamStatus).toBe('stopped')
  })

  it('reconnects unexpected exits when auto-reconnect is enabled', () => {
    useLogStore.getState().prepareStarting({ ...meta('s1'), context: 'ctx', initialTailLines: 123 })
    useLogStore.getState().setReconnectEnabled(true)
    handleLogExit({ streamId: 's1', requestedStop: false, exitCode: 2 })

    expect(startLogStream).toHaveBeenCalledWith(expect.objectContaining({ context: 'ctx', initialTailLines: 123 }))
    expect(vi.mocked(startLogStream).mock.calls[0][0].streamId).toMatch(/^s1-retry-[0-9a-f-]+$/)
    expect(useLogStore.getState().activeStreamIds).toEqual([vi.mocked(startLogStream).mock.calls[0][0].streamId])
    expect(useLogStore.getState().actionDebugMessages.at(-1)).toMatch(/Reconnect scheduled/)
  })
})
