import type { RegisteredLogViewerExtension } from '../sdk/log-viewer'
import { getLogViewerExtensions } from '../extensions/logViewerExtensions'
import { targetPluginDefinitions } from './targetPluginRegistry'
import type { KlogcatPluginManifest, ViewerPluginDefinition } from './pluginModel'

export function viewerPluginDefinitionFromExtension(extension: RegisteredLogViewerExtension): ViewerPluginDefinition {
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
    extensionId: extension.id,
    requestedCapabilities: extension.requestedCapabilities,
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
