import { describe, expect, it } from 'vitest'
import { resolveWorkloadSelector, serviceTargetHandoff } from '../utils/workloadTarget'

describe('workload target contracts', () => {
  it('serializes matchLabels selectors for supported workload targets', () => {
    expect(resolveWorkloadSelector({
      kind: 'Deployment',
      name: 'checkout',
      namespace: 'prod',
      selector: { matchLabels: { app: 'checkout', tier: 'api' } },
    })).toEqual({ ok: true, selector: 'app=checkout,tier=api' })
  })

  it('rejects matchExpressions instead of silently broadening selectors', () => {
    expect(resolveWorkloadSelector({
      kind: 'Deployment',
      name: 'checkout',
      namespace: 'prod',
      selector: {
        matchLabels: { app: 'checkout' },
        matchExpressions: [{ key: 'track', operator: 'In', values: ['stable'] }],
      },
    })).toEqual({ ok: false, reason: 'unsupported_selector' })
  })

  it('keeps Service targets out of Slice A with a workload or selector handoff', () => {
    expect(serviceTargetHandoff('checkout')).toEqual({
      ok: false,
      reason: 'unsupported_service_target',
      message: 'Service targets are not supported in Workload Follow MVP. Choose the owning workload or paste a bounded label selector for service checkout.',
    })
  })
})
