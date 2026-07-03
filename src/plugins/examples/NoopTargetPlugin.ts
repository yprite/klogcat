import type { SettingsValidationError } from '../../types/settings'
import type { TargetPluginSettings } from '../../types/vm'
import type { TargetPluginDefinition } from '../pluginModel'

export type NoopTargetPluginSettings = {
  enabled: boolean
}

export const noopTargetPlugin: TargetPluginDefinition<NoopTargetPluginSettings> = {
  manifest: {
    id: 'noop-target',
    ownerId: 'klogcat.test',
    kind: 'target',
    label: 'No-op Target',
    description: 'Test fixture target plugin that performs no discovery.',
    source: 'third-party',
    order: 900,
  },
  settingsKey: 'noop',
  targetKind: 'noop',
  requiredCapabilities: ['target.discovery'],
  defaultSettings: { enabled: false },
  isEnabled(settings: TargetPluginSettings | undefined) {
    return Boolean((settings as unknown as { noop?: NoopTargetPluginSettings } | undefined)?.noop?.enabled)
  },
  validate(value: unknown, errors: SettingsValidationError[]) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push({ field: 'plugins.targets.noop', message: 'noop plugin config must be an object' })
      return
    }
    const enabled = (value as { enabled?: unknown }).enabled
    if (typeof enabled !== 'boolean') errors.push({ field: 'plugins.targets.noop.enabled', message: 'enabled must be a boolean' })
  },
}
