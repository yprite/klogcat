export type SourceLogType = 'app' | 'access' | 'error'
export type ParseStatus = 'parsed' | 'raw'
export type StreamStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error'

export type SourceMeta = {
  streamId: string
  sourceId: string
  sourceType: SourceLogType
  context?: string
  namespace: string
  pod: string
  container: string
  filePath: string
  initialTailLines?: number
}

export type ActiveStreamMeta = SourceMeta

export type ParsedLogLine = SourceMeta & {
  id: number
  raw: string
  parseStatus: ParseStatus
  timestamp?: string
  epochTime?: number
  receivedAt: number
  jsonLogType?: string
  level?: string
  isStacktrace?: boolean
  stacktraceLines?: string[]
  host?: string
  service?: string
  serviceId?: string
  module?: string
  submodule?: string
  trId?: string
  traceId?: string
  method?: string
  url?: string
  status?: string
  elapsed?: number
  length?: number
  pSpanId?: string
  spanId?: string
  srcIp?: string
  userId?: string
  appId?: string
  rcode?: string
  rmsg?: string
  exceptionName?: string
  apiName?: string
  logger?: string
  thread?: string
  errorReason?: string
  errorMethod?: string
  errorPath?: string
  errorServerName?: string
  errorTimestamp?: string
  body?: string
  message?: string
  summary: string
  diagnostics?: string[]
}

export type LogLineEvent = {
  streamId: string
  sourceType: SourceLogType
  raw: string
  receivedAt: number
}
export type LogStreamStartedEvent = { streamId: string; receivedAt: number }
export type LogStreamStderrEvent = { streamId: string; line: string; receivedAt: number }
export type LogStreamExitEvent = { streamId: string; exitCode?: number; signal?: string; requestedStop: boolean }
export type LogStreamErrorEvent = { streamId?: string; code: string; message: string; details?: string }
