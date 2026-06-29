import type { SourceLogType } from '../types/log'
import type { PodInfo } from '../types/kube'
import type { PersistedSettings } from '../types/settings'
import { defaultSettings } from '../config/defaultSettings'
import { getLogPolicy, buildLogPathFromPolicy } from './logPolicy'

export type SourceValidationState = 'not_checked' | 'valid' | 'missing_container' | 'missing_file_path' | 'unreadable_file_path' | 'tail_unavailable' | 'shell_unavailable' | 'permission_denied' | 'no_rows_yet' | 'parser_mismatch' | 'command_failed'

export type ResolvedStreamTarget = {
  streamTargetId: string
  context: string
  namespace: string
  pod: string
  podUid?: string
  container: string
  sourceType: SourceLogType
  filePath: string
  validationState: SourceValidationState
  diagnostics: string[]
}

type BuildTargetsInput = {
  context: string
  namespace: string
  pods: PodInfo[]
  sourceTypes: SourceLogType[]
  container?: string
  logPolicy?: NonNullable<PersistedSettings['logPolicy']>
}

export const STREAM_TARGET_SOFT_LIMIT = 20
export const STREAM_TARGET_HARD_LIMIT = 50

const streamTargetId = (target: Omit<ResolvedStreamTarget, 'streamTargetId' | 'validationState' | 'diagnostics'>) => [
  target.context,
  target.namespace,
  target.pod,
  target.podUid ?? '',
  target.container,
  target.sourceType,
  target.filePath,
].join('\u0000')

export function buildResolvedStreamTargets(input: BuildTargetsInput): ResolvedStreamTarget[] {
  const policy = input.logPolicy ?? defaultSettings.logPolicy ?? getLogPolicy()
  const container = input.container ?? policy.defaultContainer
  return input.pods.flatMap((pod) => input.sourceTypes.map((sourceType) => {
    const filePath = buildLogPathFromPolicy(policy, input.namespace, pod.name, sourceType)
    const base = {
      context: input.context,
      namespace: input.namespace,
      pod: pod.name,
      container,
      sourceType,
      filePath,
    }
    const hasContainer = pod.containers.includes(container)
    const validationState: SourceValidationState = hasContainer ? 'not_checked' : 'missing_container'
    const diagnostics = hasContainer ? [] : [`container ${container} not found in pod ${pod.name}`]
    return { ...base, streamTargetId: streamTargetId(base), validationState, diagnostics }
  }))
}

export type StreamTargetLimitResult =
  | { ok: true; count: number; softLimit: number; hardLimit: number; requiresConfirmation: boolean }
  | { ok: false; reason: 'stream_target_hard_limit_exceeded'; count: number; softLimit: number; hardLimit: number; narrowingHints: string[] }

export function enforceStreamTargetLimit(targets: readonly ResolvedStreamTarget[]): StreamTargetLimitResult {
  const count = targets.length
  if (count > STREAM_TARGET_HARD_LIMIT) {
    return {
      ok: false,
      reason: 'stream_target_hard_limit_exceeded',
      count,
      softLimit: STREAM_TARGET_SOFT_LIMIT,
      hardLimit: STREAM_TARGET_HARD_LIMIT,
      narrowingHints: ['inspect_pod_list', 'refine_label_selector', 'filter_recent_restarts', 'filter_not_ready', 'filter_newest_pods', 'filter_by_node'],
    }
  }
  return { ok: true, count, softLimit: STREAM_TARGET_SOFT_LIMIT, hardLimit: STREAM_TARGET_HARD_LIMIT, requiresConfirmation: count > STREAM_TARGET_SOFT_LIMIT }
}
