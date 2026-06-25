import type { SourceLogType } from '../types/log'
import { buildLogPathFromPolicy, defaultLogPolicy } from './logPolicy'

export function buildScloudLogPath(namespace: string, pod: string, sourceType: SourceLogType) {
  return buildLogPathFromPolicy(defaultLogPolicy, namespace, pod, sourceType)
}
