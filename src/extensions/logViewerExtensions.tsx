import { useSyncExternalStore } from 'react'
import { LogViewer } from '../components/LogViewer'
import {
  LOG_VIEWER_CAPABILITIES,
  type LogViewerCapability,
  type LogViewerExtension,
  type LogViewerExtensionTrustLevel,
  type RegisteredLogViewerExtension as RegisteredLogViewerExtensionType,
  type RegisterLogViewerExtensionOptions,
} from '../sdk/log-viewer'

export type LogViewerExtensionId = string
export type { RegisteredLogViewerExtension } from '../sdk/log-viewer'

export const DEFAULT_LOG_VIEWER_EXTENSION_ID = 'raw'

const coreLogViewerExtensions: RegisteredLogViewerExtensionType[] = [
  {
    id: DEFAULT_LOG_VIEWER_EXTENSION_ID,
    ownerId: 'klogcat.core',
    label: 'Raw Logs',
    description: 'Source-of-truth log stream',
    component: LogViewer,
    requestedCapabilities: ['logs.read', 'logs.export', 'grep.write', 'viewer.control'],
    trustLevel: 'trusted-bundled',
    source: 'core',
    order: 0,
  },
]

const extensionIdPattern = /^[a-z][a-z0-9.-]*$/
const ownerIdPattern = /^[a-z][a-z0-9.-]*$/
const knownCapabilities = new Set<LogViewerCapability>(LOG_VIEWER_CAPABILITIES)
const registeredThirdPartyExtensions = new Map<LogViewerExtensionId, RegisteredLogViewerExtensionType>()
const subscribers = new Set<() => void>()
let snapshot: readonly RegisteredLogViewerExtensionType[] = freezeExtensions([...coreLogViewerExtensions])

function freezeExtensions(extensions: RegisteredLogViewerExtensionType[]) {
  return Object.freeze([...extensions].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label) || a.id.localeCompare(b.id)))
}

function rebuildSnapshot() {
  snapshot = freezeExtensions([...coreLogViewerExtensions, ...registeredThirdPartyExtensions.values()])
}

function notifySubscribers() {
  rebuildSnapshot()
  subscribers.forEach((listener) => listener())
}

function normalizeExtension(extension: LogViewerExtension): RegisteredLogViewerExtensionType {
  const id = extension.id.trim()
  const ownerId = extension.ownerId.trim()
  const label = extension.label.trim()
  const description = extension.description.trim()
  if (!extensionIdPattern.test(id)) throw new Error(`Invalid log viewer extension id: ${extension.id}`)
  if (!ownerIdPattern.test(ownerId)) throw new Error(`Invalid log viewer extension ownerId: ${extension.ownerId}`)
  if (!label) throw new Error(`Log viewer extension "${id}" must include a label`)
  if (!description) throw new Error(`Log viewer extension "${id}" must include a description`)
  validateCapabilities(id, extension.requestedCapabilities)
  return {
    id,
    ownerId,
    label,
    description,
    component: extension.component,
    requestedCapabilities: [...extension.requestedCapabilities],
    trustLevel: extension.trustLevel ?? 'trusted-bundled',
    source: 'third-party',
    order: extension.order ?? 100,
  }
}

function validateCapabilities(id: string, capabilities: readonly LogViewerCapability[]) {
  if (!capabilities.includes('logs.read')) throw new Error(`Log viewer extension "${id}" must request logs.read`)
  const unknown = capabilities.find((capability) => !knownCapabilities.has(capability))
  if (unknown) throw new Error(`Log viewer extension "${id}" requested unknown capability: ${unknown}`)
}

function isSupportedTrustLevel(value: LogViewerExtensionTrustLevel) {
  return value === 'trusted-bundled' || value === 'isolated-runtime'
}

export function registerLogViewerExtension(extension: LogViewerExtension, options: RegisterLogViewerExtensionOptions = {}) {
  const normalized = normalizeExtension(extension)
  if (!isSupportedTrustLevel(normalized.trustLevel)) throw new Error(`Unsupported log viewer extension trust level: ${normalized.trustLevel}`)
  const reservedCoreId = coreLogViewerExtensions.some((candidate) => candidate.id === normalized.id)
  if (reservedCoreId) throw new Error(`Log viewer extension id "${normalized.id}" is reserved by klogcat`)
  const existing = registeredThirdPartyExtensions.get(normalized.id)
  if (!options.replace && existing) {
    throw new Error(`Log viewer extension id "${normalized.id}" is already registered`)
  }
  if (options.replace && existing && existing.ownerId !== normalized.ownerId) {
    throw new Error(`Log viewer extension id "${normalized.id}" can only be replaced by the same ownerId`)
  }
  registeredThirdPartyExtensions.set(normalized.id, normalized)
  notifySubscribers()
  return () => {
    if (registeredThirdPartyExtensions.get(normalized.id) !== normalized) return false
    return unregisterLogViewerExtension(normalized.id)
  }
}

export function unregisterLogViewerExtension(id: LogViewerExtensionId) {
  const removed = registeredThirdPartyExtensions.delete(id)
  if (removed) notifySubscribers()
  return removed
}

export function getLogViewerExtensions() {
  return snapshot
}

export function findLogViewerExtension(id: LogViewerExtensionId, extensions: readonly RegisteredLogViewerExtensionType[] = snapshot) {
  return extensions.find((extension) => extension.id === id)
}

export function subscribeLogViewerExtensions(listener: () => void) {
  subscribers.add(listener)
  return () => subscribers.delete(listener)
}

export function useLogViewerExtensions() {
  return useSyncExternalStore(subscribeLogViewerExtensions, getLogViewerExtensions, getLogViewerExtensions)
}

export function resetLogViewerExtensionsForTests() {
  registeredThirdPartyExtensions.clear()
  notifySubscribers()
}
