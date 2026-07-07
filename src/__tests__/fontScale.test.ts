import { describe, expect, it } from 'vitest'
import { defaultFontSize, fontSizeClass, fontSizeOptions, isFontSizeId } from '../utils/fontScale'

describe('font scale settings', () => {
  it('recognizes configured font size ids', () => {
    expect(fontSizeOptions.map((option) => option.id)).toEqual(['compact', 'normal', 'large', 'extra-large'])
    expect(defaultFontSize).toBe('normal')
    expect(isFontSizeId('compact')).toBe(true)
    expect(isFontSizeId('extra-large')).toBe(true)
    expect(isFontSizeId('huge')).toBe(false)
    expect(isFontSizeId(1)).toBe(false)
  })

  it('builds scoped classes and falls back to the default size', () => {
    expect(fontSizeClass('menu', 'large')).toBe('klogcat-menu-font-large')
    expect(fontSizeClass('log', 'compact')).toBe('klogcat-log-font-compact')
    expect(fontSizeClass('menu', 'invalid')).toBe('klogcat-menu-font-normal')
    expect(fontSizeClass('log', undefined)).toBe('klogcat-log-font-normal')
  })
})
