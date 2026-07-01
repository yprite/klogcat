import type { SettingsValidationError } from '../types/settings'
import type { SourceLogType } from '../types/log'
import type { TargetPluginSettings } from '../types/vm'

export type KlogcatPluginKind = 'target' | 'viewer'
export type KlogcatPluginSource = 'core' | 'third-party'
export type TargetPluginRuntimeCapability = 'target.discovery' | 'process.spawn' | 'network.ssh'

export const TARGET_PLUGIN_RUNTIME_CAPABILITIES: readonly TargetPluginRuntimeCapability[] = [
  'target.discovery',
  'process.spawn',
  'network.ssh',
]

export type KlogcatPluginManifest = {
  id: string
  ownerId: string
  kind: KlogcatPluginKind
  label: string
  description: string
  source: KlogcatPluginSource
  order: number
}

export type TargetPluginDefinition<TSettings = unknown> = {
  manifest: KlogcatPluginManifest & { kind: 'target' }
  settingsKey: string
  targetKind: string
  requiredCapabilities: readonly TargetPluginRuntimeCapability[]
  defaultSettings: TSettings
  isEnabled(settings: TargetPluginSettings | undefined): boolean
  validate(value: unknown, errors: SettingsValidationError[], sourceTypes?: SourceLogType[]): void
}

export type ViewerPluginDefinition = {
  manifest: KlogcatPluginManifest & { kind: 'viewer' }
  extensionId: string
  requestedCapabilities: readonly string[]
}
