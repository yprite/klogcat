import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useLogStore } from '../stores/logStore'
import { columnsForRows, labelForColumn, type LogColumnKey, valueForColumn } from '../utils/logColumns'
import { LogRow } from './LogRow'

export function LogViewer() {
  const { visibleRows, grepQuery, autoScrollEnabled, viewerPaused } = useLogStore()
  const parentRef = useRef<HTMLDivElement>(null)
  const availableColumns = useMemo(() => columnsForRows(visibleRows), [visibleRows])
  const [visibleColumns, setVisibleColumns] = useState<LogColumnKey[]>([])
  const [columnFilters, setColumnFilters] = useState<Partial<Record<LogColumnKey, string>>>({})
  useEffect(() => {
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
  const virtualizer = useVirtualizer({ count: filteredRows.length, getScrollElement: () => parentRef.current, estimateSize: () => 44, overscan: 10 })
  useEffect(() => { if (autoScrollEnabled && !viewerPaused && filteredRows.length > 0) virtualizer.scrollToIndex(filteredRows.length - 1, { align: 'end' }) }, [filteredRows.length, autoScrollEnabled, viewerPaused, virtualizer])
  const toggleColumn = (key: LogColumnKey, checked: boolean) => setVisibleColumns((current) => checked ? [...current, key] : current.filter((c) => c !== key))
  const setColumnFilter = (key: LogColumnKey, value: string) => setColumnFilters((current) => ({ ...current, [key]: value }))
  const headerHeight = availableColumns.length ? 58 : 0
  return <div ref={parentRef} data-testid="log-scroll" className="h-[70vh] overflow-scroll font-mono text-xs bg-slate-950 border border-slate-800">
    <div style={{ height: `${virtualizer.getTotalSize() + headerHeight}px`, minWidth: '100%', position: 'relative' }}>
      {availableColumns.length > 0 && <div role="row" aria-label="Excel-style column filters" className="sticky top-0 z-10 inline-flex min-w-max gap-2 border-b border-slate-700 bg-slate-900 px-2 py-1">
        <span className="inline-block min-w-28 text-[10px] uppercase text-slate-400">time/source</span>
        <span className="inline-block min-w-24 text-[10px] uppercase text-slate-400">namespace/pod</span>
        <span className="inline-block min-w-24 text-[10px] uppercase text-yellow-300">Rows: {filteredRows.length}/{visibleRows.length}</span>
        {availableColumns.map((key) => {
          const label = labelForColumn(key)
          const checked = visibleColumns.includes(key)
          return <span key={key} className={`inline-block w-max min-w-24 border-l border-slate-700 pl-2 pr-2 align-top ${checked ? '' : 'opacity-50'}`}>
            <label className="block whitespace-nowrap text-[10px] uppercase text-slate-300"><input className="mr-1 align-middle" type="checkbox" aria-label={`Show ${label}`} checked={checked} onChange={(e)=>toggleColumn(key, e.target.checked)} />{label}</label>
            <input aria-label={`Filter ${label}`} className="mt-1 w-full min-w-20 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[11px] text-white placeholder:text-slate-600 disabled:text-slate-600" placeholder="filter" value={columnFilters[key] ?? ''} disabled={!checked} onChange={(e)=>setColumnFilter(key, e.target.value)} />
          </span>
        })}
      </div>}
      {availableColumns.length === 0 && <p className="p-2 text-slate-500">ACC/ERR 컬럼 없음</p>}
      {virtualizer.getVirtualItems().map(v => <div key={v.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start + headerHeight}px)` }}><LogRow row={filteredRows[v.index]} grepQuery={grepQuery} visibleColumns={visibleColumns} /></div>)}
    </div>
  </div>
}
