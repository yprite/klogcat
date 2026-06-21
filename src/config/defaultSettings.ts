import type { PersistedSettings } from '../types/settings'

export const defaultSettings: PersistedSettings = {
  schemaVersion: 1,
  initialTailLines: 200,
  bufferLimit: 50_000,
  logSources: {
    app: { container: 'app', filePath: '/var/log/app/info.log' },
    access: { container: 'app', filePath: '/var/log/app/access.log' },
    error: { container: 'app', filePath: '/var/log/app/error.log' },
  },
}
