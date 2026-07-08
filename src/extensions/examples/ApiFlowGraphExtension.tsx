import { useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { KlogcatExtensionModule, LogViewerExtension, LogViewerExtensionProps, SdkLogRow } from '../../sdk/log-viewer'

type FlowNode = {
  id: string
  label: string
  detail: string
  x: number
  y: number
  rowCount: number
}

type FlowEdge = {
  id: string
  from: string
  to: string
  count: number
  trIds: string[]
  elapsedTotal: number
  elapsedMax: number
  firstSeen: number
  lastSeen: number
  requests: string[]
  status: string
}

type FlowTrace = {
  trId: string
  user: string
  entryApi: string
  startTime: number
  duration: number
  status: string
  rowCount: number
  modules: string[]
}

export type ApiFlowGraph = {
  nodes: FlowNode[]
  edges: FlowEdge[]
  traces: FlowTrace[]
  sourceRowCount: number
  correlatedRowCount: number
  omittedNodeCount: number
  omittedEdgeCount: number
  omittedTraceCount: number
}

function rowField(row: SdkLogRow, key: string) {
  const value = row.fields[key]
  return value === undefined || value === null ? undefined : String(value)
}

function timestampMs(row: SdkLogRow) {
  const parsed = row.timestamp ? Date.parse(row.timestamp) : Number.NaN
  return Number.isFinite(parsed) ? parsed : row.receivedAt
}

function correlationKey(row: SdkLogRow) {
  return row.correlationIds.trId ?? row.correlationIds.traceId ?? rowField(row, 'trId') ?? rowField(row, 'traceId')
}

function serverId(row: SdkLogRow) {
  return rowField(row, 'module') ??
    rowField(row, 'service') ??
    row.target.vm?.service ??
    row.target.vm?.name ??
    row.target.pod ??
    'unknown-server'
}

function serverDetail(row: SdkLogRow) {
  const target = row.target.vm?.address ?? row.target.pod
  return [row.target.namespace, target, row.target.container].filter(Boolean).join(' / ')
}

function requestLabel(row: SdkLogRow) {
  const method = row.request?.method ?? row.error?.method ?? rowField(row, 'method') ?? rowField(row, 'errorMethod')
  const url = row.request?.url ?? row.error?.path ?? rowField(row, 'url') ?? rowField(row, 'apiName') ?? rowField(row, 'errorPath')
  return [method, url].filter(Boolean).join(' ') || row.summary
}

function userLabel(row: SdkLogRow) {
  return rowField(row, 'userId') ?? rowField(row, 'appId') ?? rowField(row, 'srcIp') ?? 'unknown-user'
}

function statusValue(row: SdkLogRow) {
  return row.request?.status ?? rowField(row, 'status')
}

function statusCode(value: string | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function statusSeverity(value: string | undefined) {
  const code = statusCode(value)
  if (code === undefined) return 0
  if (code >= 500) return 3
  if (code >= 400) return 2
  if (code >= 300) return 1
  return 0
}

function worstStatus(values: readonly (string | undefined)[]) {
  return values.filter(Boolean).sort((a, b) => statusSeverity(b) - statusSeverity(a) || Number(b) - Number(a))[0] ?? 'n/a'
}

function statusLabel(rows: readonly SdkLogRow[]) {
  return worstStatus(rows.map(statusValue))
}

function elapsedMs(row: SdkLogRow) {
  return row.request?.elapsed ?? Number(rowField(row, 'elapsed') ?? 0)
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return 'n/a'
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`
}

function formatTime(ms: number) {
  if (!Number.isFinite(ms)) return 'n/a'
  return new Date(ms).toLocaleTimeString()
}

function edgeKey(from: string, to: string) {
  return `${from}=>${to}`
}

function mapToNodes(rows: readonly SdkLogRow[]) {
  const byServer = new Map<string, { label: string; detail: string; rowCount: number }>()
  for (const row of rows) {
    const id = serverId(row)
    const current = byServer.get(id) ?? { label: id, detail: serverDetail(row), rowCount: 0 }
    current.rowCount += 1
    if (!current.detail) current.detail = serverDetail(row)
    byServer.set(id, current)
  }
  const entries = [...byServer.entries()].slice(0, 18)
  const width = 920
  const height = 300
  const centerY = height / 2
  return entries.map(([id, node], index) => {
    const ratio = entries.length <= 1 ? 0.5 : index / (entries.length - 1)
    const wave = index % 2 === 0 ? -46 : 46
    return {
      id,
      label: node.label,
      detail: node.detail,
      rowCount: node.rowCount,
      x: 84 + ratio * (width - 168),
      y: centerY + wave,
    }
  })
}

function addEdge(edges: Map<string, FlowEdge>, from: SdkLogRow, to: SdkLogRow, trId: string) {
  const fromId = serverId(from)
  const toId = serverId(to)
  if (fromId === toId) return
  const key = edgeKey(fromId, toId)
  const current = edges.get(key) ?? {
    id: key,
    from: fromId,
    to: toId,
    count: 0,
    trIds: [],
    elapsedTotal: 0,
    elapsedMax: 0,
    firstSeen: timestampMs(from),
    lastSeen: timestampMs(to),
    requests: [],
    status: 'n/a',
  }
  const elapsed = Math.max(0, timestampMs(to) - timestampMs(from), elapsedMs(to))
  current.count += 1
  current.elapsedTotal += elapsed
  current.elapsedMax = Math.max(current.elapsedMax, elapsed)
  current.firstSeen = Math.min(current.firstSeen, timestampMs(from))
  current.lastSeen = Math.max(current.lastSeen, timestampMs(to))
  if (!current.trIds.includes(trId)) current.trIds.push(trId)
  const request = requestLabel(to)
  if (!current.requests.includes(request)) current.requests.push(request)
  current.status = worstStatus([current.status, statusValue(to)])
  edges.set(key, current)
}

function traceFromRows(trId: string, rows: readonly SdkLogRow[]): FlowTrace {
  const sorted = [...rows].sort((a, b) => timestampMs(a) - timestampMs(b) || a.id - b.id)
  const startTime = timestampMs(sorted[0])
  const endTime = timestampMs(sorted.at(-1) ?? sorted[0])
  return {
    trId,
    user: userLabel(sorted[0]),
    entryApi: requestLabel(sorted.find((row) => row.request?.url || row.error?.path) ?? sorted[0]),
    startTime,
    duration: Math.max(0, endTime - startTime, ...sorted.map(elapsedMs)),
    status: statusLabel(sorted),
    rowCount: sorted.length,
    modules: [...new Set(sorted.map(serverId))],
  }
}

export function buildApiFlowGraph(rows: readonly SdkLogRow[]): ApiFlowGraph {
  const groups = new Map<string, SdkLogRow[]>()
  for (const row of rows) {
    const key = correlationKey(row)
    if (!key) continue
    const current = groups.get(key) ?? []
    current.push(row)
    groups.set(key, current)
  }

  const correlatedRows = [...groups.values()].flat()
  const allNodeIds = new Set(correlatedRows.map(serverId))
  const nodes = mapToNodes(correlatedRows)
  const visibleNodeIds = new Set(nodes.map((node) => node.id))
  const edgeMap = new Map<string, FlowEdge>()
  const traces = [...groups.entries()].map(([trId, groupRows]) => {
    const sorted = [...groupRows].sort((a, b) => timestampMs(a) - timestampMs(b) || a.id - b.id)
    for (let index = 1; index < sorted.length; index += 1) {
      if (visibleNodeIds.has(serverId(sorted[index - 1])) && visibleNodeIds.has(serverId(sorted[index]))) addEdge(edgeMap, sorted[index - 1], sorted[index], trId)
    }
    return traceFromRows(trId, sorted)
  }).sort((a, b) => b.startTime - a.startTime || a.trId.localeCompare(b.trId))

  const edges = [...edgeMap.values()].sort((a, b) => b.count - a.count || statusSeverity(b.status) - statusSeverity(a.status) || a.id.localeCompare(b.id))
  const visibleTraces = traces.slice(0, 200)
  return {
    nodes,
    edges: edges.slice(0, 40),
    traces: visibleTraces,
    sourceRowCount: rows.length,
    correlatedRowCount: correlatedRows.length,
    omittedNodeCount: Math.max(0, allNodeIds.size - nodes.length),
    omittedEdgeCount: Math.max(0, edges.length - 40),
    omittedTraceCount: Math.max(0, traces.length - visibleTraces.length),
  }
}

function nodeTooltip(node: FlowNode) {
  return `${node.label}\n${node.detail || 'No target detail'}\nRows: ${node.rowCount}`
}

function edgeTooltip(edge: FlowEdge) {
  return [
    `${edge.from} -> ${edge.to}`,
    `Flows: ${edge.count}`,
    `trID: ${edge.trIds.slice(0, 5).join(', ')}`,
    `Avg elapsed: ${formatDuration(edge.elapsedTotal / Math.max(1, edge.count))}`,
    `Max elapsed: ${formatDuration(edge.elapsedMax)}`,
    `Worst status: ${edge.status}`,
    `APIs: ${edge.requests.slice(0, 3).join(' | ')}`,
  ].join('\n')
}

function GraphCanvas({ graph, selectedTrId }: { graph: ApiFlowGraph; selectedTrId?: string }) {
  const [selectedDetail, setSelectedDetail] = useState<string>('Select a node or edge to inspect full flow details.')
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  const activate = (detail: string) => setSelectedDetail(detail)
  const handleKey = (event: KeyboardEvent<SVGGElement | SVGPathElement>, detail: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    activate(detail)
  }
  return <div className="min-h-[280px] rounded border border-slate-800 bg-slate-950 p-3">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="font-semibold uppercase tracking-wide text-slate-400">{selectedTrId ? 'Selected trID sequence' : 'All module flow'}</span>
      {selectedTrId && <span className="rounded border border-yellow-400/40 bg-yellow-400/10 px-2 py-0.5 font-mono text-yellow-100">{selectedTrId}</span>}
    </div>
    {(graph.omittedNodeCount > 0 || graph.omittedEdgeCount > 0) && <p className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-100">
      Graph limited for readability: {graph.omittedNodeCount} nodes and {graph.omittedEdgeCount} edges omitted. Narrow filters or a shorter time window for full detail.
    </p>}
    <div className="overflow-auto">
      <svg data-testid="api-flow-graph-svg" viewBox="0 0 920 300" className="h-[260px] min-w-[920px] overflow-visible sm:h-[320px]" role="img" aria-label="API flow graph by trID">
        <defs>
          <marker id="api-flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-yellow-300" />
          </marker>
        </defs>
        {graph.edges.map((edge, index) => {
          const from = nodeById.get(edge.from)
          const to = nodeById.get(edge.to)
          if (!from || !to) return null
          const midY = (from.y + to.y) / 2 + (index % 2 === 0 ? -18 : 18)
          const path = `M ${from.x} ${from.y} C ${(from.x + to.x) / 2} ${midY}, ${(from.x + to.x) / 2} ${midY}, ${to.x} ${to.y}`
          const detail = edgeTooltip(edge)
          const failed = statusSeverity(edge.status) >= 3
          return <g key={edge.id}>
            <path d={path} tabIndex={0} role="button" aria-label={detail} onClick={() => activate(detail)} onKeyDown={(event) => handleKey(event, detail)} className="api-flow-edge-hit" data-testid="api-flow-edge">
              <title>{detail}</title>
            </path>
            <path d={path} className={failed ? 'api-flow-edge-base stroke-red-500/70' : 'api-flow-edge-base'} />
            <path d={path} className={failed ? 'api-flow-edge-motion stroke-red-300' : 'api-flow-edge-motion'} markerEnd="url(#api-flow-arrow)" />
          </g>
        })}
        {graph.nodes.map((node) => {
          const detail = nodeTooltip(node)
          return <g key={node.id} transform={`translate(${node.x} ${node.y})`} data-testid="api-flow-node" tabIndex={0} role="button" aria-label={detail} onClick={() => activate(detail)} onKeyDown={(event) => handleKey(event, detail)}>
            <title>{detail}</title>
            <circle r="34" className="fill-slate-900 stroke-slate-700" strokeWidth="2" />
            <circle r="26" className="fill-slate-800 stroke-yellow-300/70" strokeWidth="1.5" />
            <text textAnchor="middle" y="-2" className="fill-white text-[11px] font-semibold">{node.label.length > 13 ? `${node.label.slice(0, 11)}..` : node.label}</text>
            <text textAnchor="middle" y="14" className="fill-slate-400 text-[10px]">{node.rowCount} rows</text>
          </g>
        })}
      </svg>
    </div>
    <div data-testid="api-flow-detail-panel" className="mt-2 whitespace-pre-wrap rounded border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-200">{selectedDetail}</div>
  </div>
}

function TraceList({ onSelectTrId, selectedTrId, traces }: { onSelectTrId: (trId: string | undefined) => void; selectedTrId?: string; traces: readonly FlowTrace[] }) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const visibleTraces = useMemo(() => traces.filter((trace) => {
    if (!normalizedQuery) return true
    return [trace.trId, trace.user, trace.entryApi, trace.status, ...trace.modules].join(' ').toLowerCase().includes(normalizedQuery)
  }), [normalizedQuery, traces])

  return <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] rounded border border-slate-800 bg-slate-950">
    <div className="border-b border-slate-800 p-3">
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="api-flow-trace-search">Search trID</label>
      <input id="api-flow-trace-search" aria-label="Search trID" className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-white placeholder:text-slate-500" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="trID / user / API / module" />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <span>{visibleTraces.length}/{traces.length} trID</span>
        {selectedTrId && <button type="button" className="rounded border border-yellow-500/60 px-2 py-0.5 text-yellow-100 hover:bg-yellow-500/10" onClick={() => onSelectTrId(undefined)}>Clear selection</button>}
      </div>
    </div>
    <div className="min-h-0 overflow-auto overscroll-contain">
    {visibleTraces.map((trace) => {
      const selected = selectedTrId === trace.trId
      return <button type="button" key={trace.trId} className={`block w-full border-b p-3 text-left last:border-b-0 ${selected ? 'border-yellow-400/40 bg-yellow-400/10' : 'border-slate-800 hover:bg-slate-900/80'}`} title={`${trace.entryApi}\nModules: ${trace.modules.join(' -> ')}`} onClick={() => onSelectTrId(selected ? undefined : trace.trId)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-yellow-200">{trace.trId}</p>
          <p className="mt-1 truncate text-sm font-semibold text-white">{trace.entryApi}</p>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-xs ${statusSeverity(trace.status) >= 3 ? 'border-red-500/50 bg-red-500/10 text-red-100' : statusSeverity(trace.status) >= 2 ? 'border-amber-500/50 bg-amber-500/10 text-amber-100' : 'border-slate-700 text-slate-200'}`}>{trace.status}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-400">
        <span>User: <span className="text-slate-200">{trace.user}</span></span>
        <span>Elapsed: <span className="text-slate-200">{formatDuration(trace.duration)}</span></span>
        <span>Rows: <span className="text-slate-200">{trace.rowCount}</span></span>
        <span>Servers: <span className="text-slate-200">{trace.modules.length}</span></span>
      </div>
      </button>
    })}
    {visibleTraces.length === 0 && <p className="p-3 text-sm text-slate-400">No trID matches the current search.</p>}
    </div>
  </div>
}

function traceRows(rows: readonly SdkLogRow[], trId: string | undefined) {
  if (!trId) return []
  return rows.filter((row) => correlationKey(row) === trId).sort((a, b) => timestampMs(a) - timestampMs(b) || a.id - b.id)
}

function TraceTimeline({ rows, trId }: { rows: readonly SdkLogRow[]; trId: string }) {
  if (rows.length === 0) return null
  const start = timestampMs(rows[0])
  const end = Math.max(start + 1, timestampMs(rows.at(-1) ?? rows[0]), ...rows.map((row) => timestampMs(row) + Math.max(1, elapsedMs(row))))
  const span = Math.max(1, end - start)
  const ticks = Array.from({ length: 6 }, (_, index) => index / 5)
  return <section data-testid="api-flow-trace-timeline" className="rounded border border-slate-800 bg-[#10151f] p-3 shadow-inner shadow-black/30">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-yellow-300">Timeline editor</p>
        <h3 className="font-mono text-sm font-semibold text-white">{trId}</h3>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
        <span className="rounded border border-slate-700 px-2 py-1">{rows.length} clips</span>
        <span className="rounded border border-slate-700 px-2 py-1">duration {formatDuration(span)}</span>
      </div>
    </div>
    <div className="overflow-x-auto rounded border border-slate-800 bg-slate-950">
      <div className="min-w-[760px]">
        <div className="relative h-9 border-b border-slate-800 bg-slate-900/80">
          {ticks.map((tick) => <div key={tick} className="absolute top-0 h-full border-l border-slate-700/70" style={{ left: `${tick * 100}%` }}>
            <span className="ml-1 font-mono text-[10px] text-slate-400">+{formatDuration(span * tick)}</span>
          </div>)}
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-yellow-500/20 via-yellow-300/70 to-yellow-500/20" />
        </div>
        <div className="relative">
          {ticks.map((tick) => <div key={`grid-${tick}`} className="pointer-events-none absolute bottom-0 top-0 border-l border-slate-800/80" style={{ left: `${tick * 100}%` }} />)}
          <div className="absolute bottom-0 top-0 z-10 w-px bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.8)]" style={{ left: '0%' }}>
            <span className="absolute -top-2 left-1 rounded bg-red-500 px-1 font-mono text-[10px] text-white">IN</span>
          </div>
      {rows.map((row, index) => {
        const currentTime = timestampMs(row)
        const previousTime = index > 0 ? timestampMs(rows[index - 1]) : currentTime
        const status = statusValue(row) ?? 'n/a'
        const left = Math.max(0, Math.min(96, ((currentTime - start) / span) * 100))
        const clipWidth = Math.max(9, Math.min(32, (Math.max(elapsedMs(row), currentTime - previousTime, 80) / span) * 100))
        const severe = statusSeverity(status)
        return <article key={`${row.id}-${index}`} className="grid min-h-[4.25rem] grid-cols-[8.5rem_minmax(0,1fr)] border-b border-slate-800/80 text-xs last:border-b-0">
          <div className="border-r border-slate-800 bg-slate-900/80 p-2">
            <p className="truncate font-semibold text-white">{serverId(row)}</p>
            <p className="mt-1 font-mono text-slate-400">V{String(index + 1).padStart(2, '0')}</p>
            <p className="mt-1 text-slate-500">delta {index > 0 ? formatDuration(currentTime - previousTime) : 'start'}</p>
          </div>
          <div className="relative bg-[linear-gradient(90deg,rgba(148,163,184,0.06)_1px,transparent_1px)] bg-[length:24px_100%] p-2">
            <button
              type="button"
              className={`absolute top-2 h-11 min-w-[5.25rem] rounded border px-2 text-left shadow-lg transition hover:-translate-y-0.5 ${severe >= 3 ? 'border-red-400/70 bg-red-500/20 text-red-50 shadow-red-950/40' : severe >= 2 ? 'border-amber-400/70 bg-amber-500/20 text-amber-50 shadow-amber-950/40' : 'border-cyan-300/60 bg-cyan-400/15 text-cyan-50 shadow-cyan-950/40'}`}
              style={{ left: `${left}%`, width: `${clipWidth}%` }}
              title={`${serverId(row)}\n${requestLabel(row)}\n${formatTime(currentTime)} · row #${row.id}\nstatus ${status}`}
            >
              <span className="block truncate font-semibold">{requestLabel(row)}</span>
              <span className="mt-0.5 block truncate font-mono text-[10px] opacity-80">+{formatDuration(currentTime - start)} · {status}</span>
            </button>
          </div>
        </article>
      })}
        </div>
      </div>
    </div>
  </section>
}

export function ApiFlowGraphExtensionView({ snapshot }: LogViewerExtensionProps) {
  const sourceRows = snapshot.visibleRows
  const [selectedTrId, setSelectedTrId] = useState<string>()
  const fullGraph = useMemo(() => buildApiFlowGraph(sourceRows), [sourceRows])
  const selectedRows = useMemo(() => traceRows(sourceRows, selectedTrId), [sourceRows, selectedTrId])
  const graph = useMemo(() => selectedTrId ? buildApiFlowGraph(selectedRows) : fullGraph, [fullGraph, selectedRows, selectedTrId])
  useEffect(() => {
    if (selectedTrId && selectedRows.length === 0) setSelectedTrId(undefined)
  }, [selectedRows.length, selectedTrId])
  return <section data-testid="api-flow-graph-view" className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded border border-slate-800 bg-slate-900/80 p-3 sm:p-4">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-yellow-300">API Flow</p>
        <h2 className="text-lg font-semibold text-white">trID linked request graph</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Uses the current visible log rows to show user API requests and the backend module calls connected by trID.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-right text-xs">
        <span className="rounded border border-slate-800 bg-slate-950 px-3 py-2"><b className="block text-base text-white">{fullGraph.traces.length}</b>trID</span>
        <span className="rounded border border-slate-800 bg-slate-950 px-3 py-2"><b className="block text-base text-white">{graph.nodes.length}</b>nodes</span>
        <span className="rounded border border-slate-800 bg-slate-950 px-3 py-2"><b className="block text-base text-white">{graph.edges.length}</b>edges</span>
      </div>
    </header>
    {fullGraph.correlatedRowCount === 0 ? <div className="mt-3 rounded border border-dashed border-slate-700 bg-slate-950 p-6 text-sm text-slate-300">
      <p className="font-semibold text-slate-100">No trID correlated rows in the current view</p>
      <p className="mt-2">Filter to a time window or user, then include rows with trId or traceId to render the API flow graph.</p>
    </div> : <div className="mt-3 grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3">
      <div className="min-h-0">
        <GraphCanvas graph={graph} selectedTrId={selectedTrId} />
      </div>
      {selectedTrId && <TraceTimeline rows={selectedRows} trId={selectedTrId} />}
      <div className="min-h-0">
        {fullGraph.omittedTraceCount > 0 && <p className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-100">{fullGraph.omittedTraceCount} older trID groups omitted from this list.</p>}
        <TraceList traces={fullGraph.traces} selectedTrId={selectedTrId} onSelectTrId={setSelectedTrId} />
      </div>
    </div>}
  </section>
}

export const apiFlowGraphExtension = {
  id: 'klogcat.api-flow-graph',
  ownerId: 'klogcat.bundled',
  label: 'Graph Viewer',
  description: 'Visualize trID based API and backend module flow',
  component: ApiFlowGraphExtensionView,
  requestedCapabilities: ['logs.read', 'logs.export'],
  trustLevel: 'trusted-bundled',
  order: 20,
} satisfies LogViewerExtension

export const apiFlowGraphExtensionModule: KlogcatExtensionModule = {
  manifest: {
    id: apiFlowGraphExtension.id,
    ownerId: apiFlowGraphExtension.ownerId,
    protocol: { name: 'klogcat.logViewer', version: 1 },
    label: apiFlowGraphExtension.label,
    description: apiFlowGraphExtension.description,
    requestedCapabilities: apiFlowGraphExtension.requestedCapabilities,
    trustLevel: apiFlowGraphExtension.trustLevel,
  },
  activate(host) {
    return host.registerLogViewer(apiFlowGraphExtension, { replace: true })
  },
}
