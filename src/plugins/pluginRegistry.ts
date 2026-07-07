import type { RegisteredLogViewerExtension } from '../sdk/log-viewer'
import { getLogViewerExtensions } from '../extensions/logViewerExtensions'
import { targetPluginDefinitions } from './targetPluginRegistry'
import { settingsKeyForViewerExtension } from './viewerPluginRegistry'
import type { KlogcatPluginManifest, ViewerPluginDefinition } from './pluginModel'

export function viewerPluginDefinitionFromExtension(extension: RegisteredLogViewerExtension): ViewerPluginDefinition {
  const settingsKey = settingsKeyForViewerExtension(extension.id) ?? extension.id.replace(/[^a-zA-Z0-9]+(.)/g, (_, char: string) => char.toUpperCase())
  return {
    manifest: {
      id: extension.id,
      ownerId: extension.ownerId,
      kind: 'viewer',
      label: extension.label,
      description: extension.description,
      source: extension.source,
      order: extension.order,
    },
    settingsKey,
    extensionId: extension.id,
    defaultSettings: { enabled: true },
    requestedCapabilities: extension.requestedCapabilities,
    isEnabled(settings) {
      return typeof settings === 'object' && settings !== null && settingsKey in settings
        ? (settings as Record<string, { enabled?: unknown }>)[settingsKey]?.enabled !== false
        : true
    },
    validate() {
      return undefined
    },
  }
}

export function getTargetPluginManifests(): KlogcatPluginManifest[] {
  return targetPluginDefinitions.map((plugin) => plugin.manifest)
}

export function getViewerPluginDefinitions(viewers: readonly RegisteredLogViewerExtension[] = getLogViewerExtensions()) {
  return viewers.map(viewerPluginDefinitionFromExtension)
}

export function getPluginManifests(): KlogcatPluginManifest[] {
  return [
    ...getTargetPluginManifests(),
    ...getViewerPluginDefinitions().map((plugin) => plugin.manifest),
  ].sort((a, b) => a.order - b.order || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label))
}
