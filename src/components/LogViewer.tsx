import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useLogStore } from '../stores/logStore'
import { useKubeStore } from '../stores/kubeStore'
import { useSettingsStore } from '../stores/settingsStore'
import { t } from '../utils/i18n'
import { defaultVisibleColumnsForPolicy, getLogPolicy } from '../utils/logPolicy'
import { columnsForRows, labelForColumn, type LogColumnKey, valueForColumn } from '../utils/logColumns'
import { LogRow } from './LogRow'
import type { ParsedLogLine } from '../types/log'

export type LogColumnWidths = Partial<Record<LogColumnKey, number>>

export const LOG_VIEWER_COLUMN_SETTINGS_STORAGE_KEY = 'klogcat:log-viewer-columns:v1'

type LogViewerColumnSettings = {
  version: 1
  columnOrder: LogColumnKey[]
  visibleColumns: LogColumnKey[]
}

const minColumnWidthCh = 12
const valuePaddingCh = 2

export function defaultVisibleColumnsFor(availableColumns: readonly LogColumnKey[]) {
  return defaultVisibleColumnsForPolicy(getLogPolicy(), availableColumns)
}

export function nextVisibleColumnsForToggle(current: LogColumnKey[], availableColumns: LogColumnKey[], key: LogColumnKey, checked: boolean) {
  if (!checked) return current.filter((column) => column !== key)
  const next = new Set([...current, key])
  return availableColumns.filter((column) => next.has(column))
}

export function moveColumnInOrder(columns: LogColumnKey[], key: LogColumnKey, direction: 'left' | 'right') {
  const index = columns.indexOf(key)
  if (index === -1) return columns
  const nextIndex = direction === 'left' ? index - 1 : index + 1
  if (nextIndex < 0 || nextIndex >= columns.length) return columns
  const next = [...columns]
  const [column] = next.splice(index, 1)
  next.splice(nextIndex, 0, column)
  return next
}

export function reorderColumnByDrop(columns: LogColumnKey[], draggedKey: LogColumnKey | null, targetKey: LogColumnKey) {
  if (!draggedKey || draggedKey === targetKey) return columns
  if (!columns.includes(draggedKey) || !columns.includes(targetKey)) return columns
  const withoutDragged = columns.filter((column) => column !== draggedKey)
  const targetIndex = withoutDragged.indexOf(targetKey)
  return [...withoutDragged.slice(0, targetIndex), draggedKey, ...withoutDragged.slice(targetIndex)]
}

function visibleColumnsFromOrder(order: LogColumnKey[], visibleColumns: LogColumnKey[]) {
  const visible = new Set(visibleColumns)
  return order.filter((column) => visible.has(column))
}

function isLogColumnSettings(value: unknown): value is LogViewerColumnSettings {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LogViewerColumnSettings>
  return candidate.version === 1 && Array.isArray(candidate.columnOrder) && Array.isArray(candidate.visibleColumns)
}

export function mergeColumnSettingsWithAvailable(settings: LogViewerColumnSettings, availableColumns: readonly LogColumnKey[]) {
  const available = new Set(availableColumns)
  const savedOrder = settings.columnOrder.filter((key, index, order): key is LogColumnKey => available.has(key as LogColumnKey) && order.indexOf(key) === index)
  const addedColumns = availableColumns.filter((key) => !savedOrder.includes(key))
  const columnOrder = [...savedOrder, ...addedColumns]
  const orderSet = new Set(columnOrder)
  const visibleColumns = settings.visibleColumns.filter((key, index, visible): key is LogColumnKey => orderSet.has(key as LogColumnKey) && visible.indexOf(key) === index)
  return { columnOrder, visibleColumns }
}

export function readLogViewerColumnSettings(storage: Pick<Storage, 'getItem'> = window.localStorage) {
  try {
    const raw = storage.getItem(LOG_VIEWER_COLUMN_SETTINGS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return isLogColumnSettings(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeLogViewerColumnSettings(settings: LogViewerColumnSettings, storage: Pick<Storage, 'setItem'> = window.localStorage) {
  try {
    storage.setItem(LOG_VIEWER_COLUMN_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Ignore storage failures so the log viewer remains usable in restricted WebViews.
  }
}

export function forceScrollToBottom(element: HTMLElement | null) {
  if (!element) return
  element.scrollTop = element.scrollHeight
}

export function measureLogRowElement(element: Element) {
  return element.getBoundingClientRect().height
}

export function textWidthCh(value: string) {
  return Array.from(value).length
}

export function columnWidthChForRows(rows: ParsedLogLine[], key: LogColumnKey) {
  const labelWidth = textWidthCh(labelForColumn(key))
  const valueWidth = rows.reduce((max, row) => Math.max(max, textWidthCh(valueForColumn(row, key) || '-')), 0)
  return Math.max(minColumnWidthCh, labelWidth, valueWidth) + valuePaddingCh
}

export function columnWidthsForRows(rows: ParsedLogLine[], columns: LogColumnKey[]): LogColumnWidths {
  return Object.fromEntries(columns.map((key) => [key, columnWidthChForRows(rows, key)])) as LogColumnWidths
}

export function exportRowsAsJsonl(rows: ParsedLogLine[]) {
  return rows.map((row) => JSON.stringify(row)).join('\n')
}

export function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/jsonl;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

async function copyText(text: string) {
  await navigator.clipboard?.writeText(text)
}

export function LogViewer() {
  const language = useSettingsStore((s) => s.settings?.language)
  const { rows, visibleRows, grepQuery, grepMode, autoScrollEnabled, viewerPaused, streamStatus } = useLogStore()
  const kube = useKubeStore()
  const selectedTargetCount = kube.getSelectedPodTargets().length
  const parentRef = useRef<HTMLDivElement>(null)
  const seenRowIdsRef = useRef<Set<number> | null>(null)
  const highlightTimeoutsRef = useRef<number[]>([])
  const availableColumns = useMemo(() => columnsForRows(visibleRows), [visibleRows])
  const [columnOrder, setColumnOrder] = useState<LogColumnKey[]>([])
  const [visibleColumns, setVisibleColumns] = useState<LogColumnKey[]>([])
  const [columnFilters, setColumnFilters] = useState<Partial<Record<LogColumnKey, string>>>({})
  const [draggedColumn, setDraggedColumn] = useState<LogColumnKey | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<LogColumnKey | null>(null)
  const [columnManagerOpen, setColumnManagerOpen] = useState(false)
  const columnsInitializedRef = useRef(false)
  const userCustomizedColumnsRef = useRef(false)
  const savedColumnSettingsRef = useRef<LogViewerColumnSettings | null | undefined>(undefined)
  const skipNextColumnPersistRef = useRef(false)
  const [highlightedRowIds, setHighlightedRowIds] = useState<Set<number>>(() => new Set())
  const [selectedRowId, setSelectedRowId] = useState<number | null>(null)
  const openTargetPicker = () => window.dispatchEvent(new Event('klogcat:open-target-picker'))
  useEffect(() => {
    if (availableColumns.length === 0 && !columnsInitializedRef.current) return
    if (savedColumnSettingsRef.current === undefined) savedColumnSettingsRef.current = readLogViewerColumnSettings()
    const savedSettings = savedColumnSettingsRef.current
    setColumnOrder((current) => {
      if (!columnsInitializedRef.current && savedSettings) return mergeColumnSettingsWithAvailable(savedSettings, availableColumns).columnOrder
      const available = new Set(availableColumns)
      const kept = current.filter((key) => available.has(key))
      const added = availableColumns.filter((key) => !current.includes(key))
      return [...kept, ...added]
    })
    setVisibleColumns((current) => {
      const available = new Set(availableColumns)
      const kept = current.filter((key) => available.has(key))
      if (!columnsInitializedRef.current) {
        columnsInitializedRef.current = true
        if (savedSettings) {
          userCustomizedColumnsRef.current = true
          skipNextColumnPersistRef.current = true
          return mergeColumnSettingsWithAvailable(savedSettings, availableColumns).visibleColumns
        }
        return defaultVisibleColumnsFor(availableColumns)
      }
      if (!userCustomizedColumnsRef.current) return defaultVisibleColumnsFor(availableColumns)
      return kept
    })
    setColumnFilters((current) => Object.fromEntries(Object.entries(current).filter(([key]) => availableColumns.includes(key as LogColumnKey))) as Partial<Record<LogColumnKey, string>>)
  }, [availableColumns])
  useEffect(() => {
    if (!columnsInitializedRef.current || !userCustomizedColumnsRef.current || availableColumns.length === 0) return
    if (skipNextColumnPersistRef.current) {
      skipNextColumnPersistRef.current = false
      return
    }
    writeLogViewerColumnSettings({ version: 1, columnOrder, visibleColumns })
  }, [availableColumns.length, columnOrder, visibleColumns])
  const filteredRows = useMemo(() => {
    const visible = new Set(visibleColumns)
    const activeFilters = Object.entries(columnFilters).filter(([key, value]) => visible.has(key as LogColumnKey) && value.trim() !== '') as Array<[LogColumnKey, string]>
    if (activeFilters.length === 0) return visibleRows
    return visibleRows.filter((row) => activeFilters.every(([key, filter]) => valueForColumn(row, key).toLowerCase().includes(filter.trim().toLowerCase())))
  }, [columnFilters, visibleColumns, visibleRows])
  const emptyState = useMemo(() => {
    if (rows.length === 0 && selectedTargetCount === 0) return { title: t(language, 'No log target selected'), detail: t(language, 'Use Choose Target to choose a running pod, then start a stream.') }
    if (rows.length === 0) return { title: t(language, 'Ready to stream logs'), detail: t(language, 'Targets selected: {count}. Press Start to begin tailing logs.', { count: selectedTargetCount }) }
    if (visibleRows.length === 0 || filteredRows.length === 0) return { title: t(language, 'No rows match current filters'), detail: t(language, 'Adjust Query or column filters to bring rows back into view.') }
    return undefined
  }, [filteredRows.length, rows.length, selectedTargetCount, visibleRows.length, language])
  const selectedRow = filteredRows.find((row) => row.id === selectedRowId)
  const columnWidths = useMemo(() => columnWidthsForRows(filteredRows, columnOrder), [columnOrder, filteredRows])
  const virtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    measureElement: measureLogRowElement,
    overscan: 10,
  })
  useEffect(() => {
    const currentIds = new Set(rows.map((row) => row.id))
    const seenRowIds = seenRowIdsRef.current
    if (!seenRowIds) {
      seenRowIdsRef.current = currentIds
      return
    }
    const newIds = rows.map((row) => row.id).filter((id) => !seenRowIds.has(id))
    seenRowIdsRef.current = currentIds
    if (newIds.length === 0) return
    setHighlightedRowIds((current) => new Set([...current, ...newIds]))
    const timeout = window.setTimeout(() => {
      setHighlightedRowIds((current) => {
        const next = new Set(current)
        newIds.forEach((id) => next.delete(id))
        return next
      })
      highlightTimeoutsRef.current = highlightTimeoutsRef.current.filter((id) => id !== timeout)
    }, 1800)
    highlightTimeoutsRef.current.push(timeout)
  }, [rows])
  useEffect(() => () => {
    highlightTimeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout))
    highlightTimeoutsRef.current = []
  }, [])
  useEffect(() => {
    if (!autoScrollEnabled || viewerPaused || filteredRows.length === 0) return
    virtualizer.scrollToIndex(filteredRows.length - 1, { align: 'end' })
    requestAnimationFrame(() => forceScrollToBottom(parentRef.current))
  }, [filteredRows.length, autoScrollEnabled, viewerPaused, virtualizer])
  const headerColumns = useMemo(() => visibleColumnsFromOrder(columnOrder, visibleColumns), [columnOrder, visibleColumns])
  const hiddenColumnCount = Math.max(0, availableColumns.length - headerColumns.length)
  const showDefaultColumns = () => {
    userCustomizedColumnsRef.current = true
    setVisibleColumns(defaultVisibleColumnsFor(columnOrder))
  }
  const showAllColumns = () => {
    userCustomizedColumnsRef.current = true
    setVisibleColumns([...columnOrder])
  }
  const clearColumns = () => {
    userCustomizedColumnsRef.current = true
    setVisibleColumns([])
  }
  const toggleColumn = (key: LogColumnKey, checked: boolean) => {
    userCustomizedColumnsRef.current = true
    setVisibleColumns((current) => nextVisibleColumnsForToggle(current, columnOrder, key, checked))
  }
  const setColumnFilter = (key: LogColumnKey, value: string) => setColumnFilters((current) => ({ ...current, [key]: value }))
  const moveColumn = (key: LogColumnKey, direction: 'left' | 'right') => {
    userCustomizedColumnsRef.current = true
    setColumnOrder((current) => {
      const nextOrder = moveColumnInOrder(current, key, direction)
      setVisibleColumns((visible) => visibleColumnsFromOrder(nextOrder, visible))
      return nextOrder
    })
  }
  const dropColumnOn = (targetKey: LogColumnKey) => {
    userCustomizedColumnsRef.current = true
    setColumnOrder((current) => {
      const nextOrder = reorderColumnByDrop(current, draggedColumn, targetKey)
      setVisibleColumns((visible) => visibleColumnsFromOrder(nextOrder, visible))
      return nextOrder
    })
    setDraggedColumn(null)
    setDragOverColumn(null)
  }
  const startColumnDrag = (key: LogColumnKey, event: DragEvent<HTMLElement>) => {
    setDraggedColumn(key)
    const dataTransfer = event.dataTransfer as DataTransfer | undefined
    if (dataTransfer) {
      dataTransfer.effectAllowed = 'move'
      dataTransfer.setData('text/plain', key)
    }
  }
  const allowColumnDrop = (key: LogColumnKey, event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    const dataTransfer = event.dataTransfer as DataTransfer | undefined
    if (dataTransfer) dataTransfer.dropEffect = 'move'
    setDragOverColumn(key)
  }
  const headerHeight = availableColumns.length ? 72 : 0
  return <>
  {availableColumns.length > 0 && <div className="relative flex shrink-0 flex-wrap items-center gap-2 border border-slate-800 bg-slate-900 px-2 py-1 text-xs">
    <span className="font-semibold uppercase text-slate-300">{t(language, 'Columns')}</span>
    <span className="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-yellow-200">{headerColumns.length}/{availableColumns.length} {t(language, 'shown')}</span>
    {hiddenColumnCount > 0 && <span className="text-slate-400">{hiddenColumnCount} {t(language, 'hidden')}</span>}
    <button type="button" onClick={showDefaultColumns} className="rounded border border-slate-700 px-2 py-0.5 text-slate-200 hover:bg-slate-800">{t(language, 'Essentials')}</button>
    <button type="button" onClick={showAllColumns} className="rounded border border-slate-700 px-2 py-0.5 text-slate-200 hover:bg-slate-800">{t(language, 'All')}</button>
    <button type="button" onClick={clearColumns} className="rounded border border-slate-700 px-2 py-0.5 text-slate-200 hover:bg-slate-800">{t(language, 'None')}</button>
    <button type="button" aria-expanded={columnManagerOpen} aria-controls="column-manager" onClick={() => setColumnManagerOpen((open) => !open)} className="rounded border border-yellow-500/70 bg-yellow-300 px-2 py-0.5 font-semibold text-black">{t(language, 'Manage columns')}</button>
    {columnManagerOpen && <div id="column-manager" role="group" aria-label={t(language, 'Column visibility')} className="absolute left-2 top-full z-30 mt-1 grid max-h-80 w-[min(56rem,calc(100vw-2rem))] grid-cols-2 gap-2 overflow-auto rounded border border-slate-700 bg-slate-950 p-3 shadow-2xl md:grid-cols-3 lg:grid-cols-4">
      {columnOrder.map((key) => {
        const label = labelForColumn(key)
        const checked = visibleColumns.includes(key)
        return <label key={key} className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-[11px] ${checked ? 'border-yellow-500/60 bg-slate-900 text-white' : 'border-slate-800 bg-slate-950 text-slate-500'}`}>
          <span className="truncate font-mono" title={label}>{label}</span>
          <input type="checkbox" aria-label={`${t(language, 'Show')} ${label}`} checked={checked} onChange={(e) => toggleColumn(key, e.target.checked)} />
        </label>
      })}
    </div>}
  </div>}
  <div ref={parentRef} data-testid="log-scroll" className="min-h-0 flex-1 overflow-scroll font-mono text-xs bg-slate-950 border border-slate-800">
    <div style={{ height: `${virtualizer.getTotalSize() + headerHeight}px`, minWidth: '100%', position: 'relative' }}>
      {availableColumns.length > 0 && <div role="row" aria-label={t(language, 'Visible column filters')} className="sticky top-0 z-10 inline-flex min-w-max items-start gap-2 border-b border-slate-700 bg-slate-900 px-2 py-1">
        <span className="inline-block w-28 shrink-0 text-[10px] uppercase text-slate-400">time</span>
        <span className="inline-block w-12 shrink-0 text-[10px] uppercase text-slate-400">source</span>
        <span className="inline-block w-52 shrink-0 overflow-hidden text-ellipsis text-[10px] uppercase text-slate-400">namespace/pod · <span className="text-yellow-300">{t(language, 'Rows')}: {filteredRows.length}/{visibleRows.length}</span></span>
        {headerColumns.length === 0 && <span className="inline-block min-w-72 text-[10px] uppercase text-slate-500">{t(language, 'No data columns selected — use Manage columns or Essentials')}</span>}
        {headerColumns.map((key) => {
          const label = labelForColumn(key)
          const orderIndex = columnOrder.indexOf(key)
          return <span key={key} data-testid="column-control" data-column-key={key} draggable aria-grabbed={draggedColumn === key} onDragStart={(event) => startColumnDrag(key, event)} onDragEnter={(event) => allowColumnDrop(key, event)} onDragOver={(event) => allowColumnDrop(key, event)} onDrop={() => dropColumnOn(key)} onDragEnd={() => { setDraggedColumn(null); setDragOverColumn(null) }} style={{ width: `${columnWidths[key] ?? minColumnWidthCh}ch` }} className={`inline-block cursor-grab border-l border-slate-700 pl-2 pr-2 align-top active:cursor-grabbing ${draggedColumn === key ? 'bg-slate-800 ring-1 ring-yellow-300' : ''} ${dragOverColumn === key && draggedColumn !== key ? 'border-yellow-300 bg-slate-800/70' : ''}`}>
            <span className="mb-0.5 flex gap-1">
              <button type="button" aria-label={`${t(language, 'Move')} ${label} ${t(language, 'left')}`} disabled={orderIndex === 0} onClick={() => moveColumn(key, 'left')} className="rounded border border-slate-700 px-1 text-[10px] text-slate-300 disabled:cursor-not-allowed disabled:opacity-30">←</button>
              <button type="button" aria-label={`${t(language, 'Move')} ${label} ${t(language, 'right')}`} disabled={orderIndex === columnOrder.length - 1} onClick={() => moveColumn(key, 'right')} className="rounded border border-slate-700 px-1 text-[10px] text-slate-300 disabled:cursor-not-allowed disabled:opacity-30">→</button>
              <button type="button" aria-label={`${t(language, 'Hide')} ${label}`} onClick={() => toggleColumn(key, false)} className="rounded border border-slate-700 px-1 text-[10px] text-slate-300 hover:bg-slate-800">×</button>
            </span>
            <span className="block whitespace-nowrap text-[10px] uppercase text-slate-300">{label}</span>
            <input aria-label={`${t(language, 'Filter')} ${label}`} className="mt-1 w-full min-w-20 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[11px] text-white placeholder:text-slate-600" placeholder={t(language, 'filter')} value={columnFilters[key] ?? ''} onChange={(e)=>setColumnFilter(key, e.target.value)} />
          </span>
        })}
      </div>}
      {emptyState && <div className="absolute inset-0 flex items-start justify-center p-10 font-sans">
        <div className="w-[36rem] max-w-full rounded border border-dashed border-slate-700 bg-slate-900/80 p-5 text-center shadow-lg shadow-black/20">
          <p className="text-base font-semibold text-slate-100">{emptyState.title}</p>
          <p className="mt-2 text-sm text-slate-400">{emptyState.detail}</p>
          <p className="mt-3 text-xs text-slate-500">{t(language, 'Stream status')}: {t(language, streamStatus)}</p>
          {selectedTargetCount === 0 && <button type="button" onClick={openTargetPicker} className="mt-4 rounded border border-yellow-500 bg-yellow-400 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-yellow-300">{t(language, 'Choose Target')}</button>}
        </div>
      </div>}
      {virtualizer.getVirtualItems().map(v => <div key={v.key} data-index={v.index} ref={virtualizer.measureElement} onClick={() => setSelectedRowId(filteredRows[v.index].id)} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start + headerHeight}px)` }}><LogRow row={filteredRows[v.index]} grepQuery={grepQuery} grepMode={grepMode} visibleColumns={headerColumns} columnWidths={columnWidths} isNew={highlightedRowIds.has(filteredRows[v.index].id)} isSelected={selectedRowId === filteredRows[v.index].id} /></div>)}
    </div>
  </div>
  <div className="flex items-center gap-2 border border-slate-800 bg-slate-900 p-2 text-xs">
    <span className="text-slate-400">{t(language, 'Rows')}: {filteredRows.length}/{visibleRows.length}</span>
    <button type="button" disabled={filteredRows.length === 0} onClick={() => void copyText(exportRowsAsJsonl(filteredRows))}>{t(language, 'Copy filtered')}</button>
    <button type="button" disabled={filteredRows.length === 0} onClick={() => downloadTextFile(`klogcat-${Date.now()}.jsonl`, exportRowsAsJsonl(filteredRows))}>{t(language, 'Export filtered JSONL')}</button>
    <span className="text-slate-400">{t(language, 'Selected')}: {selectedRow ? `#${selectedRow.id} ${selectedRow.sourceType}/${selectedRow.pod}` : t(language, 'none')}</span>
  </div>
  {selectedRow && <aside aria-label={t(language, 'Log row detail')} className="max-h-56 overflow-auto rounded border border-slate-700 bg-slate-950 p-3 text-xs">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <strong>{t(language, 'Row')} #{selectedRow.id}</strong>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="rounded border border-slate-700 px-2 py-0.5 text-slate-200 hover:bg-slate-800" onClick={() => void copyText(selectedRow.raw)}>{t(language, 'Copy raw')}</button>
        <button type="button" className="rounded border border-slate-700 px-2 py-0.5 text-slate-200 hover:bg-slate-800" onClick={() => void copyText(JSON.stringify(selectedRow, null, 2))}>{t(language, 'Copy JSON')}</button>
        <button type="button" className="rounded border border-yellow-500/70 px-2 py-0.5 font-semibold text-yellow-100 hover:bg-yellow-500/10" onClick={() => setSelectedRowId(null)}>{t(language, 'Collapse detail')}</button>
        <button type="button" title={t(language, 'Close log row detail')} className="rounded border border-slate-600 px-2 py-0.5 text-slate-200 hover:bg-slate-800" onClick={() => setSelectedRowId(null)}>{t(language, 'Close')}</button>
      </div>
    </div>
    <pre className="whitespace-pre-wrap text-slate-200">{JSON.stringify(selectedRow, null, 2)}</pre>
  </aside>}
  </>
}
