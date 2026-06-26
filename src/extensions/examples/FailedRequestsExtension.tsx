import type { KlogcatExtensionModule, LogViewerExtension, LogViewerExtensionProps, SdkLogRow } from '../../sdk/log-viewer'

type FailedRequestGroup = {
  correlationKey: string
  accessRow?: SdkLogRow
  errorRow?: SdkLogRow
  representativeRow: SdkLogRow
  rawRows: SdkLogRow[]
}

function rowField(row: SdkLogRow, key: string) {
  const value = row.fields[key]
  return value === undefined || value === null ? undefined : String(value)
}

function correlationKeyFor(row: SdkLogRow) {
  return row.correlationIds.trId ?? row.correlationIds.traceId ?? rowField(row, 'trId') ?? rowField(row, 'traceId')
}

function isFailedRow(row: SdkLogRow) {
  const status = row.request?.status ?? rowField(row, 'status')
  return row.sourceType === 'error' ||
    Boolean(row.error?.reason || rowField(row, 'errorReason') || rowField(row, 'exceptionName')) ||
    Boolean(status && /^5\d\d$/.test(status))
}

function groupFailedRequests(rows: readonly SdkLogRow[]) {
  const groups = new Map<string, FailedRequestGroup>()
  for (const row of rows) {
    if (!isFailedRow(row)) continue
    const correlationKey = correlationKeyFor(row)
    if (!correlationKey) continue
    const current = groups.get(correlationKey) ?? { correlationKey, representativeRow: row, rawRows: [] }
    current.rawRows.push(row)
    if (row.sourceType === 'access' && !current.accessRow) current.accessRow = row
    if (row.sourceType === 'error' && !current.errorRow) current.errorRow = row
    if (current.accessRow) current.representativeRow = current.accessRow
    groups.set(correlationKey, current)
  }
  return [...groups.values()]
}

function requestTitle(group: FailedRequestGroup) {
  const method = group.accessRow?.request?.method ?? group.errorRow?.error?.method ?? rowField(group.errorRow ?? group.representativeRow, 'errorMethod')
  const path = group.accessRow?.request?.url ?? group.errorRow?.error?.path ?? rowField(group.errorRow ?? group.representativeRow, 'errorPath') ?? group.representativeRow.summary
  return [method, path].filter(Boolean).join(' ')
}

function statusLabel(group: FailedRequestGroup) {
  return group.accessRow?.request?.status ?? rowField(group.accessRow ?? group.representativeRow, 'status') ?? 'ERR'
}

function reasonLabel(group: FailedRequestGroup) {
  return group.errorRow?.error?.reason ??
    rowField(group.errorRow ?? group.representativeRow, 'errorReason') ??
    rowField(group.accessRow ?? group.representativeRow, 'exceptionName') ??
    rowField(group.accessRow ?? group.representativeRow, 'rmsg') ??
    group.representativeRow.summary
}

export function FailedRequestsExtensionView({ snapshot }: LogViewerExtensionProps) {
  const visibleRowIds = new Set(snapshot.visibleRows.map((row) => row.id))
  const failedRequests = snapshot.grepQuery.trim()
    ? groupFailedRequests(snapshot.rows).filter((group) => group.rawRows.some((row) => visibleRowIds.has(row.id)))
    : groupFailedRequests(snapshot.rows)
  const correlationLabel = 'trId -> traceId'
  const sourceRowLabel = snapshot.grepQuery.trim() ? `${snapshot.visibleRowCount}/${snapshot.totalRowCount}` : String(snapshot.totalRowCount)

  return <section data-testid="failed-requests-view" className="min-h-0 flex-1 overflow-auto rounded border border-slate-800 bg-slate-950 p-4">
    <div className="mb-4 border-b border-slate-800 pb-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-yellow-300">Failed Requests</p>
      <h2 className="text-lg font-semibold text-white">Request-centric investigation layer</h2>
      <p className="mt-1 max-w-3xl text-sm text-slate-400">
        This extension groups visible SDK rows by correlation id without importing klogcat host stores.
      </p>
    </div>
    <div className="grid gap-3 md:grid-cols-4">
      <div className="rounded border border-slate-800 bg-slate-900 p-3">
        <p className="text-xs uppercase text-slate-500">Source rows available</p>
        <p className="mt-1 text-2xl font-semibold text-white">{sourceRowLabel}</p>
      </div>
      <div className="rounded border border-slate-800 bg-slate-900 p-3">
        <p className="text-xs uppercase text-slate-500">Failed request groups</p>
        <p className="mt-1 text-2xl font-semibold text-white">{failedRequests.length}</p>
      </div>
      <div className="rounded border border-slate-800 bg-slate-900 p-3">
        <p className="text-xs uppercase text-slate-500">Correlation key</p>
        <p className="mt-1 font-mono text-sm text-yellow-200">{correlationLabel}</p>
      </div>
      <div className="rounded border border-slate-800 bg-slate-900 p-3">
        <p className="text-xs uppercase text-slate-500">Raw logs</p>
        <p className="mt-1 text-sm text-slate-200">Preserved as source of truth</p>
      </div>
    </div>

    {failedRequests.length === 0 ? <div className="mt-4 rounded border border-dashed border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-300">
      <p className="font-semibold text-slate-100">No failed request groups yet</p>
      <p className="mt-2">5xx access rows, ERR rows, or exception rows with {correlationLabel} will appear here.</p>
    </div> : <div className="mt-4 space-y-3">
      {failedRequests.map((group) => <article key={group.correlationKey} className="rounded border border-slate-800 bg-slate-900/80 p-4 shadow-lg shadow-black/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Correlation</p>
            <h3 className="mt-1 font-mono text-base font-semibold text-yellow-200">{group.correlationKey}</h3>
          </div>
          <span className="rounded-full border border-red-500/50 bg-red-500/10 px-3 py-1 text-sm font-semibold text-red-200">{statusLabel(group)}</span>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]">
          <div>
            <p className="text-xs uppercase text-slate-500">Request</p>
            <p className="mt-1 break-all text-sm font-medium text-slate-100">{requestTitle(group)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Failure reason</p>
            <p className="mt-1 break-words text-sm text-slate-200">{reasonLabel(group)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Evidence</p>
            <p className="mt-1 text-sm text-slate-200">Raw rows: {group.rawRows.length}</p>
          </div>
        </div>
      </article>)}
    </div>}
  </section>
}

export const failedRequestsExtension = {
  id: 'klogcat.example.failed-requests',
  ownerId: 'klogcat.examples',
  label: 'Failed Requests',
  description: 'SDK-only request-centric investigation view',
  component: FailedRequestsExtensionView,
  requestedCapabilities: ['logs.read', 'logs.export'],
  trustLevel: 'trusted-bundled',
  order: 100,
} satisfies LogViewerExtension

export const failedRequestsExtensionModule: KlogcatExtensionModule = {
  manifest: {
    id: failedRequestsExtension.id,
    ownerId: failedRequestsExtension.ownerId,
    protocol: { name: 'klogcat.logViewer', version: 1 },
    label: failedRequestsExtension.label,
    description: failedRequestsExtension.description,
    requestedCapabilities: failedRequestsExtension.requestedCapabilities,
    trustLevel: failedRequestsExtension.trustLevel,
  },
  activate(host) {
    return host.registerLogViewer(failedRequestsExtension)
  },
}
