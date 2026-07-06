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

function statusLabel(rows: readonly SdkLogRow[]) {
  return rows.find((row) => row.request?.status || rowField(row, 'status'))?.request?.status ??
    rows.map((row) => rowField(row, 'status')).find(Boolean) ??
    'n/a'
}

function elapsedMs(row: SdkLogRow) {
  return row.request?.elapsed ?? Number(rowField(row, 'elapsed') ?? 0)
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return 'n/a'
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`
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
  const entries = [...byServer.entries()].slice(0, 12)
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

  return {
    nodes,
    edges: [...edgeMap.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)).slice(0, 24),
    traces: traces.slice(0, 12),
    sourceRowCount: rows.length,
    correlatedRowCount: correlatedRows.length,
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
    `APIs: ${edge.requests.slice(0, 3).join(' | ')}`,
  ].join('\n')
}

function GraphCanvas({ graph }: { graph: ApiFlowGraph }) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  return <div className="min-h-[320px] rounded border border-slate-800 bg-slate-950 p-3">
    <svg data-testid="api-flow-graph-svg" viewBox="0 0 920 300" className="h-[320px] w-full overflow-visible" role="img" aria-label="API flow graph by trID">
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
        return <g key={edge.id} data-testid="api-flow-edge">
          <path d={path} className="api-flow-edge-base" />
          <path d={path} className="api-flow-edge-motion" markerEnd="url(#api-flow-arrow)">
            <title>{edgeTooltip(edge)}</title>
          </path>
        </g>
      })}
      {graph.nodes.map((node) => <g key={node.id} transform={`translate(${node.x} ${node.y})`} data-testid="api-flow-node">
        <title>{nodeTooltip(node)}</title>
        <circle r="34" className="fill-slate-900 stroke-slate-700" strokeWidth="2" />
        <circle r="26" className="fill-slate-800 stroke-yellow-300/70" strokeWidth="1.5" />
        <text textAnchor="middle" y="-2" className="fill-white text-[11px] font-semibold">{node.label.slice(0, 13)}</text>
        <text textAnchor="middle" y="14" className="fill-slate-400 text-[10px]">{node.rowCount} rows</text>
      </g>)}
    </svg>
  </div>
}

function TraceList({ traces }: { traces: readonly FlowTrace[] }) {
  return <div className="min-h-0 overflow-auto rounded border border-slate-800 bg-slate-950">
    {traces.map((trace) => <article key={trace.trId} className="border-b border-slate-800 p-3 last:border-b-0" title={`${trace.entryApi}\nModules: ${trace.modules.join(' -> ')}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-yellow-200">{trace.trId}</p>
          <p className="mt-1 truncate text-sm font-semibold text-white">{trace.entryApi}</p>
        </div>
        <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-200">{trace.status}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-400">
        <span>User: <span className="text-slate-200">{trace.user}</span></span>
        <span>Elapsed: <span className="text-slate-200">{formatDuration(trace.duration)}</span></span>
        <span>Rows: <span className="text-slate-200">{trace.rowCount}</span></span>
        <span>Servers: <span className="text-slate-200">{trace.modules.length}</span></span>
      </div>
    </article>)}
  </div>
}

export function ApiFlowGraphExtensionView({ snapshot }: LogViewerExtensionProps) {
  const sourceRows = snapshot.visibleRows
  const graph = buildApiFlowGraph(sourceRows)
  return <section data-testid="api-flow-graph-view" className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden rounded border border-slate-800 bg-slate-900/80 p-4">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-yellow-300">API Flow</p>
        <h2 className="text-lg font-semibold text-white">trID linked request graph</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Uses the current visible log rows to show user API requests and the backend module calls connected by trID.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-right text-xs">
        <span className="rounded border border-slate-800 bg-slate-950 px-3 py-2"><b className="block text-base text-white">{graph.traces.length}</b>trID</span>
        <span className="rounded border border-slate-800 bg-slate-950 px-3 py-2"><b className="block text-base text-white">{graph.nodes.length}</b>nodes</span>
        <span className="rounded border border-slate-800 bg-slate-950 px-3 py-2"><b className="block text-base text-white">{graph.edges.length}</b>edges</span>
      </div>
    </header>
    {graph.correlatedRowCount === 0 ? <div className="rounded border border-dashed border-slate-700 bg-slate-950 p-6 text-sm text-slate-300">
      <p className="font-semibold text-slate-100">No trID correlated rows in the current view</p>
      <p className="mt-2">Filter to a time window or user, then include rows with trId or traceId to render the API flow graph.</p>
    </div> : <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
      <GraphCanvas graph={graph} />
      <TraceList traces={graph.traces} />
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
