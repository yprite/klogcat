import type { PersistedSettings } from '../types/settings'

export const defaultSettings: PersistedSettings = {
  schemaVersion: 1,
  initialTailLines: 200,
  bufferLimit: 50_000,
  logSources: {
    app: { container: 'app', filePath: '/scloud/[namespace]/logs/[podname]/[namespace].log' },
    access: { container: 'app', filePath: '/scloud/[namespace]/logs/[podname]/[namespace]_ACC.log' },
    error: { container: 'app', filePath: '/scloud/[namespace]/logs/[podname]/[namespace]_ERR.log' },
  },
}
