import type { SettingsValidationError } from '../types/settings'
import type { ViewerPluginDefinition } from './pluginModel'

export const RAW_LOG_VIEWER_EXTENSION_ID = 'raw'
export const API_FLOW_GRAPH_VIEWER_SETTINGS_KEY = 'apiFlowGraph'

export type ViewerPluginEnabledSettings = {
  enabled: boolean
}

export type ViewerPluginSettings = {
  raw: ViewerPluginEnabledSettings
  apiFlowGraph: ViewerPluginEnabledSettings
}

export const defaultViewerPluginSettings: ViewerPluginSettings = {
  raw: { enabled: true },
  apiFlowGraph: { enabled: true },
}

const viewerPluginSettingKeys = ['enabled'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejectExtraKeys(value: Record<string, unknown>, allowed: readonly string[], prefix: string, errors: SettingsValidationError[]) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push({ field: `${prefix}.${key}`, message: `Unknown key: ${key}` })
  }
}

function validateViewerPluginEnabledSettings(value: unknown, errors: SettingsValidationError[], prefix: string, options: { requiredEnabled?: true } = {}) {
  if (!isRecord(value)) {
    errors.push({ field: prefix, message: 'viewer plugin config must be an object' })
    return
  }
  rejectExtraKeys(value, viewerPluginSettingKeys, prefix, errors)
  if (typeof value.enabled !== 'boolean') errors.push({ field: `${prefix}.enabled`, message: 'enabled must be a boolean' })
  if (options.requiredEnabled && value.enabled === false) errors.push({ field: `${prefix}.enabled`, message: 'Raw Logs viewer cannot be disabled' })
}

export const viewerPluginDefinitions: readonly ViewerPluginDefinition[] = Object.freeze([
  {
    manifest: {
      id: RAW_LOG_VIEWER_EXTENSION_ID,
      ownerId: 'klogcat.core',
      kind: 'viewer',
      label: 'Raw Logs',
      description: 'Source-of-truth log stream',
      source: 'core',
      order: 0,
    },
    settingsKey: 'raw',
    extensionId: RAW_LOG_VIEWER_EXTENSION_ID,
    defaultSettings: defaultViewerPluginSettings.raw,
    requestedCapabilities: ['logs.read', 'logs.export', 'grep.write', 'viewer.control'],
    isEnabled() {
      return true
    },
    validate(value, errors) {
      validateViewerPluginEnabledSettings(value, errors, 'plugins.viewers.raw', { requiredEnabled: true })
    },
  },
  {
    manifest: {
      id: 'klogcat.api-flow-graph',
      ownerId: 'klogcat.bundled',
      kind: 'viewer',
      label: 'Graph Viewer',
      description: 'Visualize trID based API and backend module flow',
      source: 'core',
      order: 20,
    },
    settingsKey: API_FLOW_GRAPH_VIEWER_SETTINGS_KEY,
    extensionId: 'klogcat.api-flow-graph',
    defaultSettings: defaultViewerPluginSettings.apiFlowGraph,
    requestedCapabilities: ['logs.read', 'logs.export'],
    isEnabled(settings) {
      return isRecord(settings) && isRecord(settings.apiFlowGraph) ? settings.apiFlowGraph.enabled === true : true
    },
    validate(value, errors) {
      validateViewerPluginEnabledSettings(value, errors, 'plugins.viewers.apiFlowGraph')
    },
  },
])

export function validateViewerPluginSettings(value: unknown, errors: SettingsValidationError[]) {
  if (!isRecord(value)) {
    errors.push({ field: 'plugins.viewers', message: 'plugins.viewers must be an object' })
    return
  }
  rejectExtraKeys(value, viewerPluginDefinitions.map((plugin) => plugin.settingsKey), 'plugins.viewers', errors)
  for (const plugin of viewerPluginDefinitions) plugin.validate(value[plugin.settingsKey], errors)
}

export function isViewerPluginEnabled(settings: ViewerPluginSettings | undefined, settingsKey: string) {
  return viewerPluginDefinitions.find((plugin) => plugin.settingsKey === settingsKey)?.isEnabled(settings) ?? true
}

export function settingsKeyForViewerExtension(extensionId: string) {
  return viewerPluginDefinitions.find((plugin) => plugin.extensionId === extensionId)?.settingsKey
}
