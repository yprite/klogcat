import type { SourceLogType } from '../types/log'
import type { SettingsValidationError } from '../types/settings'
import type { AwsVmTargetGroupSettings, AwsVmTargetModuleSettings, AwsVmTargetPluginSettings, TargetPluginSettings, VmTargetInfo } from '../types/vm'
import { getLogPolicy, sourceTypesFromPolicy } from '../utils/logPolicy'
import type { TargetPluginDefinition } from './pluginModel'

export const AWS_VM_TARGET_PLUGIN_ID = 'aws-vm'
export const AWS_VM_TARGET_SETTINGS_KEY = 'awsVm'
export const AWS_VM_TARGET_KIND = 'aws-vm'
const awsVmSettingKeys = ['enabled', 'bastionHost', 'bastionPort', 'bastionUsername', 'bastionPassword', 'bastionTotpSecret', 'bastionPasswordMode', 'vmUsername', 'vmPassword', 'consulCatalogCommand', 'strictHostKeyChecking', 'logPaths', 'targetGroups'] as const
const awsVmTargetGroupKeys = ['id', 'name', 'enabled', 'bastionHost', 'bastionPort', 'bastionUsername', 'bastionPassword', 'bastionTotpSecret', 'bastionPasswordMode', 'vmUsername', 'vmPassword', 'consulCatalogCommand', 'strictHostKeyChecking', 'logPaths', 'modules'] as const
const awsVmTargetModuleKeys = ['id', 'name', 'consulCatalogCommand', 'logPaths'] as const
const requiredStringKeys = ['bastionHost', 'bastionUsername', 'bastionPassword', 'vmUsername', 'vmPassword', 'consulCatalogCommand'] as const
const secretKeys = ['bastionPassword', 'vmPassword', 'bastionTotpSecret'] as const

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
  targetGroups: [],
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

function isSshEmailUsername(value: string) {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)
}

function isValidUsername(key: 'bastionUsername' | 'vmUsername', value: string) {
  if (key === 'vmUsername' && isSshEmailUsername(value)) return true
  return isSshUsername(value)
}

function validateVmLogPaths(value: unknown, errors: SettingsValidationError[], prefix = 'targetPlugins.awsVm.logPaths') {
  if (!isRecord(value)) {
    errors.push({ field: prefix, message: 'logPaths must be an object' })
    return
  }
  const keys = sourceKeys()
  const actualKeys = Object.keys(value).sort(); const expectedKeys = [...keys].sort()
  if (actualKeys.join(',') !== expectedKeys.join(',')) errors.push({ field: prefix, message: `logPaths must contain exactly ${keys.join('/')} keys` })
  for (const key of keys) {
    const path = value[key]
    if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0')) errors.push({ field: `${prefix}.${key}`, message: 'VM log path must be an absolute path without null bytes' })
  }
}

function validatePartialVmLogPaths(value: unknown, errors: SettingsValidationError[], prefix: string) {
  if (value === undefined) return
  if (!isRecord(value)) {
    errors.push({ field: prefix, message: 'logPaths must be an object' })
    return
  }
  const keys = sourceKeys()
  for (const key of Object.keys(value)) {
    if (!keys.includes(key as SourceLogType)) errors.push({ field: `${prefix}.${key}`, message: `Unknown log path key: ${key}` })
  }
  for (const key of keys) {
    const path = value[key]
    if (path !== undefined && (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0'))) errors.push({ field: `${prefix}.${key}`, message: 'VM log path must be an absolute path without null bytes' })
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
  validateAwsVmTargetGroups(value, errors)
  if (value.enabled === true) {
    const groups = Array.isArray(value.targetGroups) ? value.targetGroups : []
    if (groups.length === 0) {
      validateVmLogPaths(value.logPaths, errors)
    } else if (canExpandAwsVmTargetGroups(value)) {
      for (const profile of effectiveAwsVmPlugins(value as AwsVmTargetPluginSettings)) validateEffectiveAwsVmPlugin(profile.plugin, errors, profile.fieldPrefix)
    }
  }
}

function canExpandAwsVmTargetGroups(value: Record<string, unknown>) {
  return isRecord(value.logPaths)
    && Array.isArray(value.targetGroups)
    && value.targetGroups.every((group) => isRecord(group)
      && typeof group.id === 'string'
      && typeof group.name === 'string'
      && typeof group.enabled === 'boolean'
      && Array.isArray(group.modules)
      && group.modules.every((module) => isRecord(module) && typeof module.id === 'string' && typeof module.name === 'string'))
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
  if (value.enabled !== true || (Array.isArray(value.targetGroups) && value.targetGroups.length > 0)) return
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
  for (const key of ['bastionUsername', 'vmUsername'] as const) {
    const username = value[key]
    if (typeof username === 'string' && username.trim() !== '' && !isValidUsername(key, username)) errors.push({ field: `targetPlugins.awsVm.${key}`, message: `${key} must be a safe SSH username or email account` })
  }
}

function validateAwsVmTargetGroups(value: Record<string, unknown>, errors: SettingsValidationError[]) {
  const groups = value.targetGroups
  if (groups === undefined) return
  if (!Array.isArray(groups)) {
    errors.push({ field: 'targetPlugins.awsVm.targetGroups', message: 'targetGroups must be an array' })
    return
  }
  const groupIds = new Set<string>()
  groups.forEach((group, index) => validateAwsVmTargetGroup(group, index, groupIds, errors))
}

function validateAwsVmTargetGroup(value: unknown, index: number, groupIds: Set<string>, errors: SettingsValidationError[]) {
  const prefix = `targetPlugins.awsVm.targetGroups.${index}`
  if (!isRecord(value)) {
    errors.push({ field: prefix, message: 'target group must be an object' })
    return
  }
  rejectExtraKeys(value, awsVmTargetGroupKeys, prefix, errors)
  validateRequiredIdentity(value, prefix, 'target group', errors)
  const id = value.id
  if (typeof id === 'string') {
    if (groupIds.has(id)) errors.push({ field: `${prefix}.id`, message: 'target group id must be unique' })
    groupIds.add(id)
  }
  if (typeof value.enabled !== 'boolean') errors.push({ field: `${prefix}.enabled`, message: 'enabled must be a boolean' })
  validateOptionalStringFields(value, prefix, ['bastionHost', 'bastionUsername', 'bastionPassword', 'bastionTotpSecret', 'bastionPasswordMode', 'vmUsername', 'vmPassword', 'consulCatalogCommand'], errors)
  if (value.bastionPort !== undefined && !integerInRange(value.bastionPort, 1, 65535)) errors.push({ field: `${prefix}.bastionPort`, message: 'bastionPort must be 1..65535' })
  if (value.bastionPasswordMode !== undefined && value.bastionPasswordMode !== 'password' && value.bastionPasswordMode !== 'password-plus-totp') errors.push({ field: `${prefix}.bastionPasswordMode`, message: 'bastionPasswordMode must be password or password-plus-totp' })
  if (value.strictHostKeyChecking !== undefined && typeof value.strictHostKeyChecking !== 'boolean') errors.push({ field: `${prefix}.strictHostKeyChecking`, message: 'strictHostKeyChecking must be a boolean' })
  validateGroupUsernames(value, prefix, errors)
  validatePartialVmLogPaths(value.logPaths, errors, `${prefix}.logPaths`)
  validateAwsVmTargetModules(value.modules, prefix, errors)
}

function validateAwsVmTargetModules(value: unknown, groupPrefix: string, errors: SettingsValidationError[]) {
  if (!Array.isArray(value)) {
    errors.push({ field: `${groupPrefix}.modules`, message: 'modules must be an array' })
    return
  }
  const ids = new Set<string>()
  value.forEach((module, index) => validateAwsVmTargetModule(module, `${groupPrefix}.modules.${index}`, ids, errors))
}

function validateAwsVmTargetModule(value: unknown, prefix: string, moduleIds: Set<string>, errors: SettingsValidationError[]) {
  if (!isRecord(value)) {
    errors.push({ field: prefix, message: 'target module must be an object' })
    return
  }
  rejectExtraKeys(value, awsVmTargetModuleKeys, prefix, errors)
  validateRequiredIdentity(value, prefix, 'target module', errors)
  const id = value.id
  if (typeof id === 'string') {
    if (moduleIds.has(id)) errors.push({ field: `${prefix}.id`, message: 'target module id must be unique inside a group' })
    moduleIds.add(id)
  }
  validateOptionalStringFields(value, prefix, ['consulCatalogCommand'], errors)
  validatePartialVmLogPaths(value.logPaths, errors, `${prefix}.logPaths`)
}

function validateRequiredIdentity(value: Record<string, unknown>, prefix: string, label: string, errors: SettingsValidationError[]) {
  for (const key of ['id', 'name'] as const) {
    if (typeof value[key] !== 'string' || value[key].trim() === '') errors.push({ field: `${prefix}.${key}`, message: `${label} ${key} is required` })
  }
}

function validateOptionalStringFields(value: Record<string, unknown>, prefix: string, keys: readonly string[], errors: SettingsValidationError[]) {
  for (const key of keys) {
    const fieldValue = value[key]
    if (fieldValue !== undefined && typeof fieldValue !== 'string') errors.push({ field: `${prefix}.${key}`, message: `${key} must be a string when provided` })
    if (typeof fieldValue === 'string' && fieldValue.includes('\0')) errors.push({ field: `${prefix}.${key}`, message: `${key} cannot contain null bytes` })
  }
}

function validateGroupUsernames(value: Record<string, unknown>, prefix: string, errors: SettingsValidationError[]) {
  for (const key of ['bastionUsername', 'vmUsername'] as const) {
    const username = value[key]
    if (typeof username === 'string' && username.trim() !== '' && !isValidUsername(key, username)) errors.push({ field: `${prefix}.${key}`, message: `${key} must be a safe SSH username or email account` })
  }
}

function validateEffectiveAwsVmPlugin(plugin: AwsVmTargetPluginSettings, errors: SettingsValidationError[], prefix: string) {
  if (!plugin.enabled) return
  for (const key of requiredStringKeys) {
    if (plugin[key].trim() === '') errors.push({ field: `${prefix}.${key}`, message: `${key} is required when AWS VM plugin is enabled` })
  }
  if (plugin.bastionPasswordMode === 'password-plus-totp' && (plugin.bastionTotpSecret ?? '').trim() === '') errors.push({ field: `${prefix}.bastionTotpSecret`, message: 'bastionTotpSecret is required for password-plus-totp mode' })
  validateVmLogPaths(plugin.logPaths, errors, `${prefix}.logPaths`)
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

type EffectiveAwsVmProfile = {
  plugin: AwsVmTargetPluginSettings
  fieldPrefix: string
}

function nonEmpty(value: string | undefined) {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function mergeLogPaths(base: AwsVmTargetPluginSettings['logPaths'], overrides: Partial<AwsVmTargetPluginSettings['logPaths']> | undefined) {
  const next = { ...base }
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value !== undefined) next[key as SourceLogType] = value
  }
  return next
}

function applyGroupOverrides(base: AwsVmTargetPluginSettings, group: AwsVmTargetGroupSettings): AwsVmTargetPluginSettings {
  return {
    ...base,
    enabled: base.enabled && group.enabled,
    bastionHost: nonEmpty(group.bastionHost) ?? base.bastionHost,
    bastionPort: group.bastionPort ?? base.bastionPort,
    bastionUsername: nonEmpty(group.bastionUsername) ?? base.bastionUsername,
    bastionPassword: nonEmpty(group.bastionPassword) ?? base.bastionPassword,
    bastionTotpSecret: nonEmpty(group.bastionTotpSecret) ?? base.bastionTotpSecret,
    bastionPasswordMode: group.bastionPasswordMode ?? base.bastionPasswordMode,
    vmUsername: nonEmpty(group.vmUsername) ?? base.vmUsername,
    vmPassword: nonEmpty(group.vmPassword) ?? base.vmPassword,
    consulCatalogCommand: nonEmpty(group.consulCatalogCommand) ?? base.consulCatalogCommand,
    strictHostKeyChecking: group.strictHostKeyChecking ?? base.strictHostKeyChecking,
    logPaths: mergeLogPaths(base.logPaths, group.logPaths),
    targetGroups: [],
  }
}

function applyModuleOverrides(base: AwsVmTargetPluginSettings, module: AwsVmTargetModuleSettings): AwsVmTargetPluginSettings {
  return {
    ...base,
    consulCatalogCommand: nonEmpty(module.consulCatalogCommand) ?? base.consulCatalogCommand,
    logPaths: mergeLogPaths(base.logPaths, module.logPaths),
    targetGroups: [],
  }
}

function effectiveAwsVmPlugins(plugin: AwsVmTargetPluginSettings): EffectiveAwsVmProfile[] {
  if (plugin.targetGroups.length === 0) return [{ plugin, fieldPrefix: 'targetPlugins.awsVm' }]
  return plugin.targetGroups.flatMap((group, groupIndex) => {
    const groupPlugin = applyGroupOverrides(plugin, group)
    const groupPrefix = `targetPlugins.awsVm.targetGroups.${groupIndex}`
    if (group.modules.length === 0) return [{ plugin: groupPlugin, fieldPrefix: groupPrefix }]
    return group.modules.map((module, moduleIndex) => ({
      plugin: applyModuleOverrides(groupPlugin, module),
      fieldPrefix: `${groupPrefix}.modules.${moduleIndex}`,
    }))
  })
}

export function awsVmPluginForTarget(plugin: AwsVmTargetPluginSettings, target: VmTargetInfo): AwsVmTargetPluginSettings {
  if (!target.bastionId) return { ...plugin, targetGroups: [] }
  const group = plugin.targetGroups.find((item) => item.id === target.bastionId)
  if (!group) return { ...plugin, targetGroups: [] }
  const groupPlugin = applyGroupOverrides(plugin, group)
  if (!target.moduleId) return groupPlugin
  const module = group.modules.find((item) => item.id === target.moduleId)
  return module ? applyModuleOverrides(groupPlugin, module) : groupPlugin
}
