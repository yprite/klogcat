import type { PersistedSettings, SettingsValidationError } from '../types/settings'
import { getLogPolicy, sourceTypesFromPolicy } from '../utils/logPolicy'

function sourceKeys() { return sourceTypesFromPolicy(getLogPolicy()) }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function rejectExtraKeys(value: Record<string, unknown>, allowed: readonly string[], prefix: string, errors: SettingsValidationError[]) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push({ field: `${prefix}.${key}`, message: `Unknown key: ${key}` })
}
export function validateSettings(value: unknown): SettingsValidationError[] {
  const errors: SettingsValidationError[] = []
  if (!isRecord(value)) return [{ field: 'settings', message: 'Settings must be an object' }]
  rejectExtraKeys(value, ['schemaVersion', 'defaultNamespace', 'initialTailLines', 'bufferLimit', 'logSources'], 'settings', errors)
  if (value.schemaVersion !== 1) errors.push({ field: 'schemaVersion', message: 'schemaVersion must be 1' })
  if (!Number.isInteger(value.initialTailLines) || (value.initialTailLines as number) < 0 || (value.initialTailLines as number) > 100000) errors.push({ field: 'initialTailLines', message: 'initialTailLines must be 0..100000' })
  if (!Number.isInteger(value.bufferLimit) || (value.bufferLimit as number) < 1000 || (value.bufferLimit as number) > 200000) errors.push({ field: 'bufferLimit', message: 'bufferLimit must be 1000..200000' })
  if (value.defaultNamespace !== undefined && typeof value.defaultNamespace !== 'string') errors.push({ field: 'defaultNamespace', message: 'defaultNamespace must be a string when provided' })
  const logSources = value.logSources
  if (!isRecord(logSources)) { errors.push({ field: 'logSources', message: 'logSources must be an object' }); return errors }
  const keys = sourceKeys()
  const actualKeys = Object.keys(logSources).sort(); const expectedKeys = [...keys].sort()
  if (actualKeys.join(',') !== expectedKeys.join(',')) errors.push({ field: 'logSources', message: `logSources must contain exactly ${keys.join('/')} keys` })
  for (const key of keys) {
    const source = logSources[key]
    if (!isRecord(source)) { errors.push({ field: `logSources.${key}`, message: 'source config must be an object' }); continue }
    rejectExtraKeys(source, ['container', 'filePath'], `logSources.${key}`, errors)
    if (typeof source.container !== 'string' || source.container.trim() === '') errors.push({ field: `logSources.${key}.container`, message: 'container is required' })
    if (typeof source.filePath !== 'string' || !source.filePath.startsWith('/') || source.filePath.includes('\0')) errors.push({ field: `logSources.${key}.filePath`, message: 'filePath must be an absolute path without null bytes' })
  }
  return errors
}
export function assertValidSettings(value: unknown): asserts value is PersistedSettings {
  const errors = validateSettings(value)
  if (errors.length > 0) throw Object.assign(new Error('settings validation failed'), { validationErrors: errors })
}
