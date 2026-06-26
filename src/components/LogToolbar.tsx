import type { SourceLogType } from '../types/log'
import { scopeKey, useKubeStore } from '../stores/kubeStore'
import { useLogStore } from '../stores/logStore'
import { useSettingsStore } from '../stores/settingsStore'
import { startLogStream, stopLogStream } from '../commands/tauriLogs'
import { buildScloudLogPath } from '../utils/logPath'
import { findFallbackPod } from '../utils/podFallback'
import { AnimatedStatusPill, ProgressStripe } from './ProgressFeedback'
import { LogTypeSelector } from './LogTypeSelector'

export function LogToolbar({ sourceType, sourceTypes, onSourceTypesChange }: { sourceType?: SourceLogType; sourceTypes?: SourceLogType[]; onSourceTypesChange?: (value: SourceLogType[]) => void }) {
  const selectedSourceTypes: SourceLogType[] = sourceTypes ?? [sourceType ?? 'info']
  const primarySourceType = selectedSourceTypes[0] ?? 'info'
  const kube = useKubeStore(); const { settings } = useSettingsStore(); const log = useLogStore()
  const startBusy = log.streamStatus === 'starting' || log.streamStatus === 'stopping'
  const stopBusy = log.streamStatus === 'stopping'
  const alreadyRunning = log.activeStreamIds.length > 0 || log.streamStatus === 'running'
  const source = settings?.logSources[primarySourceType]
  const targets = kube.getSelectedPodTargets()
  const containerFor = (containers: string[]) => source && containers.includes(source.container) ? source.container : containers[0] ?? source?.container ?? ''
  const invalidTargets = targets.filter((t) => t.pod.phase !== 'Running' || t.pod.containers.length === 0)
  const missingSourceConfig = selectedSourceTypes.some((type) => !settings?.logSources[type])
  const disabledReason = !settings ? 'Settings are not loaded' : selectedSourceTypes.length === 0 ? 'Select at least one log type' : missingSourceConfig ? 'Settings are not loaded' : targets.length === 0 ? 'Select namespace and pod' : invalidTargets.length ? 'Every selected pod must be Running and have a container' : ''
  const startBlockedReason = startBusy ? `Busy: ${log.streamStatus}` : alreadyRunning ? 'Stream is already running' : disabledReason
  const operationActive = startBusy || kube.loadingPods || kube.cacheRefreshing
  const operationLabel = log.streamStatus === 'starting' ? 'Starting streams' : log.streamStatus === 'stopping' ? 'Stopping streams' : kube.loadingPods ? 'Refreshing pods' : kube.cacheRefreshing ? 'Refreshing target cache' : 'Ready'
  const operationDetail = log.streamStatus === 'starting' ? `${log.activeStreamIds.length}/${Math.max(1, targets.length * selectedSourceTypes.length)} streams` : kube.loadingPods ? `${targets.length || 1} target scope` : undefined
  const start = async (allowRestart = false) => {
    log.recordActionDebug(`Start clicked: status=${log.streamStatus}, targets=${targets.map(t=>`${t.context}/${t.namespace}/${t.pod.name}/${containerFor(t.pod.containers)}`).join(', ') || '(none)'}, sources=${selectedSourceTypes.join(', ') || '(none)'}, startBlockedReason=${startBlockedReason || '(none)'}`)
    if (startBusy) { log.markError(undefined, `Busy: ${log.streamStatus}`); return }
    if (alreadyRunning && !allowRestart) { log.markError(log.activeStreamId, 'Stream is already running'); return }
    if (disabledReason || !settings) { log.markError(undefined, disabledReason || 'invalid_source_config'); return }

    const replaceSelectedPod = (context: string, namespace: string, stalePod: string, fallbackPod: string) => {
      const key = scopeKey(context, namespace)
      const current = useKubeStore.getState().selectedPods[key] ?? []
      const next = current.map((pod) => pod === stalePod ? fallbackPod : pod)
      useKubeStore.setState((state) => ({
        selectedPods: { ...state.selectedPods, [key]: next },
        selectedPod: state.selectedPod === stalePod ? fallbackPod : state.selectedPod,
      }))
    }

    const resolveLiveTargetsForStart = async () => {
      await useKubeStore.getState().refreshPodsForSelections()
      const state = useKubeStore.getState()
      const resolved: typeof targets = []
      const selectedEntries = Object.entries(state.selectedPods)
      if (selectedEntries.length === 0) return useKubeStore.getState().getSelectedPodTargets()
      for (const [key, selectedNames] of selectedEntries) {
        const [context, namespace] = key.split('\u0000')
        const pods = state.podsByScope[key] ?? []
        for (const selectedName of selectedNames) {
          const exact = pods.find((pod) => pod.name === selectedName)
          if (exact) {
            resolved.push({ context, namespace, pod: exact })
            continue
          }
          const previousPod = targets.find((target) => target.context === context && target.namespace === namespace && target.pod.name === selectedName)?.pod
          const stalePod = previousPod ?? { name: selectedName, namespace, phase: 'Running' as const, containers: pods[0]?.containers ?? [] }
          const fallbackPod = findFallbackPod(stalePod, pods, containerFor(stalePod.containers))
          if (fallbackPod) {
            replaceSelectedPod(context, namespace, selectedName, fallbackPod.name)
            log.recordActionDebug(`Pod live resolve: ${context}/${namespace}/${selectedName} -> ${fallbackPod.name}`)
            resolved.push({ context, namespace, pod: fallbackPod })
          }
        }
      }
      return resolved
    }

    const resolveFallbackTarget = async (target: typeof targets[number], container: string) => {
      await useKubeStore.getState().refreshPodsForSelections()
      const key = scopeKey(target.context, target.namespace)
      const refreshedPods = useKubeStore.getState().podsByScope[key] ?? []
      if (refreshedPods.some((pod) => pod.name === target.pod.name)) return undefined
      const fallbackPod = findFallbackPod(target.pod, refreshedPods, container)
      if (!fallbackPod) return undefined
      replaceSelectedPod(target.context, target.namespace, target.pod.name, fallbackPod.name)
      log.recordActionDebug(`Pod fallback: ${target.context}/${target.namespace}/${target.pod.name} -> ${fallbackPod.name}`)
      return { ...target, pod: fallbackPod }
    }

    const launch = async (target: typeof targets[number], selectedSourceType: SourceLogType) => {
      const container = containerFor(target.pod.containers)
      const filePath = buildScloudLogPath(target.namespace, target.pod.name, selectedSourceType)
      const streamId = crypto.randomUUID(); const sourceId = `${target.context}/${target.namespace}/${target.pod.name}/${container}/${selectedSourceType}/${filePath}`
      log.prepareStarting({ streamId, sourceId, context: target.context, namespace: target.namespace, pod: target.pod.name, container, filePath, sourceType: selectedSourceType, initialTailLines: settings.initialTailLines })
      try {
        await startLogStream({ streamId, context: target.context, namespace: target.namespace, pod: target.pod.name, container, filePath, sourceType: selectedSourceType, initialTailLines: settings.initialTailLines })
        if (!useLogStore.getState().activeStreamIds.includes(streamId)) {
          try { await stopLogStream(streamId) } catch { /* best-effort cleanup for cancelled start */ }
          return { status: 'cancelled' as const, container }
        }
        log.markRunning(streamId)
        return { status: 'started' as const, container }
      } catch (error) {
        log.markStartRejected(streamId, error)
        return { status: 'failed' as const, container }
      }
    }

    const liveTargets = await resolveLiveTargetsForStart()
    if (liveTargets.length === 0) { log.markError(undefined, 'No live pod found for selected target'); return }

    for (const originalTarget of liveTargets) {
      let target = originalTarget
      for (const selectedSourceType of selectedSourceTypes) {
        const result = await launch(target, selectedSourceType)
        if (result.status === 'cancelled') return
        if (result.status === 'started') continue
        const fallbackTarget = await resolveFallbackTarget(target, result.container)
        if (!fallbackTarget) continue
        target = fallbackTarget
        const retry = await launch(target, selectedSourceType)
        if (retry.status === 'cancelled') return
      }
    }
  }
  const stop = async () => {
    const ids = log.activeStreamIds.length ? log.activeStreamIds : log.activeStreamId ? [log.activeStreamId] : []
    log.recordActionDebug(`Stop clicked: status=${log.streamStatus}, activeStreamIds=${ids.join(', ') || '(none)'}`)
    if (!ids.length) { log.markError(undefined, 'No active stream to stop'); return }
    await Promise.all(ids.map(async (id) => { log.markStopping(id); try { await stopLogStream(id); log.markStopped(id) } catch (e) { log.markError(id, e instanceof Error ? e.message : String(e)) } }))
  }
  const restart = async () => {
    log.recordActionDebug('Restart clicked')
    const ids = log.activeStreamIds.length ? log.activeStreamIds : log.activeStreamId ? [log.activeStreamId] : []
    await Promise.all(ids.map(async (id) => { log.markStopping(id); try { await stopLogStream(id); log.markStopped(id) } catch (e) { log.markError(id, e instanceof Error ? e.message : String(e)) } }))
    await start(true)
  }
  return <section aria-label="Log stream controls" className="grid shrink-0 grid-cols-[minmax(24rem,1.2fr)_minmax(22rem,1fr)_minmax(26rem,1.15fr)] gap-2 border-b border-slate-800 bg-slate-900 px-2 py-2">
    <div aria-label="Stream controls" className="rounded border border-slate-800 bg-slate-950/60 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Stream controls</span>
        <AnimatedStatusPill active={operationActive} label={operationLabel} detail={operationDetail} />
      </div>
      <div className="flex items-center gap-2">
        {onSourceTypesChange && <LogTypeSelector value={selectedSourceTypes} onChange={onSourceTypesChange} />}
        <button className="rounded border border-yellow-400 bg-yellow-300 px-3 py-1 text-sm font-semibold text-slate-950 hover:bg-yellow-200 disabled:cursor-not-allowed disabled:opacity-50" disabled={startBusy || alreadyRunning} title={startBlockedReason} onClick={() => void start()}>Start</button>
        <button className="rounded border border-red-500/70 px-3 py-1 text-sm font-semibold text-red-100 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50" disabled={stopBusy} onClick={stop}>Stop</button>
        <button className="rounded border border-orange-400/70 px-3 py-1 text-sm font-semibold text-orange-100 hover:bg-orange-400/10 disabled:cursor-not-allowed disabled:opacity-50" disabled={startBusy || stopBusy} onClick={() => void restart()}>Restart</button>
      </div>
      {operationActive && <div className="mt-2"><ProgressStripe label={`${operationLabel} progress`} /></div>}
    </div>

    <div aria-label="Viewer controls" className="rounded border border-slate-800 bg-slate-950/60 p-2">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Viewer controls</div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="rounded border border-slate-600 px-3 py-1 text-sm text-slate-100 hover:bg-slate-800" onClick={() => {
          log.recordActionDebug(`${log.viewerPaused ? 'Resume' : 'Pause'} clicked`)
          if (log.viewerPaused) log.resume()
          else log.pause()
        }}>{log.viewerPaused ? 'Resume' : 'Pause'}</button>
        <button className="rounded border border-slate-600 px-3 py-1 text-sm text-slate-100 hover:bg-slate-800" onClick={() => { log.recordActionDebug('Clear clicked'); log.clear() }}>Clear</button>
        <label className="inline-flex items-center gap-1 text-sm text-slate-200"><input type="checkbox" checked={log.autoScrollEnabled} onChange={e=>{ log.recordActionDebug(`Auto-scroll changed: ${e.target.checked}`); log.setAutoScrollEnabled(e.target.checked) }} /> Auto-scroll</label>
        <label className="inline-flex items-center gap-1 text-sm text-slate-200"><input type="checkbox" checked={log.reconnectEnabled} onChange={e=>{ log.recordActionDebug(`Reconnect changed: ${e.target.checked}`); log.setReconnectEnabled(e.target.checked) }} /> Auto-reconnect</label>
      </div>
    </div>

    <div aria-label="Runtime status" className="rounded border border-slate-800 bg-slate-950/60 p-2">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Runtime status</div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <span className="rounded border border-slate-800 bg-slate-900 px-2 py-1"><span className="text-slate-500">Targets</span><strong className="ml-2 text-slate-100">{targets.length}</strong></span>
        <span className="rounded border border-slate-800 bg-slate-900 px-2 py-1"><span className="text-slate-500">Status</span><strong className="ml-2 text-slate-100">{log.streamStatus}</strong></span>
        <span className="rounded border border-slate-800 bg-slate-900 px-2 py-1"><span className="text-slate-500">Start</span><strong className="ml-2 text-slate-100">{startBusy || alreadyRunning ? 'disabled' : 'enabled'}</strong></span>
      </div>
      <p className="mt-2 truncate text-xs text-slate-400" title={startBlockedReason}>Start: {startBusy || alreadyRunning ? 'disabled' : 'enabled'}{startBlockedReason ? ` (${startBlockedReason})` : ''}</p>
      {log.latestStderr && <p className="mt-1 truncate text-xs text-yellow-300" title={log.latestStderr}>stderr: {log.latestStderr}</p>}
      {log.totalDroppedCount > 0 && <p className="mt-1 text-xs text-yellow-300">Dropped: {log.totalDroppedCount}</p>}
    </div>
  </section>
}
