import { describe, expect, it } from 'vitest'
import type { PodInfo } from '../types/kube'
import { defaultLogPolicy } from '../utils/logPolicy'
import { buildResolvedStreamTargets, enforceStreamTargetLimit } from '../utils/streamTargets'

const pods: PodInfo[] = [
  { name: 'checkout-1', namespace: 'prod', phase: 'Running', containers: ['app', 'sidecar'] },
  { name: 'checkout-2', namespace: 'prod', phase: 'Running', containers: ['app'] },
]

describe('resolved stream targets', () => {
  it('fans out pods across selected source types with stable stream identity fields', () => {
    expect(buildResolvedStreamTargets({ context: 'kind-dev', namespace: 'prod', pods, sourceTypes: ['info', 'error'] })).toEqual([
      expect.objectContaining({ context: 'kind-dev', namespace: 'prod', pod: 'checkout-1', container: 'app', sourceType: 'info', filePath: '/scloud/prod/logs/checkout-1/prod.log' }),
      expect.objectContaining({ context: 'kind-dev', namespace: 'prod', pod: 'checkout-1', container: 'app', sourceType: 'error', filePath: '/scloud/prod/logs/checkout-1/prod_ERR.log' }),
      expect.objectContaining({ context: 'kind-dev', namespace: 'prod', pod: 'checkout-2', container: 'app', sourceType: 'info', filePath: '/scloud/prod/logs/checkout-2/prod.log' }),
      expect.objectContaining({ context: 'kind-dev', namespace: 'prod', pod: 'checkout-2', container: 'app', sourceType: 'error', filePath: '/scloud/prod/logs/checkout-2/prod_ERR.log' }),
    ])
  })

  it('records a source validation diagnostic instead of silently choosing a missing container', () => {
    expect(buildResolvedStreamTargets({ context: 'kind-dev', namespace: 'prod', pods: [{ ...pods[0], containers: ['sidecar'] }], sourceTypes: ['access'] })).toEqual([
      expect.objectContaining({ sourceType: 'access', validationState: 'missing_container', diagnostics: ['container app not found in pod checkout-1'] }),
    ])
  })

  it('uses the current log policy when resolving stream file paths', () => {
    const targets = buildResolvedStreamTargets({
      context: 'kind-dev',
      namespace: 'prod',
      pods: [pods[0]],
      sourceTypes: ['info'],
      logPolicy: {
        ...defaultLogPolicy,
        defaultContainer: 'sidecar',
        pathTemplate: '/custom/[namespace]/[pod]/[source].log',
      },
    })
    expect(targets[0]).toMatchObject({ container: 'sidecar', filePath: '/custom/prod/checkout-1/info.log', validationState: 'not_checked' })
  })

  it('blocks above the hard target limit and returns narrowing data', () => {
    const targets = Array.from({ length: 51 }, (_, index) => ({ ...pods[0], name: `checkout-${index}` }))
      .flatMap((pod) => buildResolvedStreamTargets({ context: 'kind-dev', namespace: 'prod', pods: [pod], sourceTypes: ['info'] }))
    expect(enforceStreamTargetLimit(targets)).toMatchObject({ ok: false, reason: 'stream_target_hard_limit_exceeded', count: 51, hardLimit: 50 })
  })
})
