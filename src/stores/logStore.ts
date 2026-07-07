import { create } from 'zustand'
import type { ActiveStreamMeta, LogLineEvent, ParsedLogLine, StreamStatus } from '../types/log'
import { defaultSettings } from '../config/defaultSettings'
import { matchesGrep, type GrepMode } from '../utils/grep'
import { matchesLogQuery } from '../utils/logQuery'
import { parseLogLine } from '../utils/parseLogLine'
import { appendWithLimit } from '../utils/ringBuffer'
import { commandErrorMessage } from '../commands/types'

export type LogStoreState = {
  streamStatus: StreamStatus
  activeStreamId?: string
  activeStreamMeta?: ActiveStreamMeta
  activeStreamIds: string[]
  activeStreamMetas: Record<string, ActiveStreamMeta>
  viewerPaused: boolean
  autoScrollEnabled: boolean
  bufferLimit: number
  nextLineId: number
  rows: ParsedLogLine[]
  visibleRows: ParsedLogLine[]
  viewerFilteredRows?: ParsedLogLine[]
  viewerColumnFilters: Record<string, string>
  grepQuery: string
  grepMode: GrepMode
  latestStderr?: string
  stderrByStream: Record<string, string[]>
  errorMessage?: string
  actionDebugMessages: string[]
  totalDroppedCount: number
  droppedWhilePaused: number
  reconnectEnabled: boolean
  recordActionDebug(message: string): void
  prepareStarting(meta: ActiveStreamMeta): void
  replaceStreamForReconnect(oldStreamId: string, nextMeta: ActiveStreamMeta): void
  markRunning(streamId: string): void
  markStopping(streamId: string): void
  markStopped(streamId: string): void
  markStartRejected(streamId: string, error: unknown): void
  markError(streamId: string | undefined, message: string): void
  appendLine(event: LogLineEvent): void
  appendLines(events: LogLineEvent[]): void
  recordStderr(streamId: string, line: string): void
  setGrepQuery(query: string): void
  setGrepMode(mode: GrepMode): void
  setAutoScrollEnabled(enabled: boolean): void
  setReconnectEnabled(enabled: boolean): void
  setBufferLimit(limit: number): void
  setViewerFilteredRows(rows: ParsedLogLine[], columnFilters: Record<string, string>): void
  pause(): void
  resume(): void
  clear(): void
  resetForSelectionChange(): void
}

const filterRows = (rows: ParsedLogLine[], query: string, mode: GrepMode) => rows.filter((r) => mode === 'regex' ? matchesGrep(r.raw, query, mode) : matchesLogQuery(r, query))
const stacktraceContinuationPattern = /^(\s+at\s|Caused by:|Suppressed:|\s*\.\.\. \d+ more|\s*at\s)/
const exceptionPattern = /(?:Exception|Error|Throwable)(?::|$)/
const STACKTRACE_GROUP_ROW_HORIZON = 200
const STACKTRACE_GROUP_TIME_HORIZON_MS = 10_000
const STDERR_HISTORY_LIMIT = 20
export function isStacktraceLine(raw: string) { return stacktraceContinuationPattern.test(raw) }
export function marksStacktraceStart(raw: string) { return exceptionPattern.test(raw) }

function appendOrGroupStacktrace(rows: ParsedLogLine[], row: ParsedLogLine, limit: number) {
  if (!isStacktraceLine(row.raw)) return appendWithLimit(rows, { ...row, isStacktrace: marksStacktraceStart(row.raw) }, limit)

  const startIndex = Math.max(0, rows.length - STACKTRACE_GROUP_ROW_HORIZON)
  for (let i = rows.length - 1; i >= startIndex; i -= 1) {
    const candidate = rows[i]
    if (row.receivedAt - candidate.receivedAt > STACKTRACE_GROUP_TIME_HORIZON_MS) break
    if (candidate.streamId === row.streamId && candidate.sourceId === row.sourceId && (candidate.isStacktrace || marksStacktraceStart(candidate.raw))) {
      const grouped: ParsedLogLine = {
        ...candidate,
        raw: `${candidate.raw}\n${row.raw}`,
        summary: `${candidate.summary}\n${row.raw}`,
        isStacktrace: true,
        stacktraceLines: [...(candidate.stacktraceLines ?? []), row.raw],
      }
      return { items: [...rows.slice(0, i), grouped, ...rows.slice(i + 1)], dropped: 0 }
    }
  }

  return appendWithLimit(rows, { ...row, isStacktrace: true, stacktraceLines: [row.raw] }, limit)
}

function appendParsedEvent(
  state: LogStoreState,
  rows: ParsedLogLine[],
  event: LogLineEvent,
  nextLineId: number,
): { rows: ParsedLogLine[]; nextLineId: number; dropped: number } {
  const meta = state.activeStreamMetas[event.streamId]
  if (!meta) return { rows, nextLineId, dropped: 0 }
  const parsed = parseLogLine(event.raw, event.sourceType, meta, event.receivedAt)
  const row: ParsedLogLine = { ...parsed, id: nextLineId }
  const result = appendOrGroupStacktrace(rows, row, state.bufferLimit)
  return { rows: result.items, nextLineId: nextLineId + 1, dropped: result.dropped }
}

const initial = {
  streamStatus: 'idle' as StreamStatus,
  activeStreamId: undefined,
  activeStreamMeta: undefined,
  activeStreamIds: [] as string[],
  activeStreamMetas: {} as Record<string, ActiveStreamMeta>,
  viewerPaused: false,
  autoScrollEnabled: true,
  bufferLimit: defaultSettings.bufferLimit,
  nextLineId: 1,
  rows: [] as ParsedLogLine[],
  visibleRows: [] as ParsedLogLine[],
  viewerFilteredRows: undefined,
  viewerColumnFilters: {} as Record<string, string>,
  grepQuery: '',
  grepMode: 'substring' as GrepMode,
  latestStderr: undefined,
  stderrByStream: {} as Record<string, string[]>,
  errorMessage: undefined,
  actionDebugMessages: [] as string[],
  totalDroppedCount: 0,
  droppedWhilePaused: 0,
  reconnectEnabled: false,
}

function removeStream(state: LogStoreState, streamId: string) {
  const { [streamId]: _removed, ...activeStreamMetas } = state.activeStreamMetas
  const activeStreamIds = state.activeStreamIds.filter((id) => id !== streamId)
  return { activeStreamIds, activeStreamMetas, activeStreamId: activeStreamIds[0], activeStreamMeta: activeStreamIds[0] ? activeStreamMetas[activeStreamIds[0]] : undefined }
}

export const useLogStore = create<LogStoreState>((set, get) => ({
  ...initial,
  recordActionDebug(message) {
    const line = `${new Date().toLocaleTimeString()} ${message}`
    console.info(`[klogcat action] ${message}`)
    const messages = [...get().actionDebugMessages, line].slice(-8)
    set({ actionDebugMessages: messages })
  },
  prepareStarting(meta) {
    const s = get()
    const activeStreamIds = s.activeStreamIds.includes(meta.streamId) ? s.activeStreamIds : [...s.activeStreamIds, meta.streamId]
    const activeStreamMetas = { ...s.activeStreamMetas, [meta.streamId]: meta }
    set({ activeStreamIds, activeStreamMetas, activeStreamId: activeStreamIds[0], activeStreamMeta: activeStreamMetas[activeStreamIds[0]], streamStatus: 'starting', errorMessage: undefined, latestStderr: undefined })
  },
  replaceStreamForReconnect(oldStreamId, nextMeta) {
    const s = get()
    const { [oldStreamId]: _removed, ...remainingMetas } = s.activeStreamMetas
    const withoutOldIds = s.activeStreamIds.filter((id) => id !== oldStreamId && id !== nextMeta.streamId)
    const activeStreamIds = [...withoutOldIds, nextMeta.streamId]
    const activeStreamMetas = { ...remainingMetas, [nextMeta.streamId]: nextMeta }
    set({ activeStreamIds, activeStreamMetas, activeStreamId: activeStreamIds[0], activeStreamMeta: activeStreamMetas[activeStreamIds[0]], streamStatus: 'starting' })
  },
  markRunning(streamId) { if (get().activeStreamIds.includes(streamId)) set({ streamStatus: 'running', errorMessage: undefined }) },
  markStopping(streamId) { if (get().activeStreamIds.includes(streamId)) set({ streamStatus: 'stopping' }) },
  markStopped(streamId) {
    const s = get()
    if (!s.activeStreamIds.includes(streamId)) return
    const next = removeStream(s, streamId)
    set({ ...next, streamStatus: next.activeStreamIds.length ? 'running' : 'stopped' })
  },
  markStartRejected(streamId, error) {
    const s = get()
    if (!s.activeStreamIds.includes(streamId)) return
    const next = removeStream(s, streamId)
    set({ ...next, streamStatus: next.activeStreamIds.length ? 'running' : 'error', errorMessage: commandErrorMessage(error) })
  },
  markError(streamId, message) {
    const s = get()
    if (!streamId) { set({ streamStatus: 'error', errorMessage: message }); return }
    if (!s.activeStreamIds.includes(streamId)) return
    const next = removeStream(s, streamId)
    set({ ...next, streamStatus: next.activeStreamIds.length ? 'running' : 'error', errorMessage: message })
  },
  appendLine(event) { get().appendLines([event]) },
  appendLines(events) {
    const state = get()
    let rows = state.rows
    let nextLineId = state.nextLineId
    let dropped = 0
    for (const event of events) {
      const result = appendParsedEvent(state, rows, event, nextLineId)
      rows = result.rows
      nextLineId = result.nextLineId
      dropped += result.dropped
    }
    const visibleRows = state.viewerPaused ? state.visibleRows : filterRows(rows, state.grepQuery, state.grepMode)
    set({
      rows,
      visibleRows,
      viewerFilteredRows: undefined,
      viewerColumnFilters: {},
      nextLineId,
      totalDroppedCount: state.totalDroppedCount + dropped,
      droppedWhilePaused: state.droppedWhilePaused + (state.viewerPaused ? dropped : 0),
    })
  },
  recordStderr(streamId, line) {
    const s = get()
    if (!s.activeStreamIds.includes(streamId)) return
    const previous = s.stderrByStream[streamId] ?? []
    set({ latestStderr: line, stderrByStream: { ...s.stderrByStream, [streamId]: [...previous, line].slice(-STDERR_HISTORY_LIMIT) } })
  },
  setGrepQuery(query) { const s = get(); set({ grepQuery: query, visibleRows: s.viewerPaused ? s.visibleRows : filterRows(s.rows, query, s.grepMode), viewerFilteredRows: undefined, viewerColumnFilters: {} }) },
  setGrepMode(mode) { const s = get(); set({ grepMode: mode, visibleRows: s.viewerPaused ? s.visibleRows : filterRows(s.rows, s.grepQuery, mode), viewerFilteredRows: undefined, viewerColumnFilters: {} }) },
  setAutoScrollEnabled(enabled) { set({ autoScrollEnabled: enabled }) },
  setReconnectEnabled(enabled) { set({ reconnectEnabled: enabled }) },
  setBufferLimit(limit) {
    const safe = Math.max(0, Math.floor(limit)); const s = get(); const drop = Math.max(0, s.rows.length - safe); const rows = drop ? s.rows.slice(drop) : s.rows
    set({ bufferLimit: safe, rows, visibleRows: s.viewerPaused ? s.visibleRows : filterRows(rows, s.grepQuery, s.grepMode), viewerFilteredRows: undefined, viewerColumnFilters: {}, totalDroppedCount: s.totalDroppedCount + drop, droppedWhilePaused: s.droppedWhilePaused + (s.viewerPaused ? drop : 0) })
  },
  setViewerFilteredRows(rows, columnFilters) {
    const activeFilters = Object.fromEntries(Object.entries(columnFilters).filter(([, value]) => value.trim() !== ''))
    set({ viewerFilteredRows: Object.keys(activeFilters).length ? rows : undefined, viewerColumnFilters: activeFilters })
  },
  pause() { set({ viewerPaused: true }) },
  resume() { const s = get(); set({ viewerPaused: false, visibleRows: filterRows(s.rows, s.grepQuery, s.grepMode), viewerFilteredRows: undefined, viewerColumnFilters: {}, droppedWhilePaused: 0 }) },
  clear() { set({ rows: [], visibleRows: [], viewerFilteredRows: undefined, viewerColumnFilters: {}, totalDroppedCount: 0, droppedWhilePaused: 0 }) },
  resetForSelectionChange() { set({ rows: [], visibleRows: [], viewerFilteredRows: undefined, viewerColumnFilters: {}, streamStatus: 'stopped', activeStreamId: undefined, activeStreamMeta: undefined, activeStreamIds: [], activeStreamMetas: {}, viewerPaused: false, totalDroppedCount: 0, droppedWhilePaused: 0, latestStderr: undefined, stderrByStream: {}, errorMessage: undefined }) },
}))

export function resetLogStoreForTests() { useLogStore.setState({ ...initial }) }
