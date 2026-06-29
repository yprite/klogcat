import { describe, expect, it, vi } from 'vitest'
import {
  KLOGCAT_LOG_VIEWER_EXTENSION_PROTOCOL,
  KLOGCAT_LOG_VIEWER_EXTENSION_PROTOCOL_VERSION,
  createLogViewerExtensionHostApi,
  rowsAsJsonl,
  type LogViewerExtensionSnapshot,
} from '../sdk/log-viewer'
import type { SdkLogRow } from '../sdk/log-viewer'

const row: SdkLogRow = {
  id: 1,
  sourceId: 'src',
  sourceType: 'info',
  raw: '{"message":"hello"}',
  parseStatus: 'parsed',
  receivedAt: Date.UTC(2026, 0, 1),
  summary: 'hello',
  target: { namespace: 'ns', pod: 'pod', container: 'app' },
  correlationIds: {},
  fields: { message: 'hello' },
}

const snapshot: LogViewerExtensionSnapshot = {
  rows: [row],
  visibleRows: [row],
  totalRowCount: 1,
  visibleRowCount: 1,
  rowLimit: 50000,
  grepQuery: '',
  grepMode: 'substring',
  viewerPaused: false,
  autoScrollEnabled: true,
  streamStatus: 'running',
  selectedTargetCount: 1,
}

describe('log viewer extension protocol', () => {
  it('exposes a versioned host API with fixed calls', () => {
    const listener = vi.fn()
    const unsubscribe = vi.fn()
    const actions = {
      setGrepQuery: vi.fn(),
      setGrepMode: vi.fn(),
      pauseViewer: vi.fn(),
      resumeViewer: vi.fn(),
      clearViewer: vi.fn(),
      setAutoScrollEnabled: vi.fn(),
    }
    const sdk = createLogViewerExtensionHostApi({
      capabilities: ['logs.read', 'logs.export', 'grep.write', 'viewer.control'],
      getSnapshot: () => snapshot,
      subscribe: (callback) => {
        callback({ type: 'snapshot', reason: 'log-state', sequence: 1 })
        return unsubscribe
      },
      actions,
    })

    expect(sdk.protocol).toEqual({
      name: KLOGCAT_LOG_VIEWER_EXTENSION_PROTOCOL,
      version: KLOGCAT_LOG_VIEWER_EXTENSION_PROTOCOL_VERSION,
    })
    expect(sdk.getSnapshot()).toBe(snapshot)
    expect(sdk.subscribe(listener)).toBe(unsubscribe)
    expect(listener).toHaveBeenCalled()

    sdk.grep.setQuery('trace')
    sdk.grep.setMode('regex')
    sdk.viewer.pause()
    sdk.viewer.resume()
    sdk.viewer.clear()
    sdk.viewer.setAutoScrollEnabled(false)

    expect(actions.setGrepQuery).toHaveBeenCalledWith('trace')
    expect(actions.setGrepMode).toHaveBeenCalledWith('regex')
    expect(actions.pauseViewer).toHaveBeenCalled()
    expect(actions.resumeViewer).toHaveBeenCalled()
    expect(actions.clearViewer).toHaveBeenCalled()
    expect(actions.setAutoScrollEnabled).toHaveBeenCalledWith(false)
  })

  it('exports visible rows as JSONL by default', () => {
    const sdk = createLogViewerExtensionHostApi({
      capabilities: ['logs.read', 'logs.export'],
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      actions: {
        setGrepQuery: () => undefined,
        setGrepMode: () => undefined,
        pauseViewer: () => undefined,
        resumeViewer: () => undefined,
        clearViewer: () => undefined,
        setAutoScrollEnabled: () => undefined,
      },
    })

    expect(rowsAsJsonl([row])).toContain('"summary":"hello"')
    expect(sdk.export.rowsAsJsonl()).toBe(rowsAsJsonl(snapshot.visibleRows))
  })

  it('denies SDK calls when a capability is not granted', () => {
    const sdk = createLogViewerExtensionHostApi({
      capabilities: ['logs.read'],
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      actions: {
        setGrepQuery: () => undefined,
        setGrepMode: () => undefined,
        pauseViewer: () => undefined,
        resumeViewer: () => undefined,
        clearViewer: () => undefined,
        setAutoScrollEnabled: () => undefined,
      },
    })

    expect(sdk.getSnapshot()).toBe(snapshot)
    expect(() => sdk.export.rowsAsJsonl()).toThrow(/logs.export/)
    expect(() => sdk.grep.setQuery('trace')).toThrow(/grep.write/)
  })

  it('rejects invalid runtime grep modes from extensions', () => {
    const actions = {
      setGrepQuery: vi.fn(),
      setGrepMode: vi.fn(),
      pauseViewer: vi.fn(),
      resumeViewer: vi.fn(),
      clearViewer: vi.fn(),
      setAutoScrollEnabled: vi.fn(),
    }
    const sdk = createLogViewerExtensionHostApi({
      capabilities: ['grep.write'],
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      actions,
    })

    expect(() => sdk.grep.setMode('glob' as never)).toThrow(/Invalid grep mode/)
    expect(actions.setGrepMode).not.toHaveBeenCalled()
  })

  it('rejects invalid runtime value types from extensions', () => {
    const actions = {
      setGrepQuery: vi.fn(),
      setGrepMode: vi.fn(),
      pauseViewer: vi.fn(),
      resumeViewer: vi.fn(),
      clearViewer: vi.fn(),
      setAutoScrollEnabled: vi.fn(),
    }
    const sdk = createLogViewerExtensionHostApi({
      capabilities: ['grep.write', 'viewer.control'],
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      actions,
    })

    expect(() => sdk.grep.setQuery({ value: 'trace' } as never)).toThrow(/Invalid grep query/)
    expect(() => sdk.viewer.setAutoScrollEnabled('false' as never)).toThrow(/Invalid auto-scroll value/)
    expect(actions.setGrepQuery).not.toHaveBeenCalled()
    expect(actions.setAutoScrollEnabled).not.toHaveBeenCalled()
  })
})
