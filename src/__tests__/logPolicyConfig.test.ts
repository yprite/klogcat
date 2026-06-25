import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildScloudLogPath } from '../utils/logPath'
import { defaultLogPolicy, getLogPolicy, loadLogPolicyConfig, setActiveLogPolicy } from '../utils/logPolicy'

describe('runtime log policy config', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    setActiveLogPolicy(defaultLogPolicy)
  })

  it('loads log policy from a runtime JSON config file and activates it', async () => {
    const runtimePolicy = {
      ...defaultLogPolicy,
      pathTemplate: '/runtime/[namespace]/[podname]/[namespace][suffix].log',
      sources: {
        ...defaultLogPolicy.sources,
        access: { ...defaultLogPolicy.sources.access, pathSuffix: '_RUNTIME_ACC' },
      },
      grouping: { ...defaultLogPolicy.grouping, correlationFields: ['spanId'] },
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(runtimePolicy), { status: 200 })))

    const result = await loadLogPolicyConfig('/log-policy.json')

    expect(result).toEqual({ loaded: true, source: '/log-policy.json' })
    expect(getLogPolicy().grouping.correlationFields).toEqual(['spanId'])
    expect(buildScloudLogPath('demo', 'pod-1', 'access')).toBe('/runtime/demo/pod-1/demo_RUNTIME_ACC.log')
  })

  it('keeps the embedded default policy when runtime config cannot be loaded', async () => {
    const stalePolicy = {
      ...defaultLogPolicy,
      pathTemplate: '/stale/[namespace]/[podname]/[namespace][suffix].log',
    }
    setActiveLogPolicy(stalePolicy)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404 })))

    const result = await loadLogPolicyConfig('/missing-log-policy.json')

    expect(result.loaded).toBe(false)
    expect(result.source).toBe('/missing-log-policy.json')
    expect(getLogPolicy()).toBe(defaultLogPolicy)
  })

  it('rejects malformed runtime policies and restores the embedded default', async () => {
    const malformedPolicy = {
      ...defaultLogPolicy,
      query: { ...defaultLogPolicy.query, suggestions: {} },
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(malformedPolicy), { status: 200 })))

    const result = await loadLogPolicyConfig('/bad-log-policy.json')

    expect(result.loaded).toBe(false)
    expect(result.error).toContain('query.suggestions')
    expect(getLogPolicy()).toBe(defaultLogPolicy)
  })
})
