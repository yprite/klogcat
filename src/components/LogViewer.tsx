import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useLogStore } from '../stores/logStore'
import { columnsForRows, labelForColumn, type LogColumnKey, valueForColumn } from '../utils/logColumns'
import { LogRow } from './LogRow'
import type { ParsedLogLine } from '../types/log'

export type LogColumnWidths = Partial<Record<LogColumnKey, number>>

const minColumnWidthCh = 12
const valuePaddingCh = 2

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

export function forceScrollToBottom(element: HTMLElement | null) {
  if (!element) return
  element.scrollTop = element.scrollHeight
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

export function LogViewer() {
  const { rows, visibleRows, grepQuery, autoScrollEnabled, viewerPaused } = useLogStore()
  const parentRef = useRef<HTMLDivElement>(null)
  const seenRowIdsRef = useRef<Set<number> | null>(null)
  const highlightTimeoutsRef = useRef<number[]>([])
  const availableColumns = useMemo(() => columnsForRows(visibleRows), [visibleRows])
  const [columnOrder, setColumnOrder] = useState<LogColumnKey[]>([])
  const [visibleColumns, setVisibleColumns] = useState<LogColumnKey[]>([])
  const [columnFilters, setColumnFilters] = useState<Partial<Record<LogColumnKey, string>>>({})
  const [draggedColumn, setDraggedColumn] = useState<LogColumnKey | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<LogColumnKey | null>(null)
  const [highlightedRowIds, setHighlightedRowIds] = useState<Set<number>>(() => new Set())
  useEffect(() => {
    setColumnOrder((current) => {
      const available = new Set(availableColumns)
      const kept = current.filter((key) => available.has(key))
      const added = availableColumns.filter((key) => !current.includes(key))
      return [...kept, ...added]
    })
    setVisibleColumns((current) => {
      const available = new Set(availableColumns)
      const kept = current.filter((key) => available.has(key))
      const added = availableColumns.filter((key) => !current.includes(key))
      return [...kept, ...added]
    })
    setColumnFilters((current) => Object.fromEntries(Object.entries(current).filter(([key]) => availableColumns.includes(key as LogColumnKey))) as Partial<Record<LogColumnKey, string>>)
  }, [availableColumns])
  const filteredRows = useMemo(() => {
    const activeFilters = Object.entries(columnFilters).filter(([, value]) => value.trim() !== '') as Array<[LogColumnKey, string]>
    if (activeFilters.length === 0) return visibleRows
    return visibleRows.filter((row) => activeFilters.every(([key, filter]) => valueForColumn(row, key).toLowerCase().includes(filter.trim().toLowerCase())))
  }, [columnFilters, visibleRows])
  const columnWidths = useMemo(() => columnWidthsForRows(filteredRows, columnOrder), [columnOrder, filteredRows])
  const virtualizer = useVirtualizer({ count: filteredRows.length, getScrollElement: () => parentRef.current, estimateSize: () => 44, overscan: 10 })
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
  const toggleColumn = (key: LogColumnKey, checked: boolean) => setVisibleColumns((current) => nextVisibleColumnsForToggle(current, columnOrder, key, checked))
  const setColumnFilter = (key: LogColumnKey, value: string) => setColumnFilters((current) => ({ ...current, [key]: value }))
  const moveColumn = (key: LogColumnKey, direction: 'left' | 'right') => {
    setColumnOrder((current) => {
      const nextOrder = moveColumnInOrder(current, key, direction)
      setVisibleColumns((visible) => visibleColumnsFromOrder(nextOrder, visible))
      return nextOrder
    })
  }
  const dropColumnOn = (targetKey: LogColumnKey) => {
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
  return <div ref={parentRef} data-testid="log-scroll" className="min-h-0 flex-1 overflow-scroll font-mono text-xs bg-slate-950 border border-slate-800">
    <div style={{ height: `${virtualizer.getTotalSize() + headerHeight}px`, minWidth: '100%', position: 'relative' }}>
      {availableColumns.length > 0 && <div role="row" aria-label="Excel-style column filters" className="sticky top-0 z-10 inline-flex min-w-max gap-2 border-b border-slate-700 bg-slate-900 px-2 py-1">
        <span className="inline-block min-w-28 text-[10px] uppercase text-slate-400">time/source</span>
        <span className="inline-block min-w-24 text-[10px] uppercase text-slate-400">namespace/pod</span>
        <span className="inline-block min-w-24 text-[10px] uppercase text-yellow-300">Rows: {filteredRows.length}/{visibleRows.length}</span>
        {columnOrder.map((key, index) => {
          const label = labelForColumn(key)
          const checked = visibleColumns.includes(key)
          return <span key={key} data-testid="column-control" data-column-key={key} draggable aria-grabbed={draggedColumn === key} onDragStart={(event) => startColumnDrag(key, event)} onDragEnter={(event) => allowColumnDrop(key, event)} onDragOver={(event) => allowColumnDrop(key, event)} onDrop={() => dropColumnOn(key)} onDragEnd={() => { setDraggedColumn(null); setDragOverColumn(null) }} style={{ width: `${columnWidths[key] ?? minColumnWidthCh}ch` }} className={`inline-block cursor-grab border-l border-slate-700 pl-2 pr-2 align-top active:cursor-grabbing ${checked ? '' : 'opacity-50'} ${draggedColumn === key ? 'bg-slate-800 ring-1 ring-yellow-300' : ''} ${dragOverColumn === key && draggedColumn !== key ? 'border-yellow-300 bg-slate-800/70' : ''}`}>
            <span className="mb-0.5 flex gap-1">
              <button type="button" aria-label={`Move ${label} left`} disabled={index === 0} onClick={() => moveColumn(key, 'left')} className="rounded border border-slate-700 px-1 text-[10px] text-slate-300 disabled:cursor-not-allowed disabled:opacity-30">←</button>
              <button type="button" aria-label={`Move ${label} right`} disabled={index === columnOrder.length - 1} onClick={() => moveColumn(key, 'right')} className="rounded border border-slate-700 px-1 text-[10px] text-slate-300 disabled:cursor-not-allowed disabled:opacity-30">→</button>
            </span>
            <label className="block whitespace-nowrap text-[10px] uppercase text-slate-300"><input className="mr-1 align-middle" type="checkbox" aria-label={`Show ${label}`} checked={checked} onChange={(e)=>toggleColumn(key, e.target.checked)} />{label}</label>
            <input aria-label={`Filter ${label}`} className="mt-1 w-full min-w-20 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[11px] text-white placeholder:text-slate-600 disabled:text-slate-600" placeholder="filter" value={columnFilters[key] ?? ''} disabled={!checked} onChange={(e)=>setColumnFilter(key, e.target.value)} />
          </span>
        })}
      </div>}
      {availableColumns.length === 0 && <p className="p-2 text-slate-500">ACC/ERR 컬럼 없음</p>}
      {virtualizer.getVirtualItems().map(v => <div key={v.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start + headerHeight}px)` }}><LogRow row={filteredRows[v.index]} grepQuery={grepQuery} visibleColumns={visibleColumns} columnWidths={columnWidths} isNew={highlightedRowIds.has(filteredRows[v.index].id)} /></div>)}
    </div>
  </div>
}
