import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useLogStore } from '../stores/logStore'
import { columnsForRows, labelForColumn, type LogColumnKey } from '../utils/logColumns'
import { LogRow } from './LogRow'

export function LogViewer() {
  const { visibleRows, grepQuery, autoScrollEnabled, viewerPaused } = useLogStore()
  const parentRef = useRef<HTMLDivElement>(null)
  const availableColumns = useMemo(() => columnsForRows(visibleRows), [visibleRows])
  const [visibleColumns, setVisibleColumns] = useState<LogColumnKey[]>([])
  useEffect(() => {
    setVisibleColumns((current) => {
      const available = new Set(availableColumns)
      const kept = current.filter((key) => available.has(key))
      const added = availableColumns.filter((key) => !current.includes(key))
      return [...kept, ...added]
    })
  }, [availableColumns])
  const virtualizer = useVirtualizer({ count: visibleRows.length, getScrollElement: () => parentRef.current, estimateSize: () => 44, overscan: 10 })
  useEffect(() => { if (autoScrollEnabled && !viewerPaused && visibleRows.length > 0) virtualizer.scrollToIndex(visibleRows.length - 1, { align: 'end' }) }, [visibleRows.length, autoScrollEnabled, viewerPaused, virtualizer])
  const toggleColumn = (key: LogColumnKey, checked: boolean) => setVisibleColumns((current) => checked ? [...current, key] : current.filter((c) => c !== key))
  return <div className="flex gap-2 items-stretch">
    <div ref={parentRef} data-testid="log-scroll" className="h-[70vh] flex-1 overflow-scroll font-mono text-xs bg-slate-950 border border-slate-800">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, minWidth: '100%', position: 'relative' }}>
        {virtualizer.getVirtualItems().map(v => <div key={v.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start}px)` }}><LogRow row={visibleRows[v.index]} grepQuery={grepQuery} visibleColumns={visibleColumns} /></div>)}
      </div>
    </div>
    <fieldset aria-label="Column visibility" className="order-last w-48 max-h-[70vh] overflow-auto border border-slate-800 bg-slate-950 p-2 text-xs">
      <legend className="px-1 text-slate-300">표시여부</legend>
      {availableColumns.length === 0 ? <p className="text-slate-500">ACC/ERR 컬럼 없음</p> : availableColumns.map((key) => <label key={key} className="block whitespace-nowrap py-1">
        <input className="mr-1" type="checkbox" checked={visibleColumns.includes(key)} onChange={(e)=>toggleColumn(key, e.target.checked)} />{labelForColumn(key)}
      </label>)}
    </fieldset>
  </div>
}
