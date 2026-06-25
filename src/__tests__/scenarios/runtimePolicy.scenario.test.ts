import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildScloudLogPath } from '../../utils/logPath'
import { defaultLogPolicy, getLogPolicy, loadLogPolicyConfig, setActiveLogPolicy } from '../../utils/logPolicy'
import { sourceLabelsForActivePolicy, sourceTypesForActivePolicy } from '../../utils/sourceLabels'

describe('runtime log policy scenario', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    setActiveLogPolicy(defaultLogPolicy)
  })

  it('loads runtime policy and applies it across path, labels, and source discovery', async () => {
    const runtimePolicy = {
      ...defaultLogPolicy,
      pathTemplate: '/runtime/[namespace]/pods/[podname]/[namespace][suffix].jsonl',
      sources: {
        ...defaultLogPolicy.sources,
        access: { ...defaultLogPolicy.sources.access, label: 'RUNTIME_ACC', pathSuffix: '_runtime_acc' },
        error: { ...defaultLogPolicy.sources.error, label: 'RUNTIME_ERR', pathSuffix: '_runtime_err' },
      },
      grouping: {
        ...defaultLogPolicy.grouping,
        correlationFields: ['spanId'],
      },
    }

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(runtimePolicy), { status: 200 })))

    await expect(loadLogPolicyConfig('/log-policy.json')).resolves.toEqual({ loaded: true, source: '/log-policy.json' })

    expect(getLogPolicy().grouping.correlationFields).toEqual(['spanId'])
    expect(sourceTypesForActivePolicy()).toEqual(['info', 'access', 'error'])
    expect(sourceLabelsForActivePolicy().access).toBe('RUNTIME_ACC')
    expect(sourceLabelsForActivePolicy().error).toBe('RUNTIME_ERR')
    expect(buildScloudLogPath('demo', 'api-123', 'access')).toBe('/runtime/demo/pods/api-123/demo_runtime_acc.jsonl')
    expect(buildScloudLogPath('demo', 'api-123', 'error')).toBe('/runtime/demo/pods/api-123/demo_runtime_err.jsonl')
  })
})
