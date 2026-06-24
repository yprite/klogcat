import { useState } from 'react'
import type { SourceLogType } from '../types/log'
import { useKubeStore } from '../stores/kubeStore'
import { useLogStore } from '../stores/logStore'
import { useSettingsStore } from '../stores/settingsStore'
import { startLogStream, stopLogStream } from '../commands/tauriLogs'
import { buildScloudLogPath } from '../utils/logPath'

export function LogToolbar({ sourceType, sourceTypes }: { sourceType?: SourceLogType; sourceTypes?: SourceLogType[] }) {
  const selectedSourceTypes: SourceLogType[] = sourceTypes ?? [sourceType ?? 'info']
  const primarySourceType = selectedSourceTypes[0] ?? 'info'
  const kube = useKubeStore(); const { settings } = useSettingsStore(); const log = useLogStore()
  const [containerOverride, setContainerOverride] = useState('')
  const startBusy = log.streamStatus === 'starting' || log.streamStatus === 'stopping'
  const stopBusy = log.streamStatus === 'stopping'
  const alreadyRunning = log.activeStreamIds.length > 0 || log.streamStatus === 'running'
  const source = settings?.logSources[primarySourceType]
  const targets = kube.getSelectedPodTargets()
  const selectedPod = targets[0]?.pod ?? kube.pods.find(p => p.name === kube.selectedPod)
  const podContainers = Array.from(new Set(targets.flatMap((t) => t.pod.containers).concat(selectedPod?.containers ?? [])))
  const containerFor = (containers: string[]) => containerOverride || (source && containers.includes(source.container) ? source.container : containers[0] ?? source?.container ?? '')
  const effectiveContainer = selectedPod ? containerFor(selectedPod.containers) : (containerOverride || source?.container || '')
  const invalidTargets = targets.filter((t) => t.pod.phase !== 'Running' || !containerFor(t.pod.containers))
  const missingSourceConfig = selectedSourceTypes.some((type) => !settings?.logSources[type])
  const disabledReason = !settings ? 'Settings are not loaded' : selectedSourceTypes.length === 0 ? 'Select at least one log type' : missingSourceConfig ? 'Settings are not loaded' : targets.length === 0 ? 'Select namespace and pod' : invalidTargets.length ? 'Every selected pod must be Running and have a container' : ''
  const startBlockedReason = startBusy ? `Busy: ${log.streamStatus}` : alreadyRunning ? 'Stream is already running' : disabledReason
  const start = async (allowRestart = false) => {
    log.recordActionDebug(`Start clicked: status=${log.streamStatus}, targets=${targets.map(t=>`${t.context}/${t.namespace}/${t.pod.name}/${containerFor(t.pod.containers)}`).join(', ') || '(none)'}, sources=${selectedSourceTypes.join(', ') || '(none)'}, startBlockedReason=${startBlockedReason || '(none)'}`)
    if (startBusy) { log.markError(undefined, `Busy: ${log.streamStatus}`); return }
    if (alreadyRunning && !allowRestart) { log.markError(log.activeStreamId, 'Stream is already running'); return }
    if (disabledReason || !settings) { log.markError(undefined, disabledReason || 'invalid_source_config'); return }
    for (const target of targets) {
      const container = containerFor(target.pod.containers)
      for (const selectedSourceType of selectedSourceTypes) {
        const filePath = buildScloudLogPath(target.namespace, target.pod.name, selectedSourceType)
        const streamId = crypto.randomUUID(); const sourceId = `${target.context}/${target.namespace}/${target.pod.name}/${container}/${selectedSourceType}/${filePath}`
        log.prepareStarting({ streamId, sourceId, context: target.context, namespace: target.namespace, pod: target.pod.name, container, filePath, sourceType: selectedSourceType, initialTailLines: settings.initialTailLines })
        try {
          await startLogStream({ streamId, context: target.context, namespace: target.namespace, pod: target.pod.name, container, filePath, sourceType: selectedSourceType, initialTailLines: settings.initialTailLines })
          if (!useLogStore.getState().activeStreamIds.includes(streamId)) {
            try { await stopLogStream(streamId) } catch { /* best-effort cleanup for cancelled start */ }
            return
          }
          log.markRunning(streamId)
        } catch (e) {
          log.markStartRejected(streamId, e)
          void useKubeStore.getState().refreshPodsForSelections()
        }
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
  return <div className="flex flex-wrap gap-2 items-center p-2 bg-slate-900 border-b border-slate-800">
    <label>Container <select className="text-black" value={effectiveContainer} onChange={e=>{ setContainerOverride(e.target.value); log.recordActionDebug(`Container selected: ${e.target.value}`) }}><option value="">Auto per pod</option>{podContainers.map(c=><option key={c} value={c}>{c}</option>)}{source && !podContainers.includes(source.container) && <option value={source.container}>{source.container} (configured)</option>}</select></label>
    <button disabled={startBusy || alreadyRunning} title={startBlockedReason} onClick={() => void start()}>Start</button><button disabled={stopBusy} onClick={stop}>Stop</button><button disabled={startBusy || stopBusy} onClick={() => void restart()}>Restart</button>
    <button onClick={() => { log.recordActionDebug(`${log.viewerPaused ? 'Resume' : 'Pause'} clicked`); log.viewerPaused ? log.resume() : log.pause() }}>{log.viewerPaused ? 'Resume' : 'Pause'}</button><button onClick={() => { log.recordActionDebug('Clear clicked'); log.clear() }}>Clear</button>
    <label><input type="checkbox" checked={log.autoScrollEnabled} onChange={e=>{ log.recordActionDebug(`Auto-scroll changed: ${e.target.checked}`); log.setAutoScrollEnabled(e.target.checked) }} /> Auto-scroll</label>
    <label><input type="checkbox" checked={log.reconnectEnabled} onChange={e=>{ log.recordActionDebug(`Reconnect changed: ${e.target.checked}`); log.setReconnectEnabled(e.target.checked) }} /> Auto-reconnect</label>
    <span>Targets: {targets.length}</span><span>Status: {log.streamStatus}</span><span>Start: {startBusy || alreadyRunning ? 'disabled' : 'enabled'}{startBlockedReason ? ` (${startBlockedReason})` : ''}</span>{log.latestStderr && <span className="text-yellow-300">stderr: {log.latestStderr}</span>}{log.totalDroppedCount>0 && <span>Dropped: {log.totalDroppedCount}</span>}
  </div>
}
