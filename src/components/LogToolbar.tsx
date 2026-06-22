import { useState } from 'react'
import type { SourceLogType } from '../types/log'
import { useKubeStore } from '../stores/kubeStore'
import { useLogStore } from '../stores/logStore'
import { useSettingsStore } from '../stores/settingsStore'
import { startLogStream, stopLogStream } from '../commands/tauriLogs'
import { buildScloudLogPath } from '../utils/logPath'

export function LogToolbar({ sourceType }: { sourceType: SourceLogType }) {
  const kube = useKubeStore(); const { settings } = useSettingsStore(); const log = useLogStore()
  const [containerOverride, setContainerOverride] = useState('')
  const busy = ['starting','stopping'].includes(log.streamStatus)
  const alreadyRunning = log.activeStreamIds.length > 0 || log.streamStatus === 'running'
  const source = settings?.logSources[sourceType]
  const targets = kube.getSelectedPodTargets()
  const selectedPod = targets[0]?.pod ?? kube.pods.find(p => p.name === kube.selectedPod)
  const podContainers = Array.from(new Set(targets.flatMap((t) => t.pod.containers).concat(selectedPod?.containers ?? [])))
  const containerFor = (containers: string[]) => containerOverride || (source && containers.includes(source.container) ? source.container : containers[0] ?? source?.container ?? '')
  const effectiveContainer = selectedPod ? containerFor(selectedPod.containers) : (containerOverride || source?.container || '')
  const invalidTargets = targets.filter((t) => t.pod.phase !== 'Running' || !containerFor(t.pod.containers))
  const disabledReason = !settings || !source ? 'Settings are not loaded' : targets.length === 0 ? 'Select namespace and pod' : invalidTargets.length ? 'Every selected pod must be Running and have a container' : ''
  const startBlockedReason = busy ? `Busy: ${log.streamStatus}` : alreadyRunning ? 'Stream is already running' : disabledReason
  const start = async () => {
    log.recordActionDebug(`Start clicked: status=${log.streamStatus}, targets=${targets.map(t=>`${t.context}/${t.namespace}/${t.pod.name}/${containerFor(t.pod.containers)}`).join(', ') || '(none)'}, source=${sourceType}, startBlockedReason=${startBlockedReason || '(none)'}`)
    if (alreadyRunning) { log.markError(log.activeStreamId, 'Stream is already running'); return }
    if (disabledReason || !settings || !source) { log.markError(undefined, disabledReason || 'invalid_source_config'); return }
    for (const target of targets) {
      const container = containerFor(target.pod.containers)
      const filePath = buildScloudLogPath(target.namespace, target.pod.name, sourceType)
      const streamId = crypto.randomUUID(); const sourceId = `${target.context}/${target.namespace}/${target.pod.name}/${container}/${sourceType}/${filePath}`
      log.prepareStarting({ streamId, sourceId, namespace: target.namespace, pod: target.pod.name, container, filePath, sourceType })
      try { await startLogStream({ streamId, context: target.context, namespace: target.namespace, pod: target.pod.name, container, filePath, sourceType, initialTailLines: settings.initialTailLines }); log.markRunning(streamId) } catch (e) { log.markStartRejected(streamId, e) }
    }
  }
  const stop = async () => {
    const ids = log.activeStreamIds.length ? log.activeStreamIds : log.activeStreamId ? [log.activeStreamId] : []
    log.recordActionDebug(`Stop clicked: status=${log.streamStatus}, activeStreamIds=${ids.join(', ') || '(none)'}`)
    if (!ids.length) { log.markError(undefined, 'No active stream to stop'); return }
    await Promise.all(ids.map(async (id) => { log.markStopping(id); try { await stopLogStream(id); log.markStopped(id) } catch (e) { log.markError(id, e instanceof Error ? e.message : String(e)) } }))
  }
  return <div className="flex flex-wrap gap-2 items-center p-2 bg-slate-900 border-b border-slate-800">
    <label>Container <select className="text-black" value={effectiveContainer} onChange={e=>{ setContainerOverride(e.target.value); log.recordActionDebug(`Container selected: ${e.target.value}`) }}><option value="">Auto per pod</option>{podContainers.map(c=><option key={c} value={c}>{c}</option>)}{source && !podContainers.includes(source.container) && <option value={source.container}>{source.container} (configured)</option>}</select></label>
    <button disabled={busy || alreadyRunning} title={startBlockedReason} onClick={start}>Start</button><button disabled={busy} onClick={stop}>Stop</button>
    <button onClick={() => { log.recordActionDebug(`${log.viewerPaused ? 'Resume' : 'Pause'} clicked`); log.viewerPaused ? log.resume() : log.pause() }}>{log.viewerPaused ? 'Resume' : 'Pause'}</button><button onClick={() => { log.recordActionDebug('Clear clicked'); log.clear() }}>Clear</button>
    <label><input type="checkbox" checked={log.autoScrollEnabled} onChange={e=>{ log.recordActionDebug(`Auto-scroll changed: ${e.target.checked}`); log.setAutoScrollEnabled(e.target.checked) }} /> Auto-scroll</label>
    <span>Targets: {targets.length}</span><span>Status: {log.streamStatus}</span><span>Start: {busy || alreadyRunning ? 'disabled' : 'enabled'}{startBlockedReason ? ` (${startBlockedReason})` : ''}</span>{log.latestStderr && <span className="text-yellow-300">stderr: {log.latestStderr}</span>}{log.totalDroppedCount>0 && <span>Dropped: {log.totalDroppedCount}</span>}
  </div>
}
