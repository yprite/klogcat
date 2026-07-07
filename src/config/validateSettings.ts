import type { PersistedSettings, SettingsValidationError } from '../types/settings'
import { validateTargetPluginSettings } from '../plugins/targetPluginRegistry'
import { validateViewerPluginSettings } from '../plugins/viewerPluginRegistry'
import { isColorThemeId } from '../utils/colorTheme'
import { isFontSizeId } from '../utils/fontScale'
import { assertValidLogPolicy, getLogPolicy, sourceTypesFromPolicy, type LogPolicy } from '../utils/logPolicy'

function sourceKeys(policy?: LogPolicy) { return sourceTypesFromPolicy(policy ?? getLogPolicy()) }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function rejectExtraKeys(value: Record<string, unknown>, allowed: readonly string[], prefix: string, errors: SettingsValidationError[]) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push({ field: `${prefix}.${key}`, message: `Unknown key: ${key}` })
}

function validateTopLevelFields(value: Record<string, unknown>, errors: SettingsValidationError[]) {
  rejectExtraKeys(value, ['schemaVersion', 'defaultNamespace', 'language', 'colorTheme', 'menuFontSize', 'logViewerFontSize', 'initialTailLines', 'bufferLimit', 'logSources', 'shortcuts', 'logPolicyId', 'logPolicy', 'plugins'], 'settings', errors)
  const validators: Array<[string, boolean, string]> = [
    ['schemaVersion', value.schemaVersion !== 1, 'schemaVersion must be 1'],
    ['language', value.language !== undefined && value.language !== 'en' && value.language !== 'ko', 'language must be en or ko'],
    ['colorTheme', value.colorTheme !== undefined && !isColorThemeId(value.colorTheme), 'colorTheme must be a supported VS Code color theme'],
    ['menuFontSize', value.menuFontSize !== undefined && !isFontSizeId(value.menuFontSize), 'menuFontSize must be a supported font size'],
    ['logViewerFontSize', value.logViewerFontSize !== undefined && !isFontSizeId(value.logViewerFontSize), 'logViewerFontSize must be a supported font size'],
    ['initialTailLines', !integerInRange(value.initialTailLines, 0, 100000), 'initialTailLines must be 0..100000'],
    ['bufferLimit', !integerInRange(value.bufferLimit, 1000, 200000), 'bufferLimit must be 1000..200000'],
    ['defaultNamespace', value.defaultNamespace !== undefined && typeof value.defaultNamespace !== 'string', 'defaultNamespace must be a string when provided'],
    ['logPolicyId', value.logPolicyId !== undefined && value.logPolicyId !== 'scloud' && value.logPolicyId !== 'custom', 'logPolicyId must be scloud or custom'],
  ]
  for (const [field, invalid, message] of validators) if (invalid) errors.push({ field, message })
}

function validatePlugins(value: unknown, errors: SettingsValidationError[]) {
  if (!isRecord(value)) {
    errors.push({ field: 'plugins', message: 'plugins must be an object' })
    return
  }
  rejectExtraKeys(value, ['targets', 'viewers'], 'plugins', errors)
  validateTargetPluginSettings(value.targets, errors)
  validateViewerPluginSettings(value.viewers, errors)
}

function integerInRange(value: unknown, min: number, max: number) {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max
}

function validateEmbeddedLogPolicy(value: Record<string, unknown>, errors: SettingsValidationError[]) {
  if (value.logPolicy === undefined) return undefined
  try { assertValidLogPolicy(value.logPolicy); return value.logPolicy }
  catch (error) { errors.push({ field: 'logPolicy', message: error instanceof Error ? error.message : String(error) }) }
  return undefined
}

function validateShortcuts(value: unknown, errors: SettingsValidationError[]) {
  if (value === undefined) return
  if (!isRecord(value)) {
    errors.push({ field: 'shortcuts', message: 'shortcuts must be an object' })
    return
  }
  rejectExtraKeys(value, ['openSettings', 'openTargetPicker', 'toggleStream', 'restartStream'], 'shortcuts', errors)
  for (const [key, shortcut] of Object.entries(value)) {
    if (shortcut !== undefined && typeof shortcut !== 'string') errors.push({ field: `shortcuts.${key}`, message: 'shortcut must be a string' })
  }
}

function validateLogSources(value: unknown, errors: SettingsValidationError[], policy?: LogPolicy) {
  if (!isRecord(value)) {
    errors.push({ field: 'logSources', message: 'logSources must be an object' })
    return
  }
  const keys = sourceKeys(policy)
  const actualKeys = Object.keys(value).sort(); const expectedKeys = [...keys].sort()
  if (actualKeys.join(',') !== expectedKeys.join(',')) errors.push({ field: 'logSources', message: `logSources must contain exactly ${keys.join('/')} keys` })
  for (const key of keys) validateLogSource(key, value[key], errors)
}

function validateLogSource(key: string, source: unknown, errors: SettingsValidationError[]) {
  if (!isRecord(source)) {
    errors.push({ field: `logSources.${key}`, message: 'source config must be an object' })
    return
  }
  rejectExtraKeys(source, ['container', 'filePath'], `logSources.${key}`, errors)
  if (typeof source.container !== 'string' || source.container.trim() === '') errors.push({ field: `logSources.${key}.container`, message: 'container is required' })
  if (typeof source.filePath !== 'string' || !source.filePath.startsWith('/') || source.filePath.includes('\0')) errors.push({ field: `logSources.${key}.filePath`, message: 'filePath must be an absolute path without null bytes' })
}

export function validateSettings(value: unknown): SettingsValidationError[] {
  const errors: SettingsValidationError[] = []
  if (!isRecord(value)) return [{ field: 'settings', message: 'Settings must be an object' }]
  validateTopLevelFields(value, errors)
  const policy = validateEmbeddedLogPolicy(value, errors)
  validateShortcuts(value.shortcuts, errors)
  validateLogSources(value.logSources, errors, policy)
  validatePlugins(value.plugins, errors)
  return errors
}
export function assertValidSettings(value: unknown): asserts value is PersistedSettings {
  const errors = validateSettings(value)
  if (errors.length > 0) throw Object.assign(new Error('settings validation failed'), { validationErrors: errors })
}
