import { useEffect, useState } from 'react'
import { AppShell } from './components/AppShell'
import { useLogStore } from './stores/logStore'
import { subscribeLogEvents } from './commands/tauriLogEvents'
import { startLogStream } from './commands/tauriLogs'
import type { LogStreamExitEvent } from './types/log'

function reconnectStream(e: LogStreamExitEvent) {
  const store = useLogStore.getState()
  const meta = e.streamId ? store.activeStreamMetas[e.streamId] : undefined
  if (!store.reconnectEnabled || !meta || e.requestedStop) return false
  store.recordActionDebug(`Reconnect scheduled: ${meta.sourceId}`)
  void startLogStream({ streamId: meta.streamId, context: meta.context, namespace: meta.namespace, pod: meta.pod, container: meta.container, sourceType: meta.sourceType, filePath: meta.filePath, initialTailLines: meta.initialTailLines ?? 50 })
    .then(() => useLogStore.getState().markRunning(meta.streamId))
    .catch((error) => useLogStore.getState().markError(meta.streamId, error instanceof Error ? error.message : String(error)))
  return true
}

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
      onStderr: (e) => useLogStore.getState().recordStderr(e.streamId, e.line),
      onExit: handleLogExit,
      onError: (e) => useLogStore.getState().markError(e.streamId, e.message),
    }).then((fn) => { cleanup = fn }).catch((e) => setEventError(String(e)))
    return () => { cleanup?.() }
  }, [])
  return <AppShell eventError={eventError} />
}
