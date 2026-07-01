import type { SourceLogType } from '../types/log'
import type { SettingsValidationError } from '../types/settings'
import type { AwsVmTargetPluginSettings, TargetPluginSettings } from '../types/vm'
import { getLogPolicy, sourceTypesFromPolicy } from '../utils/logPolicy'
import type { TargetPluginDefinition } from './pluginModel'

export const AWS_VM_TARGET_PLUGIN_ID = 'aws-vm'
export const AWS_VM_TARGET_SETTINGS_KEY = 'awsVm'
export const AWS_VM_TARGET_KIND = 'aws-vm'

export const defaultAwsVmTargetPluginSettings: AwsVmTargetPluginSettings = {
  enabled: false,
  bastionHost: '',
  bastionPort: 22,
  bastionUsername: '',
  bastionPasswordEnv: 'KLOGCAT_BASTION_PASSWORD',
  bastionTotpSecretEnv: 'KLOGCAT_BASTION_TOTP_SECRET',
  bastionPasswordMode: 'password',
  vmUsername: '',
  vmPasswordEnv: 'KLOGCAT_VM_PASSWORD',
  consulCatalogCommand: 'consul catalog nodes -format=json',
  strictHostKeyChecking: true,
  logPaths: {
    info: '/var/log/app/info.log',
    access: '/var/log/app/access.log',
    error: '/var/log/app/error.log',
  },
}

function sourceKeys(sourceTypes?: SourceLogType[]) {
  return sourceTypes ?? sourceTypesFromPolicy(getLogPolicy())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejectExtraKeys(value: Record<string, unknown>, allowed: readonly string[], prefix: string, errors: SettingsValidationError[]) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push({ field: `${prefix}.${key}`, message: `Unknown key: ${key}` })
  }
}

function integerInRange(value: unknown, min: number, max: number) {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max
}

function isEnvName(value: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
}

function isSshUsername(value: string) {
  return /^[A-Za-z0-9._][A-Za-z0-9._-]{0,63}$/.test(value)
}

const awsVmAllowedKeys = ['enabled', 'bastionHost', 'bastionPort', 'bastionUsername', 'bastionPasswordEnv', 'bastionTotpSecretEnv', 'bastionPasswordMode', 'vmUsername', 'vmPasswordEnv', 'consulCatalogCommand', 'strictHostKeyChecking', 'logPaths'] as const
const awsVmStringKeys = ['bastionHost', 'bastionUsername', 'bastionPasswordEnv', 'vmUsername', 'vmPasswordEnv', 'consulCatalogCommand'] as const
const awsVmRequiredWhenEnabledKeys = awsVmStringKeys
const awsVmEnvKeys = ['bastionPasswordEnv', 'vmPasswordEnv', 'bastionTotpSecretEnv'] as const
const awsVmUsernameKeys = ['bastionUsername', 'vmUsername'] as const

type AwsVmRecord = Record<string, unknown>

function addError(errors: SettingsValidationError[], field: string, message: string) {
  errors.push({ field, message })
}

function fieldName(key: string) {
  return `targetPlugins.awsVm.${key}`
}

function validateAwsVmPrimitiveFields(value: AwsVmRecord, errors: SettingsValidationError[]) {
  if (typeof value.enabled !== 'boolean') addError(errors, fieldName('enabled'), 'enabled must be a boolean')
  if (!integerInRange(value.bastionPort, 1, 65535)) addError(errors, fieldName('bastionPort'), 'bastionPort must be 1..65535')
  if (value.bastionPasswordMode !== 'password' && value.bastionPasswordMode !== 'password-plus-totp') addError(errors, fieldName('bastionPasswordMode'), 'bastionPasswordMode must be password or password-plus-totp')
  if (typeof value.strictHostKeyChecking !== 'boolean') addError(errors, fieldName('strictHostKeyChecking'), 'strictHostKeyChecking must be a boolean')
}

function validateAwsVmStringFields(value: AwsVmRecord, errors: SettingsValidationError[]) {
  for (const key of awsVmStringKeys) {
    if (typeof value[key] !== 'string') addError(errors, fieldName(key), `${key} must be a string`)
  }
  if (value.bastionTotpSecretEnv !== undefined && typeof value.bastionTotpSecretEnv !== 'string') addError(errors, fieldName('bastionTotpSecretEnv'), 'bastionTotpSecretEnv must be a string when provided')
}

function validateAwsVmRequiredFields(value: AwsVmRecord, errors: SettingsValidationError[]) {
  if (value.enabled !== true) return
  for (const key of awsVmRequiredWhenEnabledKeys) {
    if (typeof value[key] === 'string' && value[key].trim() === '') addError(errors, fieldName(key), `${key} is required when AWS VM plugin is enabled`)
  }
}

function validateAwsVmEnvFields(value: AwsVmRecord, errors: SettingsValidationError[]) {
  for (const key of awsVmEnvKeys) {
    const envName = value[key]
    if ((key === 'bastionPasswordEnv' || key === 'vmPasswordEnv') && typeof envName === 'string' && envName.trim() === '') addError(errors, fieldName(key), `${key} must be a valid environment variable name`)
    if (envName !== undefined && typeof envName === 'string' && envName.trim() !== '' && !isEnvName(envName)) addError(errors, fieldName(key), `${key} must be a valid environment variable name`)
  }
}

function validateAwsVmTotpMode(value: AwsVmRecord, errors: SettingsValidationError[]) {
  const secretMissing = typeof value.bastionTotpSecretEnv !== 'string' || value.bastionTotpSecretEnv.trim() === ''
  if (value.enabled === true && value.bastionPasswordMode === 'password-plus-totp' && secretMissing) addError(errors, fieldName('bastionTotpSecretEnv'), 'bastionTotpSecretEnv is required for password-plus-totp mode')
}

function validateAwsVmUsernames(value: AwsVmRecord, errors: SettingsValidationError[]) {
  for (const key of awsVmUsernameKeys) {
    const username = value[key]
    if (typeof username === 'string' && username.trim() !== '' && !isSshUsername(username)) addError(errors, fieldName(key), `${key} must be a safe SSH username`)
  }
}

function validateVmLogPaths(value: unknown, errors: SettingsValidationError[], sourceTypes?: SourceLogType[]) {
  if (!isRecord(value)) {
    errors.push({ field: 'targetPlugins.awsVm.logPaths', message: 'logPaths must be an object' })
    return
  }
  const keys = sourceKeys(sourceTypes)
  const actualKeys = Object.keys(value).sort(); const expectedKeys = [...keys].sort()
  if (actualKeys.join(',') !== expectedKeys.join(',')) errors.push({ field: 'targetPlugins.awsVm.logPaths', message: `logPaths must contain exactly ${keys.join('/')} keys` })
  for (const key of keys) {
    const path = value[key]
    if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0')) errors.push({ field: `targetPlugins.awsVm.logPaths.${key}`, message: 'VM log path must be an absolute path without null bytes' })
  }
}

export function validateAwsVmTargetPluginSettings(value: unknown, errors: SettingsValidationError[], sourceTypes?: SourceLogType[]) {
  if (!isRecord(value)) {
    errors.push({ field: 'targetPlugins.awsVm', message: 'awsVm plugin config must be an object' })
    return
  }
  rejectExtraKeys(value, [...awsVmAllowedKeys], 'targetPlugins.awsVm', errors)
  validateAwsVmPrimitiveFields(value, errors)
  validateAwsVmStringFields(value, errors)
  validateAwsVmRequiredFields(value, errors)
  validateAwsVmEnvFields(value, errors)
  validateAwsVmTotpMode(value, errors)
  validateAwsVmUsernames(value, errors)
  validateVmLogPaths(value.logPaths, errors, sourceTypes)
}

export const awsVmTargetPlugin: TargetPluginDefinition<AwsVmTargetPluginSettings> = {
  manifest: {
    id: AWS_VM_TARGET_PLUGIN_ID,
    ownerId: 'klogcat.core',
    kind: 'target',
    label: 'AWS VM',
    description: 'Discover VM log targets from Consul through a bastion host.',
    source: 'core',
    order: 20,
  },
  settingsKey: AWS_VM_TARGET_SETTINGS_KEY,
  targetKind: AWS_VM_TARGET_KIND,
  requiredCapabilities: ['target.discovery', 'process.spawn', 'network.ssh'],
  defaultSettings: defaultAwsVmTargetPluginSettings,
  isEnabled(settings: TargetPluginSettings | undefined) {
    return Boolean(settings?.awsVm.enabled)
  },
  validate: validateAwsVmTargetPluginSettings,
}

export function vmLogPathForSource(plugin: AwsVmTargetPluginSettings, sourceType: SourceLogType) {
  return plugin.logPaths[sourceType]
}
