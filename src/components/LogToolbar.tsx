import type { SourceLogType } from '../types/log'
import { useKubeStore } from '../stores/kubeStore'
import { useLogStore } from '../stores/logStore'
import { useSettingsStore } from '../stores/settingsStore'
import { startLogStream, stopLogStream } from '../commands/tauriLogs'

export function LogToolbar({ sourceType }: { sourceType: SourceLogType }) {
  const kube = useKubeStore(); const { settings } = useSettingsStore(); const log = useLogStore()
  const running = ['starting','running','stopping'].includes(log.streamStatus)
  const selectedPod = kube.pods.find(p => p.name === kube.selectedPod)
  const source = settings?.logSources[sourceType]
  const disabledReason = !settings || !source || !kube.selectedNamespace || !kube.selectedPod ? 'Select namespace and pod' : selectedPod?.phase !== 'Running' ? 'Pod is not Running' : !selectedPod.containers.includes(source.container) ? `Container ${source.container} not in pod` : ''
  const start = async () => {
    if (disabledReason || !settings || !source || !kube.selectedNamespace || !kube.selectedPod) { log.markError(undefined, disabledReason || 'invalid_source_config'); return }
    const streamId = crypto.randomUUID(); const sourceId = `${kube.selectedNamespace}/${kube.selectedPod}/${source.container}/${sourceType}/${source.filePath}`
    log.prepareStarting({ streamId, sourceId, namespace: kube.selectedNamespace, pod: kube.selectedPod, container: source.container, filePath: source.filePath, sourceType })
    try { await startLogStream({ streamId, namespace: kube.selectedNamespace, pod: kube.selectedPod, container: source.container, filePath: source.filePath, sourceType, initialTailLines: settings.initialTailLines }); log.markRunning(streamId) } catch (e) { log.markStartRejected(streamId, e) }
  }
  const stop = async () => { const id = log.activeStreamId; if (!id) return; log.markStopping(id); try { await stopLogStream(id); log.markStopped(id) } catch (e) { log.markError(id, e instanceof Error ? e.message : String(e)) } }
  return <div className="flex flex-wrap gap-2 items-center p-2 bg-slate-900 border-b border-slate-800">
    <button disabled={running || !!disabledReason} title={disabledReason} onClick={start}>Start</button><button disabled={!log.activeStreamId} onClick={stop}>Stop</button>
    <button onClick={() => log.viewerPaused ? log.resume() : log.pause()}>{log.viewerPaused ? 'Resume' : 'Pause'}</button><button onClick={() => log.clear()}>Clear</button>
    <label><input type="checkbox" checked={log.autoScrollEnabled} onChange={e=>log.setAutoScrollEnabled(e.target.checked)} /> Auto-scroll</label>
    <span>Status: {log.streamStatus}</span>{log.latestStderr && <span className="text-yellow-300">stderr: {log.latestStderr}</span>}{log.totalDroppedCount>0 && <span>Dropped: {log.totalDroppedCount}</span>}
  </div>
}
