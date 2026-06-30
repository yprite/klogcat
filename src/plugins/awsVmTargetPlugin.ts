import type { SourceLogType } from '../types/log'
import type { SettingsValidationError } from '../types/settings'
import type { AwsVmTargetPluginSettings, TargetPluginSettings } from '../types/vm'
import { getLogPolicy, sourceTypesFromPolicy } from '../utils/logPolicy'
import type { TargetPluginDefinition } from './pluginModel'

export const AWS_VM_TARGET_PLUGIN_ID = 'aws-vm'
export const AWS_VM_TARGET_SETTINGS_KEY = 'awsVm'
export const AWS_VM_TARGET_KIND = 'aws-vm'
const awsVmSettingKeys = ['enabled', 'bastionHost', 'bastionPort', 'bastionUsername', 'bastionPassword', 'bastionTotpSecret', 'bastionPasswordMode', 'vmUsername', 'vmPassword', 'consulCatalogCommand', 'strictHostKeyChecking', 'logPaths'] as const
const requiredStringKeys = ['bastionHost', 'bastionUsername', 'bastionPassword', 'vmUsername', 'vmPassword', 'consulCatalogCommand'] as const
const secretKeys = ['bastionPassword', 'vmPassword', 'bastionTotpSecret'] as const
const usernameKeys = ['bastionUsername', 'vmUsername'] as const

export const defaultAwsVmTargetPluginSettings: AwsVmTargetPluginSettings = {
  enabled: false,
  bastionHost: '',
  bastionPort: 22,
  bastionUsername: '',
  bastionPassword: '',
  bastionTotpSecret: '',
  bastionPasswordMode: 'password',
  vmUsername: '',
  vmPassword: '',
  consulCatalogCommand: 'consul catalog nodes -format=json',
  strictHostKeyChecking: true,
  logPaths: {
    info: '/var/log/app/info.log',
    access: '/var/log/app/access.log',
    error: '/var/log/app/error.log',
  },
}

function sourceKeys() {
  return sourceTypesFromPolicy(getLogPolicy())
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

function isSshUsername(value: string) {
  return /^[A-Za-z0-9._][A-Za-z0-9._-]{0,63}$/.test(value)
}

function validateVmLogPaths(value: unknown, errors: SettingsValidationError[]) {
  if (!isRecord(value)) {
    errors.push({ field: 'targetPlugins.awsVm.logPaths', message: 'logPaths must be an object' })
    return
  }
  const keys = sourceKeys()
  const actualKeys = Object.keys(value).sort(); const expectedKeys = [...keys].sort()
  if (actualKeys.join(',') !== expectedKeys.join(',')) errors.push({ field: 'targetPlugins.awsVm.logPaths', message: `logPaths must contain exactly ${keys.join('/')} keys` })
  for (const key of keys) {
    const path = value[key]
    if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0')) errors.push({ field: `targetPlugins.awsVm.logPaths.${key}`, message: 'VM log path must be an absolute path without null bytes' })
  }
}

export function validateAwsVmTargetPluginSettings(value: unknown, errors: SettingsValidationError[]) {
  if (!isRecord(value)) {
    errors.push({ field: 'targetPlugins.awsVm', message: 'awsVm plugin config must be an object' })
    return
  }
  rejectExtraKeys(value, awsVmSettingKeys, 'targetPlugins.awsVm', errors)
  validateAwsVmShape(value, errors)
  validateAwsVmRequiredStrings(value, errors)
  validateAwsVmSecrets(value, errors)
  validateAwsVmUsernames(value, errors)
  if (value.enabled === true) validateVmLogPaths(value.logPaths, errors)
}

function validateAwsVmShape(value: Record<string, unknown>, errors: SettingsValidationError[]) {
  if (typeof value.enabled !== 'boolean') errors.push({ field: 'targetPlugins.awsVm.enabled', message: 'enabled must be a boolean' })
  if (!integerInRange(value.bastionPort, 1, 65535)) errors.push({ field: 'targetPlugins.awsVm.bastionPort', message: 'bastionPort must be 1..65535' })
  if (value.bastionPasswordMode !== 'password' && value.bastionPasswordMode !== 'password-plus-totp') errors.push({ field: 'targetPlugins.awsVm.bastionPasswordMode', message: 'bastionPasswordMode must be password or password-plus-totp' })
  if (typeof value.strictHostKeyChecking !== 'boolean') errors.push({ field: 'targetPlugins.awsVm.strictHostKeyChecking', message: 'strictHostKeyChecking must be a boolean' })
}

function validateAwsVmRequiredStrings(value: Record<string, unknown>, errors: SettingsValidationError[]) {
  for (const key of requiredStringKeys) {
    if (typeof value[key] !== 'string') errors.push({ field: `targetPlugins.awsVm.${key}`, message: `${key} must be a string` })
  }
  if (value.enabled !== true) return
  for (const key of requiredStringKeys) {
    if (typeof value[key] === 'string' && value[key].trim() === '') errors.push({ field: `targetPlugins.awsVm.${key}`, message: `${key} is required when AWS VM plugin is enabled` })
  }
}

function validateAwsVmSecrets(value: Record<string, unknown>, errors: SettingsValidationError[]) {
  for (const key of secretKeys) {
    const secret = value[key]
    if (secret !== undefined && typeof secret !== 'string') errors.push({ field: `targetPlugins.awsVm.${key}`, message: `${key} must be a string when provided` })
    if (typeof secret === 'string' && secret.includes('\0')) errors.push({ field: `targetPlugins.awsVm.${key}`, message: `${key} cannot contain null bytes` })
  }
  if (value.enabled === true && value.bastionPasswordMode === 'password-plus-totp' && (typeof value.bastionTotpSecret !== 'string' || value.bastionTotpSecret.trim() === '')) errors.push({ field: 'targetPlugins.awsVm.bastionTotpSecret', message: 'bastionTotpSecret is required for password-plus-totp mode' })
}

function validateAwsVmUsernames(value: Record<string, unknown>, errors: SettingsValidationError[]) {
  for (const key of usernameKeys) {
    const username = value[key]
    if (typeof username === 'string' && username.trim() !== '' && !isSshUsername(username)) errors.push({ field: `targetPlugins.awsVm.${key}`, message: `${key} must be a safe SSH username` })
  }
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
