import {
  KLOGCAT_LOG_VIEWER_EXTENSION_PROTOCOL,
  KLOGCAT_LOG_VIEWER_EXTENSION_PROTOCOL_VERSION,
  LOG_VIEWER_CAPABILITIES,
  type KlogcatExtensionHost,
  type KlogcatExtensionModule,
  type LogViewerCapability,
  type LogViewerExtensionTrustLevel,
} from '../sdk/log-viewer'
import { registerLogViewerExtension } from './logViewerExtensions'

const knownCapabilities = new Set<LogViewerCapability>(LOG_VIEWER_CAPABILITIES)

function validateTrustLevel(trustLevel: LogViewerExtensionTrustLevel) {
  if (trustLevel !== 'trusted-bundled' && trustLevel !== 'isolated-runtime') {
    throw new Error(`Unsupported extension trust level: ${trustLevel}`)
  }
}

function validateCapabilities(capabilities: readonly LogViewerCapability[]) {
  const unknown = capabilities.find((capability) => !knownCapabilities.has(capability))
  if (unknown) throw new Error(`Unknown extension capability: ${unknown}`)
}

export function createKlogcatExtensionHost(): KlogcatExtensionHost {
  return {
    registerLogViewer: registerLogViewerExtension,
  }
}

export function activateKlogcatExtensionModule(module: KlogcatExtensionModule, host: KlogcatExtensionHost = createKlogcatExtensionHost()) {
  if (module.manifest.protocol.name !== KLOGCAT_LOG_VIEWER_EXTENSION_PROTOCOL) {
    throw new Error(`Unsupported extension protocol: ${module.manifest.protocol.name}`)
  }
  if (module.manifest.protocol.version !== KLOGCAT_LOG_VIEWER_EXTENSION_PROTOCOL_VERSION) {
    throw new Error(`Unsupported extension protocol version: ${module.manifest.protocol.version}`)
  }
  validateTrustLevel(module.manifest.trustLevel)
  validateCapabilities(module.manifest.requestedCapabilities)
  return module.activate(host)
}

export type ConfiguredKlogcatExtensionModule = {
  module: KlogcatExtensionModule
  order?: number
}

export type KlogcatExtensionActivationResult = {
  activatedIds: string[]
  errors: Array<{ id: string; message: string }>
  cleanup(): void
}

export function activateConfiguredKlogcatExtensions(configuredModules: readonly ConfiguredKlogcatExtensionModule[], host: KlogcatExtensionHost = createKlogcatExtensionHost()): KlogcatExtensionActivationResult {
  const cleanups: Array<() => void> = []
  const activatedIds: string[] = []
  const errors: Array<{ id: string; message: string }> = []
  const orderedModules = [...configuredModules].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.module.manifest.id.localeCompare(b.module.manifest.id))

  for (const configured of orderedModules) {
    const id = configured.module.manifest.id
    try {
      const cleanup = activateKlogcatExtensionModule(configured.module, host)
      if (cleanup) cleanups.push(cleanup)
      activatedIds.push(id)
    } catch (error) {
      errors.push({ id, message: error instanceof Error ? error.message : String(error) })
    }
  }

  return {
    activatedIds,
    errors,
    cleanup() {
      for (const cleanup of [...cleanups].reverse()) {
        try {
          cleanup()
        } catch (error) {
          console.error('[klogcat] Extension cleanup failed', error)
        }
      }
    },
  }
}
