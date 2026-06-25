import { describe, expect, it } from 'vitest'
import { findFallbackPod, stablePodPrefix } from '../utils/podFallback'
import type { PodInfo, PodPhase } from '../types/kube'

const pod = (name: string, containers = ['app'], phase: PodPhase = 'Running'): PodInfo => ({ name, namespace: 'foo', phase, containers })

describe('pod fallback', () => {
  it('derives stable prefixes for deployment and statefulset pod names', () => {
    expect(stablePodPrefix('api-7d9c8f6b8d-x2abc')).toBe('api')
    expect(stablePodPrefix('payment-worker-64cc9db7fd-k9f2p')).toBe('payment-worker')
    expect(stablePodPrefix('redis-0')).toBe('redis')
  })

  it('selects the refreshed running pod with the same workload prefix and container', () => {
    expect(findFallbackPod(pod('api-7d9c8f6b8d-x2abc'), [
      pod('other-64cc9db7fd-k9f2p'),
      pod('api-64cc9db7fd-k9f2p'),
    ], 'app')?.name).toBe('api-64cc9db7fd-k9f2p')
  })

  it('falls back to a unique compatible running pod when the rollout prefix cannot be matched', () => {
    expect(findFallbackPod(pod('old-api'), [pod('new-api')], 'app')?.name).toBe('new-api')
  })

  it('does not guess when multiple compatible pods are available without a prefix match', () => {
    expect(findFallbackPod(pod('old-api'), [pod('new-api-a'), pod('new-api-b')], 'app')).toBeUndefined()
  })
})
