import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useLogStore } from '../stores/logStore'
import { LogRow } from './LogRow'

export function LogViewer() {
  const { visibleRows, grepQuery, autoScrollEnabled, viewerPaused } = useLogStore()
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({ count: visibleRows.length, getScrollElement: () => parentRef.current, estimateSize: () => 28, overscan: 10 })
  useEffect(() => { if (autoScrollEnabled && !viewerPaused && visibleRows.length > 0) virtualizer.scrollToIndex(visibleRows.length - 1, { align: 'end' }) }, [visibleRows.length, autoScrollEnabled, viewerPaused, virtualizer])
  return <div ref={parentRef} className="h-[70vh] overflow-auto font-mono text-xs bg-slate-950">
    <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
      {virtualizer.getVirtualItems().map(v => <div key={v.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start}px)` }}><LogRow row={visibleRows[v.index]} grepQuery={grepQuery} /></div>)}
    </div>
  </div>
}
