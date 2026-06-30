export type DiagnosticCommand = {
  executable: 'kubectl'
  argv: string[]
  displayCommand: string
  redactionRequired: boolean
}

export type KubernetesContextSnapshot = {
  context: string
  namespace: string
  pod: string
  podUid?: string
  phase?: string
  node?: string
  owner?: { kind: string; name: string }
  containers: Array<{ name: string; image?: string; ready?: boolean; restartCount?: number; containerId?: string }>
  status: 'complete' | 'partial' | 'no_permission' | 'stale'
  eventsUnavailableReason?: string
}

type RawPod = {
  metadata?: { name?: string; uid?: string; ownerReferences?: Array<{ kind?: string; name?: string }> }
  spec?: { nodeName?: string; containers?: Array<{ name?: string; image?: string }> }
  status?: { phase?: string; containerStatuses?: Array<{ name?: string; ready?: boolean; restartCount?: number; containerID?: string }> }
}

type SummarizeInput = { context: string; namespace: string; pod: RawPod; status?: KubernetesContextSnapshot['status'] }

export function summarizePodContext(input: SummarizeInput): KubernetesContextSnapshot {
  const podName = input.pod.metadata?.name ?? ''
  const statuses = new Map((input.pod.status?.containerStatuses ?? []).map((status) => [status.name, status]))
  return {
    context: input.context,
    namespace: input.namespace,
    pod: podName,
    podUid: input.pod.metadata?.uid,
    phase: input.pod.status?.phase,
    node: input.pod.spec?.nodeName,
    owner: firstOwner(input.pod),
    containers: (input.pod.spec?.containers ?? []).map((container) => {
      const status = statuses.get(container.name)
      return {
        name: container.name ?? '',
        image: container.image,
        ready: status?.ready,
        restartCount: status?.restartCount,
        containerId: status?.containerID,
      }
    }),
    status: input.status ?? 'complete',
  }
}

function firstOwner(pod: RawPod) {
  const owner = pod.metadata?.ownerReferences?.[0]
  return owner?.kind && owner.name ? { kind: owner.kind, name: owner.name } : undefined
}

function shellQuote(value: string) {
  return /^[A-Za-z0-9._/:=-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
}

export function buildDiagnosticCommand(input: { kind: 'podContext' | 'podEvents'; context: string; namespace: string; pod: string }): DiagnosticCommand {
  const argv = input.kind === 'podContext'
    ? ['--context', input.context, 'get', 'pod', '-n', input.namespace, input.pod, '-o', 'json']
    : ['--context', input.context, 'get', 'events.events.k8s.io', '-n', input.namespace, '--field-selector', `involvedObject.name=${input.pod}`, '-o', 'json']
  return {
    executable: 'kubectl',
    argv,
    displayCommand: ['kubectl', ...argv].map(shellQuote).join(' '),
    redactionRequired: false,
  }
}
