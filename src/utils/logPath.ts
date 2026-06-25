import type { SourceLogType } from '../types/log'
import { buildLogPathFromPolicy, getLogPolicy } from './logPolicy'

export function buildScloudLogPath(namespace: string, pod: string, sourceType: SourceLogType) {
  return buildLogPathFromPolicy(getLogPolicy(), namespace, pod, sourceType)
}
