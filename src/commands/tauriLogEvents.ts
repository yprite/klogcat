import { listen } from '@tauri-apps/api/event'
import type { LogLineEvent, LogLinesEvent, LogStreamErrorEvent, LogStreamExitEvent, LogStreamStartedEvent, LogStreamStderrEvent } from '../types/log'

export async function subscribeLogEvents(handlers: {
  onStarted: (event: LogStreamStartedEvent) => void
  onLine: (event: LogLineEvent) => void
  onLines?: (event: LogLinesEvent) => void
  onStderr: (event: LogStreamStderrEvent) => void
  onExit: (event: LogStreamExitEvent) => void
  onError: (event: LogStreamErrorEvent) => void
}) {
  const unlisteners = await Promise.all([
    listen<LogStreamStartedEvent>('log://started', (e) => handlers.onStarted(e.payload)),
    listen<LogLinesEvent>('log://lines', (e) => handlers.onLines?.(e.payload)),
    listen<LogLineEvent>('log://line', (e) => handlers.onLine(e.payload)),
    listen<LogStreamStderrEvent>('log://stderr', (e) => handlers.onStderr(e.payload)),
    listen<LogStreamExitEvent>('log://exit', (e) => handlers.onExit(e.payload)),
    listen<LogStreamErrorEvent>('log://error', (e) => handlers.onError(e.payload)),
  ])
  return () => unlisteners.forEach((unlisten) => unlisten())
}
