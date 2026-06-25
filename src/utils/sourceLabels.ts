import type { SourceLogType } from '../types/log'
import { defaultLogPolicy, sourceTypesFromPolicy } from './logPolicy'

export const sourceLabels = Object.fromEntries(
  sourceTypesFromPolicy(defaultLogPolicy).map((sourceType) => [sourceType, defaultLogPolicy.sources[sourceType].label]),
) as Record<SourceLogType, string>

export const sourceTypes: SourceLogType[] = sourceTypesFromPolicy(defaultLogPolicy)
