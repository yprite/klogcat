import { useEffect, useState } from 'react'
import { AppShell } from './components/AppShell'
import { useLogStore } from './stores/logStore'
import { subscribeLogEvents } from './commands/tauriLogEvents'
import type { LogStreamExitEvent } from './types/log'

export function handleLogExit(e: LogStreamExitEvent) {
  const store = useLogStore.getState()
  if (e.requestedStop) {
    store.markStopped(e.streamId)
    return
  }
  if (e.signal) {
    store.markError(e.streamId, `stream terminated by signal ${e.signal}`)
    return
  }
  if (e.exitCode === undefined || e.exitCode === null) {
    store.markError(e.streamId, 'stream exited without an exit code')
    return
  }
  if (e.exitCode !== 0) {
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
