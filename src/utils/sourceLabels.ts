import type { SourceLogType } from '../types/log'

export const sourceLabels: Record<SourceLogType, 'APP' | 'ACC' | 'ERR'> = {
  app: 'APP',
  access: 'ACC',
  error: 'ERR',
}
export const sourceTypes: SourceLogType[] = ['app', 'access', 'error']
