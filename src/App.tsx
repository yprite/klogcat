import { useEffect, useState } from 'react'
import { AppShell } from './components/AppShell'
import { useKubeStore, scopeKey } from './stores/kubeStore'
import { useLogStore } from './stores/logStore'
import { subscribeLogEvents } from './commands/tauriLogEvents'
import { startLogStream } from './commands/tauriLogs'
import type { LogStreamExitEvent } from './types/log'
import { buildScloudLogPath } from './utils/logPath'
import { findFallbackPod } from './utils/podFallback'

function nextReconnectStreamId(oldStreamId: string) {
  return `${oldStreamId}-retry-${crypto.randomUUID()}`
}

function isPodNotFoundLine(line: string) {
  return /error from server \(notfound\)|pods? ".+" not found|notfound/i.test(line)
}

function replaceSelectedPod(context: string, namespace: string, stalePod: string, fallbackPod: string) {
  const key = scopeKey(context, namespace)
  const current = useKubeStore.getState().selectedPods[key] ?? []
  const next = current.map((pod) => pod === stalePod ? fallbackPod : pod)
  useKubeStore.setState((state) => ({
    selectedPods: { ...state.selectedPods, [key]: next },
    selectedPod: state.selectedPod === stalePod ? fallbackPod : state.selectedPod,
  }))
}

async function retryWithFallbackPod(e: LogStreamExitEvent) {
  const store = useLogStore.getState()
  const meta = e.streamId ? store.activeStreamMetas[e.streamId] : undefined
  if (!meta || e.requestedStop) return false
  const stderr = store.stderrByStream[e.streamId] ?? []
  if (!stderr.some(isPodNotFoundLine)) return false

  const key = scopeKey(meta.context ?? '', meta.namespace)
  if (!meta.context || !meta.namespace || !meta.pod || !key) return false
  store.recordActionDebug(`Pod not found on stream exit: ${meta.context}/${meta.namespace}/${meta.pod}; refreshing pods`)
  await useKubeStore.getState().refreshPodsForSelections()
  const refreshedPods = useKubeStore.getState().podsByScope[key] ?? []
  const stalePod = { name: meta.pod, namespace: meta.namespace, phase: 'Running' as const, containers: [meta.container].filter(Boolean) }
  const fallbackPod = findFallbackPod(stalePod, refreshedPods, meta.container)
  if (!fallbackPod) {
    store.markError(e.streamId, stderr.at(-1) ?? `stream exited with code ${e.exitCode}`)
    return true
  }

  replaceSelectedPod(meta.context, meta.namespace, meta.pod, fallbackPod.name)
  const streamId = nextReconnectStreamId(meta.streamId)
  const filePath = buildScloudLogPath(meta.namespace, fallbackPod.name, meta.sourceType)
  const sourceId = `${meta.context}/${meta.namespace}/${fallbackPod.name}/${meta.container}/${meta.sourceType}/${filePath}`
  const nextMeta = { ...meta, streamId, sourceId, pod: fallbackPod.name, filePath }
  store.replaceStreamForReconnect(meta.streamId, nextMeta)
  store.recordActionDebug(`Pod fallback on exit: ${meta.context}/${meta.namespace}/${meta.pod} -> ${fallbackPod.name}`)
  void startLogStream({ streamId, context: nextMeta.context, namespace: nextMeta.namespace, pod: nextMeta.pod, container: nextMeta.container, sourceType: nextMeta.sourceType, filePath: nextMeta.filePath, initialTailLines: nextMeta.initialTailLines ?? 50 })
    .then(() => useLogStore.getState().markRunning(streamId))
    .catch((error) => useLogStore.getState().markError(streamId, error instanceof Error ? error.message : String(error)))
  return true
}

function reconnectStream(e: LogStreamExitEvent) {
  const store = useLogStore.getState()
  const meta = e.streamId ? store.activeStreamMetas[e.streamId] : undefined
  if (!store.reconnectEnabled || !meta || e.requestedStop) return false
  const nextMeta = { ...meta, streamId: nextReconnectStreamId(meta.streamId) }
  store.replaceStreamForReconnect(meta.streamId, nextMeta)
  store.recordActionDebug(`Reconnect scheduled: ${meta.sourceId}`)
  void startLogStream({ streamId: nextMeta.streamId, context: nextMeta.context, namespace: nextMeta.namespace, pod: nextMeta.pod, container: nextMeta.container, sourceType: nextMeta.sourceType, filePath: nextMeta.filePath, initialTailLines: nextMeta.initialTailLines ?? 50 })
    .then(() => useLogStore.getState().markRunning(nextMeta.streamId))
    .catch((error) => useLogStore.getState().markError(nextMeta.streamId, error instanceof Error ? error.message : String(error)))
  return true
}

let hasRecordedBatchedLogDebug = false

export function handleLogExit(e: LogStreamExitEvent) {
  const store = useLogStore.getState()
  if (e.requestedStop) {
    store.markStopped(e.streamId)
    return
  }
  if (e.signal) {
    void retryWithFallbackPod(e).then((handled) => {
      if (handled) return
      if (reconnectStream(e)) return
      useLogStore.getState().markError(e.streamId, `stream terminated by signal ${e.signal}`)
    })
    return
  }
  if (e.exitCode === undefined || e.exitCode === null) {
    void retryWithFallbackPod(e).then((handled) => {
      if (handled) return
      if (reconnectStream(e)) return
      useLogStore.getState().markError(e.streamId, 'stream exited without an exit code')
    })
    return
  }
  if (e.exitCode !== 0) {
    void retryWithFallbackPod(e).then((handled) => {
      if (handled) return
      if (reconnectStream(e)) return
      useLogStore.getState().markError(e.streamId, `stream exited with code ${e.exitCode}`)
    })
    return
  }
  store.markStopped(e.streamId)
}

export default function App() {
  const [eventError, setEventError] = useState<string>()
  useEffect(() => {
    let cleanup: undefined | (() => void)
    subscribeLogEvents({
      onStarted: (e) => useLogStore.getState().markRunning(e.streamId),
      onLine: (e) => useLogStore.getState().appendLine(e),
      onLines: (e) => {
        if (!hasRecordedBatchedLogDebug) {
          hasRecordedBatchedLogDebug = true
          useLogStore.getState().recordActionDebug('Receiving batched ordered logs')
        }
        useLogStore.getState().appendLines(e.lines)
      },
      onStderr: (e) => useLogStore.getState().recordStderr(e.streamId, e.line),
      onExit: handleLogExit,
      onError: (e) => useLogStore.getState().markError(e.streamId, e.message),
    }).then((fn) => { cleanup = fn }).catch((e) => setEventError(String(e)))
    return () => { cleanup?.() }
  }, [])
  return <AppShell eventError={eventError} />
}
