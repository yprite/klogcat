import { describe, expect, it, vi } from 'vitest'
import { startLogStream, stopAllLogStreams, stopLogStream } from '../commands/tauriLogs'

describe('tauriLogs browser fallback', () => {
  it('reports a readable runtime error outside Tauri instead of raw invoke internals', async () => {
    vi.stubGlobal('isTauri', false)

    await expect(startLogStream({ streamId: 's1', namespace: 'ns', pod: 'pod', container: 'app', sourceType: 'info', filePath: '/tmp/x.log', initialTailLines: 10 })).rejects.toThrow('Tauri runtime is unavailable')
    await expect(stopLogStream('s1')).resolves.toBeUndefined()
    await expect(stopAllLogStreams()).resolves.toBeUndefined()

    vi.unstubAllGlobals()
  })
})
