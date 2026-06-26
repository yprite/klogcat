import type { ComponentType } from 'react'

export const KLOGCAT_LOG_VIEWER_EXTENSION_PROTOCOL = 'klogcat.logViewer'
export const KLOGCAT_LOG_VIEWER_EXTENSION_PROTOCOL_VERSION = 1

export type LogViewerExtensionProtocol = {
  name: typeof KLOGCAT_LOG_VIEWER_EXTENSION_PROTOCOL
  version: typeof KLOGCAT_LOG_VIEWER_EXTENSION_PROTOCOL_VERSION
}

export type SdkLogSourceType = 'info' | 'access' | 'error'
export type SdkParseStatus = 'parsed' | 'raw'
export type SdkStreamStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error'
export type SdkGrepMode = 'substring' | 'regex'
export type SdkLogValue = string | number | boolean | null
export type SdkLogFields = Readonly<Record<string, SdkLogValue>>

export type SdkLogRow = {
  id: number
  sourceId: string
  sourceType: SdkLogSourceType
  raw: string
  parseStatus: SdkParseStatus
  receivedAt: number
  timestamp?: string
  summary: string
  target: {
    context?: string
    namespace: string
    pod: string
    container: string
  }
  correlationIds: {
    trId?: string
    traceId?: string
  }
  request?: {
    method?: string
    url?: string
    status?: string
    elapsed?: number
  }
  error?: {
    method?: string
    path?: string
    reason?: string
  }
  fields: SdkLogFields
  diagnostics?: readonly string[]
}

export type LogViewerExtensionChangeEvent = {
  type: 'snapshot'
  reason: 'log-state' | 'target-state'
  sequence: number
}

export type LogViewerExtensionSnapshot = {
  rows: readonly SdkLogRow[]
  visibleRows: readonly SdkLogRow[]
  totalRowCount: number
  visibleRowCount: number
  rowLimit: number
  grepQuery: string
  grepMode: SdkGrepMode
  viewerPaused: boolean
  autoScrollEnabled: boolean
  streamStatus: SdkStreamStatus
  selectedTargetCount: number
}

export type LogViewerCapability = 'logs.read' | 'logs.export' | 'grep.write' | 'viewer.control'

export const LOG_VIEWER_CAPABILITIES: readonly LogViewerCapability[] = [
  'logs.read',
  'logs.export',
  'grep.write',
  'viewer.control',
]

export type LogViewerExtensionHostApi = {
  protocol: LogViewerExtensionProtocol
  getSnapshot(): LogViewerExtensionSnapshot
  subscribe(listener: (event: LogViewerExtensionChangeEvent) => void): () => void
  grep: {
    setQuery(query: string): void
    setMode(mode: SdkGrepMode): void
  }
  viewer: {
    pause(): void
    resume(): void
    clear(): void
    setAutoScrollEnabled(enabled: boolean): void
  }
  export: {
    rowsAsJsonl(rows?: readonly SdkLogRow[]): string
  }
}

export type LogViewerExtensionProps = {
  sdk: LogViewerExtensionHostApi
  snapshot: LogViewerExtensionSnapshot
}

export type LogViewerExtensionTrustLevel = 'trusted-bundled' | 'isolated-runtime'

export type LogViewerExtension = {
  id: string
  ownerId: string
  label: string
  description: string
  component: ComponentType<LogViewerExtensionProps>
  requestedCapabilities: readonly LogViewerCapability[]
  trustLevel?: LogViewerExtensionTrustLevel
  order?: number
}

export type RegisteredLogViewerExtension = Required<Pick<LogViewerExtension, 'id' | 'ownerId' | 'label' | 'description' | 'component' | 'requestedCapabilities' | 'trustLevel' | 'order'>> & {
  source: 'core' | 'third-party'
}

export type RegisterLogViewerExtensionOptions = {
  replace?: boolean
}

export type KlogcatExtensionManifest = {
  id: string
  ownerId: string
  protocol: LogViewerExtensionProtocol
  label: string
  description: string
  requestedCapabilities: readonly LogViewerCapability[]
  trustLevel: LogViewerExtensionTrustLevel
}

export type KlogcatExtensionHost = {
  registerLogViewer(extension: LogViewerExtension, options?: RegisterLogViewerExtensionOptions): () => boolean
}

export type KlogcatExtensionModule = {
  manifest: KlogcatExtensionManifest
  activate(host: KlogcatExtensionHost): void | (() => void)
}

export type CreateLogViewerExtensionHostApiOptions = {
  capabilities: readonly LogViewerCapability[]
  getSnapshot(): LogViewerExtensionSnapshot
  subscribe(listener: (event: LogViewerExtensionChangeEvent) => void): () => void
  actions: {
    setGrepQuery(query: string): void
    setGrepMode(mode: SdkGrepMode): void
    pauseViewer(): void
    resumeViewer(): void
    clearViewer(): void
    setAutoScrollEnabled(enabled: boolean): void
  }
}

function assertCapability(capabilities: readonly LogViewerCapability[], capability: LogViewerCapability) {
  if (!capabilities.includes(capability)) throw new Error(`Extension capability denied: ${capability}`)
}

export function rowsAsJsonl(rows: readonly SdkLogRow[]) {
  return rows.map((row) => JSON.stringify(row)).join('\n')
}

export function createLogViewerExtensionHostApi(options: CreateLogViewerExtensionHostApiOptions): LogViewerExtensionHostApi {
  return {
    protocol: {
      name: KLOGCAT_LOG_VIEWER_EXTENSION_PROTOCOL,
      version: KLOGCAT_LOG_VIEWER_EXTENSION_PROTOCOL_VERSION,
    },
    getSnapshot: () => {
      assertCapability(options.capabilities, 'logs.read')
      return options.getSnapshot()
    },
    subscribe: (listener) => {
      assertCapability(options.capabilities, 'logs.read')
      return options.subscribe(listener)
    },
    grep: {
      setQuery: (query) => {
        assertCapability(options.capabilities, 'grep.write')
        options.actions.setGrepQuery(query)
      },
      setMode: (mode) => {
        assertCapability(options.capabilities, 'grep.write')
        options.actions.setGrepMode(mode)
      },
    },
    viewer: {
      pause: () => {
        assertCapability(options.capabilities, 'viewer.control')
        options.actions.pauseViewer()
      },
      resume: () => {
        assertCapability(options.capabilities, 'viewer.control')
        options.actions.resumeViewer()
      },
      clear: () => {
        assertCapability(options.capabilities, 'viewer.control')
        options.actions.clearViewer()
      },
      setAutoScrollEnabled: (enabled) => {
        assertCapability(options.capabilities, 'viewer.control')
        options.actions.setAutoScrollEnabled(enabled)
      },
    },
    export: {
      rowsAsJsonl: (rows) => {
        assertCapability(options.capabilities, 'logs.export')
        return rowsAsJsonl(rows ?? options.getSnapshot().visibleRows)
      },
    },
  }
}
