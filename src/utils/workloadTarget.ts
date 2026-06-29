export type TargetMode = 'pod' | 'workload' | 'labelSelector'
export type SupportedWorkloadKind = 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'ReplicaSet'
export type LabelSelector = {
  matchLabels?: Record<string, string>
  matchExpressions?: Array<{ key: string; operator: string; values?: string[] }>
}
export type WorkloadTargetRef = {
  kind: SupportedWorkloadKind
  name: string
  namespace: string
  selector?: LabelSelector
}
export type SelectorResolutionResult =
  | { ok: true; selector: string }
  | { ok: false; reason: 'missing_selector' | 'unsupported_selector' }
export type UnsupportedServiceTarget = {
  ok: false
  reason: 'unsupported_service_target'
  message: string
}

export function resolveWorkloadSelector(workload: WorkloadTargetRef): SelectorResolutionResult {
  const selector = workload.selector
  if (!selector?.matchLabels || Object.keys(selector.matchLabels).length === 0) return { ok: false, reason: 'missing_selector' }
  if (selector.matchExpressions && selector.matchExpressions.length > 0) return { ok: false, reason: 'unsupported_selector' }
  return {
    ok: true,
    selector: Object.entries(selector.matchLabels)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join(','),
  }
}

export function serviceTargetHandoff(serviceName: string): UnsupportedServiceTarget {
  return {
    ok: false,
    reason: 'unsupported_service_target',
    message: `Service targets are not supported in Workload Follow MVP. Choose the owning workload or paste a bounded label selector for service ${serviceName}.`,
  }
}
