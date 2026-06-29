import type { PersistedSettings, SettingsValidationError } from '../types/settings'
import { isWorkbenchFeatureFlagName } from './workbenchFeatureFlags'
import { assertValidLogPolicy, getLogPolicy, sourceTypesFromPolicy } from '../utils/logPolicy'

function sourceKeys() { return sourceTypesFromPolicy(getLogPolicy()) }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function rejectExtraKeys(value: Record<string, unknown>, allowed: readonly string[], prefix: string, errors: SettingsValidationError[]) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push({ field: `${prefix}.${key}`, message: `Unknown key: ${key}` })
}

function validateTopLevelFields(value: Record<string, unknown>, errors: SettingsValidationError[]) {
  rejectExtraKeys(value, ['schemaVersion', 'defaultNamespace', 'language', 'initialTailLines', 'bufferLimit', 'logSources', 'logPolicyId', 'logPolicy', 'workbench'], 'settings', errors)
  const validators: Array<[string, boolean, string]> = [
    ['schemaVersion', value.schemaVersion !== 1, 'schemaVersion must be 1'],
    ['language', value.language !== undefined && value.language !== 'en' && value.language !== 'ko', 'language must be en or ko'],
    ['initialTailLines', !integerInRange(value.initialTailLines, 0, 100000), 'initialTailLines must be 0..100000'],
    ['bufferLimit', !integerInRange(value.bufferLimit, 1000, 200000), 'bufferLimit must be 1000..200000'],
    ['defaultNamespace', value.defaultNamespace !== undefined && typeof value.defaultNamespace !== 'string', 'defaultNamespace must be a string when provided'],
    ['logPolicyId', value.logPolicyId !== undefined && value.logPolicyId !== 'scloud' && value.logPolicyId !== 'custom', 'logPolicyId must be scloud or custom'],
  ]
  for (const [field, invalid, message] of validators) if (invalid) errors.push({ field, message })
}

function integerInRange(value: unknown, min: number, max: number) {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max
}

function validateEmbeddedLogPolicy(value: Record<string, unknown>, errors: SettingsValidationError[]) {
  if (value.logPolicy === undefined) return
  try { assertValidLogPolicy(value.logPolicy) }
  catch (error) { errors.push({ field: 'logPolicy', message: error instanceof Error ? error.message : String(error) }) }
}

function validateLogSources(value: unknown, errors: SettingsValidationError[]) {
  if (!isRecord(value)) {
    errors.push({ field: 'logSources', message: 'logSources must be an object' })
    return
  }
  const keys = sourceKeys()
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

function validateWorkbenchSettings(value: unknown, errors: SettingsValidationError[]) {
  if (value === undefined) return
  if (!isRecord(value)) {
    errors.push({ field: 'workbench', message: 'workbench must be an object when provided' })
    return
  }
  rejectExtraKeys(value, ['featureFlags'], 'workbench', errors)
  if (value.featureFlags === undefined) return
  if (!isRecord(value.featureFlags)) {
    errors.push({ field: 'workbench.featureFlags', message: 'featureFlags must be an object when provided' })
    return
  }
  for (const [key, flagValue] of Object.entries(value.featureFlags)) {
    const field = `workbench.featureFlags.${key}`
    if (!isWorkbenchFeatureFlagName(key)) {
      errors.push({ field, message: `Unknown workbench feature flag: ${key}` })
      continue
    }
    if (typeof flagValue !== 'boolean') errors.push({ field, message: 'workbench feature flags must be boolean' })
  }
}

export function validateSettings(value: unknown): SettingsValidationError[] {
  const errors: SettingsValidationError[] = []
  if (!isRecord(value)) return [{ field: 'settings', message: 'Settings must be an object' }]
  validateTopLevelFields(value, errors)
  validateEmbeddedLogPolicy(value, errors)
  validateWorkbenchSettings(value.workbench, errors)
  validateLogSources(value.logSources, errors)
  return errors
}
export function assertValidSettings(value: unknown): asserts value is PersistedSettings {
  const errors = validateSettings(value)
  if (errors.length > 0) throw Object.assign(new Error('settings validation failed'), { validationErrors: errors })
}
