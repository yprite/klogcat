import type { SourceLogType } from '../types/log'

export function buildScloudLogPath(namespace: string, pod: string, sourceType: SourceLogType) {
  const suffix = sourceType === 'app' ? '' : sourceType === 'access' ? '_ACC' : '_ERR'
  return `/scloud/${namespace}/logs/${pod}/${namespace}${suffix}.log`
}
