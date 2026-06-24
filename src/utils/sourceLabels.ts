import type { SourceLogType } from '../types/log'

export const sourceLabels: Record<SourceLogType, 'INFO' | 'ACC' | 'ERR'> = {
  info: 'INFO',
  access: 'ACC',
  error: 'ERR',
}
export const sourceTypes: SourceLogType[] = ['info', 'access', 'error']
