import { invoke, isTauri } from '@tauri-apps/api/core'
import type { SourceLogType } from '../types/log'
import type { VmLogStreamConfig } from '../types/vm'

export type StartLogStreamRequest = { streamId: string; targetKind?: 'kubernetes' | 'aws-vm'; context?: string; namespace: string; pod: string; container: string; sourceType: SourceLogType; filePath: string; initialTailLines: number; vm?: VmLogStreamConfig }
export type CheckLogPathRequest = { context?: string; namespace: string; pod: string; container: string; sourceType: SourceLogType; filePath: string }
export type CheckLogPathResult = { exists: boolean; message?: string }

const tauriUnavailable = () => Promise.reject(new Error('Tauri runtime is unavailable; run the desktop app to start log streams'))

export const startLogStream = (request: StartLogStreamRequest) => isTauri()
  ? invoke<void>('start_log_stream', { request })
  : tauriUnavailable()
export const checkLogPath = (request: CheckLogPathRequest) => isTauri()
  ? invoke<CheckLogPathResult>('check_log_path', { request })
  : tauriUnavailable()
export const stopLogStream = (streamId: string) => isTauri()
  ? invoke<void>('stop_log_stream', { streamId })
  : Promise.resolve()
export const stopAllLogStreams = () => isTauri()
  ? invoke<void>('stop_all_log_streams')
  : Promise.resolve()
