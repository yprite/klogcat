import { useLogStore } from '../stores/logStore'

export function FailedRequestsView() {
  const { visibleRows } = useLogStore()
  return <section data-testid="failed-requests-view" className="min-h-0 flex-1 overflow-auto rounded border border-slate-800 bg-slate-950 p-4">
    <div className="mb-4 border-b border-slate-800 pb-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-yellow-300">Failed Requests</p>
      <h2 className="text-lg font-semibold text-white">Request-centric investigation layer</h2>
      <p className="mt-1 max-w-3xl text-sm text-slate-400">
        이 모드는 raw logs를 대체하지 않고, trId 기준으로 Access/Error 로그를 묶어 실패 요청을 조사하는 영역이야.
      </p>
    </div>
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded border border-slate-800 bg-slate-900 p-3">
        <p className="text-xs uppercase text-slate-500">Source rows available</p>
        <p className="mt-1 text-2xl font-semibold text-white">{visibleRows.length}</p>
      </div>
      <div className="rounded border border-slate-800 bg-slate-900 p-3">
        <p className="text-xs uppercase text-slate-500">Correlation key</p>
        <p className="mt-1 font-mono text-sm text-yellow-200">trId</p>
      </div>
      <div className="rounded border border-slate-800 bg-slate-900 p-3">
        <p className="text-xs uppercase text-slate-500">Raw logs</p>
        <p className="mt-1 text-sm text-slate-200">Preserved as source of truth</p>
      </div>
    </div>
    <div className="mt-4 rounded border border-dashed border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-300">
      <p className="font-semibold text-slate-100">Next implementation target</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Group failed requests by <code className="text-yellow-200">trId</code>.</li>
        <li>Merge Access Log and Error Log into request cards.</li>
        <li>Open a detail panel with Overview, Error, Access, and Raw Logs tabs.</li>
      </ul>
    </div>
  </section>
}
