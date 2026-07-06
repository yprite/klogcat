import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyColorTheme, defaultColorTheme, initialColorTheme, isColorThemeId } from '../utils/colorTheme'

describe('color themes', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
    document.documentElement.removeAttribute('data-color-theme')
    localStorage.clear()
  })

  it('recognizes supported VS Code theme ids', () => {
    expect(isColorThemeId('dark-plus')).toBe(true)
    expect(isColorThemeId('monokai')).toBe(true)
    expect(isColorThemeId('unknown-theme')).toBe(false)
  })

  it('applies and persists the selected theme', () => {
    applyColorTheme('monokai')

    expect(document.documentElement.dataset.colorTheme).toBe('monokai')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(localStorage.getItem('klogcat-color-theme')).toBe('monokai')
    expect(initialColorTheme()).toBe('monokai')
  })

  it('falls back to the default theme for invalid values', () => {
    applyColorTheme('not-a-theme')

    expect(document.documentElement.dataset.colorTheme).toBe(defaultColorTheme)
    expect(localStorage.getItem('klogcat-color-theme')).toBe(defaultColorTheme)
  })
})
