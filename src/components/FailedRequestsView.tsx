import { useMemo } from 'react'
import { useLogStore } from '../stores/logStore'
import { getLogPolicy, groupFailedRequestsFromPolicy } from '../utils/logPolicy'

function requestTitle(group: ReturnType<typeof groupFailedRequestsFromPolicy>[number]) {
  const method = group.accessRow?.method ?? group.errorRow?.errorMethod
  const path = group.accessRow?.url ?? group.errorRow?.errorPath ?? group.representativeRow.summary
  return [method, path].filter(Boolean).join(' ')
}

function statusLabel(group: ReturnType<typeof groupFailedRequestsFromPolicy>[number]) {
  return group.accessRow?.status ?? 'ERR'
}

function reasonLabel(group: ReturnType<typeof groupFailedRequestsFromPolicy>[number]) {
  return group.errorRow?.errorReason ?? group.accessRow?.exceptionName ?? group.accessRow?.rmsg ?? group.representativeRow.summary
}

export function FailedRequestsView() {
  const { visibleRows } = useLogStore()
  const policy = getLogPolicy()
  const failedRequests = useMemo(() => groupFailedRequestsFromPolicy(visibleRows, policy), [visibleRows, policy])
  const correlationLabel = policy.grouping.correlationFields.join(' → ')

  return <section data-testid="failed-requests-view" className="min-h-0 flex-1 overflow-auto rounded border border-slate-800 bg-slate-950 p-4">
    <div className="mb-4 border-b border-slate-800 pb-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-yellow-300">Failed Requests</p>
      <h2 className="text-lg font-semibold text-white">Request-centric investigation layer</h2>
      <p className="mt-1 max-w-3xl text-sm text-slate-400">
        이 모드는 raw logs를 대체하지 않고, policy correlation key 기준으로 Access/Error 로그를 묶어 실패 요청을 조사하는 영역이야.
      </p>
    </div>
    <div className="grid gap-3 md:grid-cols-4">
      <div className="rounded border border-slate-800 bg-slate-900 p-3">
        <p className="text-xs uppercase text-slate-500">Source rows available</p>
        <p className="mt-1 text-2xl font-semibold text-white">{visibleRows.length}</p>
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
