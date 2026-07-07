export const fontSizeOptions = [
  { id: 'compact', label: 'Compact', menuScale: 0.9, logScale: 0.9 },
  { id: 'normal', label: 'Normal', menuScale: 1, logScale: 1 },
  { id: 'large', label: 'Large', menuScale: 1.12, logScale: 1.15 },
  { id: 'extra-large', label: 'Extra Large', menuScale: 1.25, logScale: 1.3 },
] as const

export type FontSizeId = (typeof fontSizeOptions)[number]['id']

export const defaultFontSize: FontSizeId = 'normal'

const fontSizeIds = new Set<string>(fontSizeOptions.map((option) => option.id))

export function isFontSizeId(value: unknown): value is FontSizeId {
  return typeof value === 'string' && fontSizeIds.has(value)
}

export function fontSizeClass(scope: 'menu' | 'log', value: unknown) {
  const id = isFontSizeId(value) ? value : defaultFontSize
  return `klogcat-${scope}-font-${id}`
}
