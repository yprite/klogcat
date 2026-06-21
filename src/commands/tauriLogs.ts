import { invoke } from '@tauri-apps/api/core'
import type { SourceLogType } from '../types/log'
export type StartLogStreamRequest = { streamId: string; namespace: string; pod: string; container: string; sourceType: SourceLogType; filePath: string; initialTailLines: number }
export const startLogStream = (request: StartLogStreamRequest) => invoke<void>('start_log_stream', { request })
export const stopLogStream = (streamId: string) => invoke<void>('stop_log_stream', { streamId })
export const stopAllLogStreams = () => invoke<void>('stop_all_log_streams')
