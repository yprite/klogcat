export const colorThemeOptions = [
  { id: 'dark-plus', label: 'Dark+ (default dark)', scheme: 'dark' },
  { id: 'light-plus', label: 'Light+ (default light)', scheme: 'light' },
  { id: 'dark-modern', label: 'Dark Modern', scheme: 'dark' },
  { id: 'light-modern', label: 'Light Modern', scheme: 'light' },
  { id: 'quiet-light', label: 'Quiet Light', scheme: 'light' },
  { id: 'solarized-dark', label: 'Solarized Dark', scheme: 'dark' },
  { id: 'solarized-light', label: 'Solarized Light', scheme: 'light' },
  { id: 'monokai', label: 'Monokai', scheme: 'dark' },
  { id: 'red', label: 'Red', scheme: 'dark' },
  { id: 'tomorrow-night-blue', label: 'Tomorrow Night Blue', scheme: 'dark' },
  { id: 'abyss', label: 'Abyss', scheme: 'dark' },
  { id: 'kimbie-dark', label: 'Kimbie Dark', scheme: 'dark' },
  { id: 'high-contrast', label: 'High Contrast', scheme: 'dark' },
  { id: 'high-contrast-light', label: 'High Contrast Light', scheme: 'light' },
] as const

export type ColorThemeId = (typeof colorThemeOptions)[number]['id']

export const defaultColorTheme: ColorThemeId = 'dark-plus'

const colorThemeIds = new Set<string>(colorThemeOptions.map((theme) => theme.id))
const storageKey = 'klogcat-color-theme'

export function isColorThemeId(value: unknown): value is ColorThemeId {
  return typeof value === 'string' && colorThemeIds.has(value)
}

export function initialColorTheme(): ColorThemeId {
  if (typeof localStorage === 'undefined') return defaultColorTheme
  try {
    const stored = localStorage.getItem(storageKey)
    return isColorThemeId(stored) ? stored : defaultColorTheme
  } catch {
    return defaultColorTheme
  }
}

export function applyColorTheme(value: unknown) {
  const themeId = isColorThemeId(value) ? value : defaultColorTheme
  const option = colorThemeOptions.find((theme) => theme.id === themeId)
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.colorTheme = themeId
    document.documentElement.style.colorScheme = option?.scheme ?? 'dark'
  }
  if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem(storageKey, themeId) } catch { /* ignore unavailable storage */ }
  }
}
