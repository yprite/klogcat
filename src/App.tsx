import { useEffect, useState } from 'react'
import { AppShell } from './components/AppShell'
import { useLogStore } from './stores/logStore'
import { subscribeLogEvents } from './commands/tauriLogEvents'
import { startLogStream } from './commands/tauriLogs'
import type { LogStreamExitEvent } from './types/log'

function nextReconnectStreamId(oldStreamId: string) {
  return `${oldStreamId}-retry-${crypto.randomUUID()}`
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
    if (reconnectStream(e)) return
    store.markError(e.streamId, `stream terminated by signal ${e.signal}`)
    return
  }
  if (e.exitCode === undefined || e.exitCode === null) {
    if (reconnectStream(e)) return
    store.markError(e.streamId, 'stream exited without an exit code')
    return
  }
  if (e.exitCode !== 0) {
    if (reconnectStream(e)) return
    store.markError(e.streamId, `stream exited with code ${e.exitCode}`)
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
