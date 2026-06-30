import { describe, expect, it } from 'vitest'
import { buildDiagnosticCommand, summarizePodContext } from '../utils/kubernetesContext'

describe('Kubernetes context MVP contracts', () => {
  it('normalizes pod context without exposing raw Kubernetes JSON', () => {
    const snapshot = summarizePodContext({
      context: 'kind-dev',
      namespace: 'prod',
      pod: {
        metadata: { name: 'checkout-1', uid: 'pod-uid-1', ownerReferences: [{ kind: 'ReplicaSet', name: 'checkout-abc' }] },
        spec: { nodeName: 'node-a', containers: [{ name: 'app', image: 'checkout:v1' }] },
        status: { phase: 'Running', containerStatuses: [{ name: 'app', ready: true, restartCount: 2, containerID: 'containerd://abc' }] },
      },
    })
    expect(snapshot).toEqual({
      context: 'kind-dev',
      namespace: 'prod',
      pod: 'checkout-1',
      podUid: 'pod-uid-1',
      phase: 'Running',
      node: 'node-a',
      owner: { kind: 'ReplicaSet', name: 'checkout-abc' },
      containers: [{ name: 'app', image: 'checkout:v1', ready: true, restartCount: 2, containerId: 'containerd://abc' }],
      status: 'complete',
    })
    expect(JSON.stringify(snapshot)).not.toContain('metadata')
  })

  it('renders copyable diagnostics from structured argv only', () => {
    expect(buildDiagnosticCommand({ context: 'kind-dev', namespace: 'prod', pod: 'checkout-1', kind: 'podContext' })).toEqual({
      executable: 'kubectl',
      argv: ['--context', 'kind-dev', 'get', 'pod', '-n', 'prod', 'checkout-1', '-o', 'json'],
      displayCommand: 'kubectl --context kind-dev get pod -n prod checkout-1 -o json',
      redactionRequired: false,
    })
  })
})
