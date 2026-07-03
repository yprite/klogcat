import type { SettingsValidationError } from '../types/settings'
import type { TargetPluginSettings } from '../types/vm'
import { awsVmTargetPlugin } from './awsVmTargetPlugin'
import { csvFileTargetPlugin } from './csvFileTargetPlugin'
import { TARGET_PLUGIN_RUNTIME_CAPABILITIES, type TargetPluginDefinition } from './pluginModel'

export const targetPluginDefinitions = Object.freeze([
  awsVmTargetPlugin,
  csvFileTargetPlugin,
])
const knownTargetCapabilities = new Set(TARGET_PLUGIN_RUNTIME_CAPABILITIES)

export function validateTargetPluginDefinitionCapabilities(plugin: Pick<TargetPluginDefinition, 'manifest' | 'requiredCapabilities'>) {
  const unknown = plugin.requiredCapabilities.find((capability) => !knownTargetCapabilities.has(capability))
  if (unknown) throw new Error(`Target plugin "${plugin.manifest.id}" requested unknown capability: ${unknown}`)
}

for (const plugin of targetPluginDefinitions) validateTargetPluginDefinitionCapabilities(plugin)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejectExtraKeys(value: Record<string, unknown>, allowed: readonly string[], prefix: string, errors: SettingsValidationError[]) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push({ field: `${prefix}.${key}`, message: `Unknown key: ${key}` })
  }
}

export function validateTargetPluginSettings(value: unknown, errors: SettingsValidationError[]) {
  if (!isRecord(value)) {
    errors.push({ field: 'plugins.targets', message: 'plugins.targets must be an object' })
    return
  }
  rejectExtraKeys(value, targetPluginDefinitions.map((plugin) => plugin.settingsKey), 'plugins.targets', errors)
  for (const plugin of targetPluginDefinitions) plugin.validate(value[plugin.settingsKey], errors)
}

export function getEnabledTargetPluginDefinitions(settings: TargetPluginSettings | undefined) {
  return targetPluginDefinitions.filter((plugin) => plugin.isEnabled(settings))
}

export function isTargetPluginEnabled(settings: TargetPluginSettings | undefined, settingsKey: string) {
  return targetPluginDefinitions.find((plugin) => plugin.settingsKey === settingsKey)?.isEnabled(settings) ?? false
}

export function createTargetPluginRegistry(definitions: readonly TargetPluginDefinition[]) {
  for (const plugin of definitions) validateTargetPluginDefinitionCapabilities(plugin)
  return Object.freeze([...definitions])
}
