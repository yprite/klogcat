import { create } from 'zustand'
import type { ActiveStreamMeta, LogLineEvent, ParsedLogLine, StreamStatus } from '../types/log'
import { defaultSettings } from '../config/defaultSettings'
import { matchesGrep, type GrepMode } from '../utils/grep'
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
  grepQuery: string
  grepMode: GrepMode
  latestStderr?: string
  errorMessage?: string
  actionDebugMessages: string[]
  totalDroppedCount: number
  droppedWhilePaused: number
  recordActionDebug(message: string): void
  prepareStarting(meta: ActiveStreamMeta): void
  markRunning(streamId: string): void
  markStopping(streamId: string): void
  markStopped(streamId: string): void
  markStartRejected(streamId: string, error: unknown): void
  markError(streamId: string | undefined, message: string): void
  appendLine(event: LogLineEvent): void
  recordStderr(streamId: string, line: string): void
  setGrepQuery(query: string): void
  setGrepMode(mode: GrepMode): void
  setAutoScrollEnabled(enabled: boolean): void
  setBufferLimit(limit: number): void
  pause(): void
  resume(): void
  clear(): void
  resetForSelectionChange(): void
}

const filterRows = (rows: ParsedLogLine[], query: string, mode: GrepMode) => rows.filter((r) => matchesGrep(r.raw, query, mode))
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
  grepQuery: '',
  grepMode: 'substring' as GrepMode,
  latestStderr: undefined,
  errorMessage: undefined,
  actionDebugMessages: [] as string[],
  totalDroppedCount: 0,
  droppedWhilePaused: 0,
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
  markRunning(streamId) { if (get().activeStreamIds.includes(streamId)) set({ streamStatus: 'running' }) },
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
  appendLine(event) {
    const state = get()
    const meta = state.activeStreamMetas[event.streamId]
    if (!meta) return
    const parsed = parseLogLine(event.raw, event.sourceType, meta, event.receivedAt)
    const row: ParsedLogLine = { ...parsed, id: state.nextLineId }
    const result = appendWithLimit(state.rows, row, state.bufferLimit)
    const visibleRows = state.viewerPaused ? state.visibleRows : filterRows(result.items, state.grepQuery, state.grepMode)
    set({ rows: result.items, visibleRows, nextLineId: state.nextLineId + 1, totalDroppedCount: state.totalDroppedCount + result.dropped, droppedWhilePaused: state.droppedWhilePaused + (state.viewerPaused ? result.dropped : 0) })
  },
  recordStderr(streamId, line) { if (get().activeStreamIds.includes(streamId)) set({ latestStderr: line }) },
  setGrepQuery(query) { const s = get(); set({ grepQuery: query, visibleRows: s.viewerPaused ? s.visibleRows : filterRows(s.rows, query, s.grepMode) }) },
  setGrepMode(mode) { const s = get(); set({ grepMode: mode, visibleRows: s.viewerPaused ? s.visibleRows : filterRows(s.rows, s.grepQuery, mode) }) },
  setAutoScrollEnabled(enabled) { set({ autoScrollEnabled: enabled }) },
  setBufferLimit(limit) {
    const safe = Math.max(0, Math.floor(limit)); const s = get(); const drop = Math.max(0, s.rows.length - safe); const rows = drop ? s.rows.slice(drop) : s.rows
    set({ bufferLimit: safe, rows, visibleRows: s.viewerPaused ? s.visibleRows : filterRows(rows, s.grepQuery, s.grepMode), totalDroppedCount: s.totalDroppedCount + drop, droppedWhilePaused: s.droppedWhilePaused + (s.viewerPaused ? drop : 0) })
  },
  pause() { set({ viewerPaused: true }) },
  resume() { const s = get(); set({ viewerPaused: false, visibleRows: filterRows(s.rows, s.grepQuery, s.grepMode), droppedWhilePaused: 0 }) },
  clear() { set({ rows: [], visibleRows: [], totalDroppedCount: 0, droppedWhilePaused: 0 }) },
  resetForSelectionChange() { set({ rows: [], visibleRows: [], streamStatus: 'stopped', activeStreamId: undefined, activeStreamMeta: undefined, activeStreamIds: [], activeStreamMetas: {}, latestStderr: undefined, errorMessage: undefined }) },
}))

export function resetLogStoreForTests() { useLogStore.setState({ ...initial }) }
