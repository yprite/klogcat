import type { PersistedSettings } from '../types/settings'
import { defaultLogSourcesFromPolicy, getLogPolicy } from '../utils/logPolicy'

export const defaultSettings: PersistedSettings = {
  schemaVersion: 1,
  initialTailLines: 200,
  bufferLimit: 50_000,
  logSources: defaultLogSourcesFromPolicy(getLogPolicy()),
  logPolicy: getLogPolicy(),
}
