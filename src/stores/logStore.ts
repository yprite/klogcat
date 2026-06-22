import { create } from 'zustand'
import type { ActiveStreamMeta, LogLineEvent, ParsedLogLine, StreamStatus } from '../types/log'
import { defaultSettings } from '../config/defaultSettings'
import { matchesGrep } from '../utils/grep'
import { parseLogLine } from '../utils/parseLogLine'
import { appendWithLimit } from '../utils/ringBuffer'
import { commandErrorMessage } from '../commands/types'

export type LogStoreState = {
  streamStatus: StreamStatus
  activeStreamId?: string
  activeStreamMeta?: ActiveStreamMeta
  viewerPaused: boolean
  autoScrollEnabled: boolean
  bufferLimit: number
  nextLineId: number
  rows: ParsedLogLine[]
  visibleRows: ParsedLogLine[]
  grepQuery: string
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
  setAutoScrollEnabled(enabled: boolean): void
  setBufferLimit(limit: number): void
  pause(): void
  resume(): void
  clear(): void
  resetForSelectionChange(): void
}

const filterRows = (rows: ParsedLogLine[], query: string) => rows.filter((r) => matchesGrep(r.raw, query))
const initial = {
  streamStatus: 'idle' as StreamStatus,
  activeStreamId: undefined,
  activeStreamMeta: undefined,
  viewerPaused: false,
  autoScrollEnabled: true,
  bufferLimit: defaultSettings.bufferLimit,
  nextLineId: 1,
  rows: [] as ParsedLogLine[],
  visibleRows: [] as ParsedLogLine[],
  grepQuery: '',
  latestStderr: undefined,
  errorMessage: undefined,
  actionDebugMessages: [] as string[],
  totalDroppedCount: 0,
  droppedWhilePaused: 0,
}

export const useLogStore = create<LogStoreState>((set, get) => ({
  ...initial,
  recordActionDebug(message) {
    const line = `${new Date().toLocaleTimeString()} ${message}`
    console.info(`[klogcat action] ${message}`)
    const messages = [...get().actionDebugMessages, line].slice(-8)
    set({ actionDebugMessages: messages })
  },
  prepareStarting(meta) { set({ activeStreamId: meta.streamId, activeStreamMeta: meta, streamStatus: 'starting', errorMessage: undefined, latestStderr: undefined }) },
  markRunning(streamId) { if (get().activeStreamId === streamId) set({ streamStatus: 'running' }) },
  markStopping(streamId) { if (get().activeStreamId === streamId) set({ streamStatus: 'stopping' }) },
  markStopped(streamId) { if (get().activeStreamId === streamId) set({ streamStatus: 'stopped', activeStreamId: undefined, activeStreamMeta: undefined }) },
  markStartRejected(streamId, error) { if (get().activeStreamId === streamId) set({ streamStatus: 'error', activeStreamId: undefined, activeStreamMeta: undefined, errorMessage: commandErrorMessage(error) }) },
  markError(streamId, message) { if (!streamId || get().activeStreamId === streamId) set({ streamStatus: 'error', errorMessage: message, activeStreamId: undefined, activeStreamMeta: undefined }) },
  appendLine(event) {
    const state = get()
    if (event.streamId !== state.activeStreamId || !state.activeStreamMeta) return
    const parsed = parseLogLine(event.raw, event.sourceType, state.activeStreamMeta, event.receivedAt)
    const row: ParsedLogLine = { ...parsed, id: state.nextLineId }
    const result = appendWithLimit(state.rows, row, state.bufferLimit)
    const visibleRows = state.viewerPaused ? state.visibleRows : filterRows(result.items, state.grepQuery)
    set({ rows: result.items, visibleRows, nextLineId: state.nextLineId + 1, totalDroppedCount: state.totalDroppedCount + result.dropped, droppedWhilePaused: state.droppedWhilePaused + (state.viewerPaused ? result.dropped : 0) })
  },
  recordStderr(streamId, line) { if (get().activeStreamId === streamId) set({ latestStderr: line }) },
  setGrepQuery(query) { const s = get(); set({ grepQuery: query, visibleRows: s.viewerPaused ? s.visibleRows : filterRows(s.rows, query) }) },
  setAutoScrollEnabled(enabled) { set({ autoScrollEnabled: enabled }) },
  setBufferLimit(limit) {
    const safe = Math.max(0, Math.floor(limit)); const s = get(); const drop = Math.max(0, s.rows.length - safe); const rows = drop ? s.rows.slice(drop) : s.rows
    set({ bufferLimit: safe, rows, visibleRows: s.viewerPaused ? s.visibleRows : filterRows(rows, s.grepQuery), totalDroppedCount: s.totalDroppedCount + drop, droppedWhilePaused: s.droppedWhilePaused + (s.viewerPaused ? drop : 0) })
  },
  pause() { set({ viewerPaused: true }) },
  resume() { const s = get(); set({ viewerPaused: false, visibleRows: filterRows(s.rows, s.grepQuery), droppedWhilePaused: 0 }) },
  clear() { set({ rows: [], visibleRows: [], totalDroppedCount: 0, droppedWhilePaused: 0 }) },
  resetForSelectionChange() { set({ rows: [], visibleRows: [], streamStatus: 'stopped', activeStreamId: undefined, activeStreamMeta: undefined, latestStderr: undefined, errorMessage: undefined }) },
}))

export function resetLogStoreForTests() { useLogStore.setState({ ...initial }) }
