import type { SourceLogType } from './log'
import type { LogPolicy, LogPolicySelectionId } from '../utils/logPolicy'

export type LogSourceConfig = { container: string; filePath: string }
export type PersistedSettings = {
  schemaVersion: 1
  defaultNamespace?: string
  initialTailLines: number
  bufferLimit: number
  logSources: Record<SourceLogType, LogSourceConfig>
  logPolicyId?: LogPolicySelectionId
  logPolicy?: LogPolicy
}
export type SettingsWarning = { code: 'read_failed' | 'parse_failed'; message: string; details?: string }
export type GetSettingsResponse = { settings: PersistedSettings; warning?: SettingsWarning }
export type SettingsValidationError = { field: string; message: string }
