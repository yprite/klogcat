import { describe, expect, it, vi } from 'vitest'
import { getSettings, resetSettings, saveSettings } from '../commands/tauriSettings'
import { defaultSettings } from '../config/defaultSettings'

describe('tauriSettings browser fallback', () => {
  it('uses default settings outside the Tauri runtime instead of surfacing raw invoke errors', async () => {
    vi.stubGlobal('isTauri', false)

    await expect(getSettings()).resolves.toEqual({ settings: defaultSettings })
    await expect(saveSettings(defaultSettings)).resolves.toEqual(defaultSettings)
    await expect(resetSettings()).resolves.toEqual(defaultSettings)

    vi.unstubAllGlobals()
  })
})
