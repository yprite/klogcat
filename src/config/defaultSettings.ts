import type { PersistedSettings } from '../types/settings'
import { defaultLogSourcesFromPolicy, getLogPolicy } from '../utils/logPolicy'

export const defaultSettings: PersistedSettings = {
  schemaVersion: 1,
  language: 'en',
  initialTailLines: 200,
  bufferLimit: 50_000,
  logSources: defaultLogSourcesFromPolicy(getLogPolicy()),
  logPolicyId: 'scloud',
  logPolicy: getLogPolicy(),
}
