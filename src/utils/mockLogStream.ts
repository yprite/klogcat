import type { LogLineEvent, LogLinesEvent, SourceLogType } from '../types/log'

export type MockLogStreamOptions = {
  streamId: string
  sourceType?: SourceLogType
  count: number
  seed?: number
  startReceivedAt?: number
  intervalMs?: number
}

const methods = ['GET', 'POST', 'PUT', 'DELETE'] as const
const urls = ['/api/users', '/api/orders', '/api/payments', '/health', '/api/search'] as const
const levels = ['INFO', 'WARN', 'ERROR', 'DEBUG'] as const
const statusCodes = [200, 201, 204, 400, 404, 500, 503] as const

function createSeededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function pick<T>(items: readonly T[], random: () => number) {
  return items[Math.floor(random() * items.length)]
}

function pad(n: number, width = 2) {
  return String(n).padStart(width, '0')
}

function timestampFor(receivedAt: number) {
  const date = new Date(receivedAt)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(date.getUTCMilliseconds(), 3)}Z`
}

function mockAccessPayload(index: number, random: () => number, receivedAt: number) {
  const status = pick(statusCodes, random)
  const method = pick(methods, random)
  const url = `${pick(urls, random)}/${index}`
  return {
    time: timestampFor(receivedAt),
    epochTime: receivedAt,
    logType: 'ACC',
    level: status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO',
    host: 'mock-host',
    service: 'klogcat-mock',
    module: 'mock-stream',
    serviceId: `svc-${index % 3}`,
    trId: `mock-tr-${Math.floor(index / 2)}`,
    method,
    url,
    status,
    elapsed: Math.floor(20 + random() * 1500),
    length: Math.floor(120 + random() * 4096),
    srcIp: `10.0.${index % 8}.${10 + (index % 200)}`,
    body: { rcode: status >= 400 ? `E${status}` : 'OK', rmsg: status >= 400 ? 'mock failure' : 'mock success', api_name: url },
  }
}

function mockInfoPayload(index: number, random: () => number, receivedAt: number) {
  const level = pick(levels, random)
  return {
    time: timestampFor(receivedAt),
    epochTime: receivedAt,
    logType: 'INFO',
    level,
    host: 'mock-host',
    service: 'klogcat-mock',
    module: 'mock-stream',
    trId: `mock-tr-${Math.floor(index / 2)}`,
    message: `${level} mock stream line ${index}`,
    body: { sequence: index, randomBucket: Math.floor(random() * 1000) },
  }
}

function mockErrorPayload(index: number, random: () => number, receivedAt: number) {
  const path = `${pick(urls, random)}/${index}`
  return {
    time: timestampFor(receivedAt),
    epochTime: receivedAt,
    logType: 'ERR',
    level: 'ERROR',
    host: 'mock-host',
    service: 'klogcat-mock',
    module: 'mock-stream',
    submodule: 'mock-error',
    trId: `mock-tr-${Math.floor(index / 2)}`,
    logger: 'mock.logger.Stream',
    thread: `mock-thread-${index % 4}`,
    body: {
      errorDetails: {
        serverName: 'mock-server',
        method: pick(methods, random),
        path,
        timestamp: timestampFor(receivedAt),
        traceId: `mock-trace-${index}`,
        errors: [{ reason: `random mock error ${Math.floor(random() * 100)}` }],
      },
    },
  }
}

export function mockRawLogLine(sourceType: SourceLogType, index: number, random: () => number, receivedAt: number) {
  const payload = sourceType === 'error'
    ? mockErrorPayload(index, random, receivedAt)
    : sourceType === 'access'
      ? mockAccessPayload(index, random, receivedAt)
      : mockInfoPayload(index, random, receivedAt)
  return JSON.stringify(payload)
}

export function generateMockLogStreamEvents(options: MockLogStreamOptions): LogLineEvent[] {
  const random = createSeededRandom(options.seed ?? 1)
  const sourceType = options.sourceType ?? 'info'
  const startReceivedAt = options.startReceivedAt ?? Date.UTC(2026, 0, 1)
  const intervalMs = options.intervalMs ?? 37
  return Array.from({ length: options.count }, (_, index) => {
    const receivedAt = startReceivedAt + index * intervalMs + Math.floor(random() * intervalMs)
    return {
      streamId: options.streamId,
      sourceType,
      raw: mockRawLogLine(sourceType, index, random, receivedAt),
      receivedAt,
    }
  })
}

export function generateMockLogStreamBatch(options: MockLogStreamOptions): LogLinesEvent {
  const lines = generateMockLogStreamEvents(options)
  return {
    lines,
    emittedAt: lines.at(-1)?.receivedAt ?? options.startReceivedAt ?? Date.UTC(2026, 0, 1),
  }
}
