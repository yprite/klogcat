import type { SourceLogType } from '../types/log'
import { useKubeStore } from '../stores/kubeStore'
import { useLogStore } from '../stores/logStore'
import { useSettingsStore } from '../stores/settingsStore'
import { AnimatedStatusPill, ProgressStripe } from './ProgressFeedback'
import { LogTypeSelector } from './LogTypeSelector'
import {
  containerResolver,
  operationState,
  selectedStreamIds,
  startStreams,
  stopStreams,
  toolbarStatus,
  type LogStoreState,
  type SelectedTarget,
  type ToolbarStatus,
} from './logToolbarActions'

function StreamControls({
  selectedSourceTypes,
  onSourceTypesChange,
  status,
  operation,
  onStart,
  onStop,
  onRestart,
}: {
  selectedSourceTypes: SourceLogType[]
  onSourceTypesChange?: (value: SourceLogType[]) => void
  status: ToolbarStatus
  operation: ReturnType<typeof operationState>
  onStart: () => void
  onStop: () => void
  onRestart: () => void
}) {
  return <div aria-label="Stream controls" className="rounded border border-slate-800 bg-slate-950/60 p-2">
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Stream controls</span>
      <AnimatedStatusPill active={operation.active} label={operation.label} detail={operation.detail} />
    </div>
    <div className="flex items-center gap-2">
      {onSourceTypesChange && <LogTypeSelector value={selectedSourceTypes} onChange={onSourceTypesChange} />}
      <button className="rounded border border-yellow-400 bg-yellow-300 px-3 py-1 text-sm font-semibold text-slate-950 hover:bg-yellow-200 disabled:cursor-not-allowed disabled:opacity-50" disabled={status.startBusy || status.alreadyRunning} title={status.startBlockedReason} onClick={onStart}>Start</button>
      <button className="rounded border border-red-500/70 px-3 py-1 text-sm font-semibold text-red-100 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50" disabled={status.stopBusy} onClick={onStop}>Stop</button>
      <button className="rounded border border-orange-400/70 px-3 py-1 text-sm font-semibold text-orange-100 hover:bg-orange-400/10 disabled:cursor-not-allowed disabled:opacity-50" disabled={status.startBusy || status.stopBusy} onClick={onRestart}>Restart</button>
    </div>
    {operation.active && <div className="mt-2"><ProgressStripe label={`${operation.label} progress`} /></div>}
  </div>
}

function ViewerControls({ log }: { log: LogStoreState }) {
  return <div aria-label="Viewer controls" className="rounded border border-slate-800 bg-slate-950/60 p-2">
    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Viewer controls</div>
    <div className="flex flex-wrap items-center gap-2">
      <button className="rounded border border-slate-600 px-3 py-1 text-sm text-slate-100 hover:bg-slate-800" onClick={() => togglePause(log)}>{log.viewerPaused ? 'Resume' : 'Pause'}</button>
      <button className="rounded border border-slate-600 px-3 py-1 text-sm text-slate-100 hover:bg-slate-800" onClick={() => { log.recordActionDebug('Clear clicked'); log.clear() }}>Clear</button>
      <label className="inline-flex items-center gap-1 text-sm text-slate-200"><input type="checkbox" checked={log.autoScrollEnabled} onChange={(event) => setAutoScroll(log, event.target.checked)} /> Auto-scroll</label>
      <label className="inline-flex items-center gap-1 text-sm text-slate-200"><input type="checkbox" checked={log.reconnectEnabled} onChange={(event) => setReconnect(log, event.target.checked)} /> Auto-reconnect</label>
    </div>
  </div>
}

function togglePause(log: LogStoreState) {
  log.recordActionDebug(`${log.viewerPaused ? 'Resume' : 'Pause'} clicked`)
  if (log.viewerPaused) log.resume()
  else log.pause()
}

function setAutoScroll(log: LogStoreState, checked: boolean) {
  log.recordActionDebug(`Auto-scroll changed: ${checked}`)
  log.setAutoScrollEnabled(checked)
}

function setReconnect(log: LogStoreState, checked: boolean) {
  log.recordActionDebug(`Reconnect changed: ${checked}`)
  log.setReconnectEnabled(checked)
}

function RuntimeStatus({ log, status, targets }: { log: LogStoreState; status: ToolbarStatus; targets: SelectedTarget[] }) {
  const startState = status.startBusy || status.alreadyRunning ? 'disabled' : 'enabled'
  return <div aria-label="Runtime status" className="rounded border border-slate-800 bg-slate-950/60 p-2">
    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Runtime status</div>
    <div className="grid grid-cols-3 gap-2 text-xs">
      <StatusChip label="Targets" value={targets.length} />
      <StatusChip label="Status" value={log.streamStatus} />
      <StatusChip label="Start" value={startState} />
    </div>
    <p className="mt-2 truncate text-xs text-slate-400" title={status.startBlockedReason}>Start: {startState}{status.startBlockedReason ? ` (${status.startBlockedReason})` : ''}</p>
    {log.latestStderr && <p className="mt-1 truncate text-xs text-yellow-300" title={log.latestStderr}>stderr: {log.latestStderr}</p>}
    {log.totalDroppedCount > 0 && <p className="mt-1 text-xs text-yellow-300">Dropped: {log.totalDroppedCount}</p>}
  </div>
}

function StatusChip({ label, value }: { label: string; value: string | number }) {
  return <span className="rounded border border-slate-800 bg-slate-900 px-2 py-1">
    <span className="text-slate-500">{label}</span>
    <strong className="ml-2 text-slate-100">{value}</strong>
  </span>
}

export function LogToolbar({ sourceType, sourceTypes, onSourceTypesChange }: { sourceType?: SourceLogType; sourceTypes?: SourceLogType[]; onSourceTypesChange?: (value: SourceLogType[]) => void }) {
  const selectedSourceTypes: SourceLogType[] = sourceTypes ?? [sourceType ?? 'info']
  const primarySourceType = selectedSourceTypes[0] ?? 'info'
  const kube = useKubeStore()
  const { settings } = useSettingsStore()
  const log = useLogStore()
  const targets = kube.getSelectedPodTargets()
  const resolveContainer = containerResolver(settings, primarySourceType)
  const status = toolbarStatus(log, settings, selectedSourceTypes, targets)
  const operation = operationState(log, kube, targets, selectedSourceTypes)
  const start = (allowRestart = false) => startStreams({ selectedSourceTypes, targets, settings, log, status, resolveContainer, allowRestart })
  const stop = () => {
    const ids = selectedStreamIds(log)
    log.recordActionDebug(`Stop clicked: status=${log.streamStatus}, activeStreamIds=${ids.join(', ') || '(none)'}`)
    return stopStreams(log, ids, true)
  }
  const restart = async () => {
    log.recordActionDebug('Restart clicked')
    await stopStreams(log, selectedStreamIds(log), false)
    await start(true)
  }

  return <section aria-label="Log stream controls" className="grid shrink-0 grid-cols-[minmax(24rem,1.2fr)_minmax(22rem,1fr)_minmax(26rem,1.15fr)] gap-2 border-b border-slate-800 bg-slate-900 px-2 py-2">
    <StreamControls selectedSourceTypes={selectedSourceTypes} onSourceTypesChange={onSourceTypesChange} status={status} operation={operation} onStart={() => void start()} onStop={() => void stop()} onRestart={() => void restart()} />
    <ViewerControls log={log} />
    <RuntimeStatus log={log} status={status} targets={targets} />
  </section>
}
