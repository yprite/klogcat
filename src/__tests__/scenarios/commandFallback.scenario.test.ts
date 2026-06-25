import { describe, expect, it, vi } from 'vitest'
import { getCurrentContext, listContexts, listNamespaces, listPods } from '../../commands/tauriKube'
import { subscribeLogEvents } from '../../commands/tauriLogEvents'
import { startLogStream, stopAllLogStreams, stopLogStream } from '../../commands/tauriLogs'
import { getSettings, resetSettings, saveSettings } from '../../commands/tauriSettings'
import { commandErrorMessage } from '../../commands/types'
import { defaultSettings } from '../../config/defaultSettings'

describe('browser fallback command boundary scenario', () => {
  it('keeps every Tauri command wrapper safe outside the desktop runtime', async () => {
    await expect(getCurrentContext()).resolves.toBe('')
    await expect(listContexts()).resolves.toEqual({ contexts: [] })
    await expect(listNamespaces('demo')).resolves.toEqual({ context: 'demo', namespaces: [] })
    await expect(listPods('default', 'demo')).resolves.toEqual({ context: 'demo', namespace: 'default', pods: [] })

    await expect(startLogStream({
      streamId: 's1',
      namespace: 'default',
      pod: 'api-1',
      container: 'app',
      sourceType: 'info',
      filePath: '/tmp/info.log',
      initialTailLines: 10,
    })).rejects.toThrow('Tauri runtime is unavailable')
    await expect(stopLogStream('s1')).resolves.toBeUndefined()
    await expect(stopAllLogStreams()).resolves.toBeUndefined()

    const cleanup = await subscribeLogEvents({
      onStarted: vi.fn(),
      onLine: vi.fn(),
      onStderr: vi.fn(),
      onExit: vi.fn(),
      onError: vi.fn(),
    })
    expect(() => cleanup()).not.toThrow()

    await expect(getSettings()).resolves.toEqual({ settings: defaultSettings })
    await expect(saveSettings(defaultSettings)).resolves.toEqual(defaultSettings)
    await expect(resetSettings()).resolves.toEqual(defaultSettings)
    expect(commandErrorMessage({ message: 'readable' })).toBe('readable')
    expect(commandErrorMessage('raw')).toBe('raw')
  })
})
