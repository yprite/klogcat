import type { SourceLogType } from '../types/log'
import { getLogPolicy, sourceTypesFromPolicy } from './logPolicy'

export function sourceLabelsForActivePolicy() {
  const policy = getLogPolicy()
  return Object.fromEntries(
    sourceTypesFromPolicy(policy).map((sourceType) => [sourceType, policy.sources[sourceType].label]),
  ) as Record<SourceLogType, string>
}

export function sourceTypesForActivePolicy(): SourceLogType[] {
  return sourceTypesFromPolicy(getLogPolicy())
}

export const sourceLabels = sourceLabelsForActivePolicy()
export const sourceTypes = sourceTypesForActivePolicy()
