import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCurrentContext, listContexts, listNamespaces, listPods } from '../../commands/tauriKube'
import { parseScopeKey, scopeKey, useKubeStore } from '../../stores/kubeStore'
import { clearKubeCache, writeKubeCache } from '../../utils/kubeCache'

vi.mock('../../commands/tauriKube', () => ({
  getCurrentContext: vi.fn(async () => 'ctx'),
  listContexts: vi.fn(async () => ({ contexts: [{ name: 'ctx' }, { name: 'prod' }] })),
  listNamespaces: vi.fn(async (context?: string) => ({ context, namespaces: [{ name: context === 'prod' ? 'live' : 'foo' }] })),
  listPods: vi.fn(async (namespace: string, context?: string) => ({
    context,
    namespace,
    pods: [{ name: `${namespace}-api-7d9c8f6b8d-x2abc`, namespace, phase: 'Running', containers: ['app'] }],
  })),
}))

function installLocalStorageMock() {
  let store: Record<string, string> = {}
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value },
      removeItem: (key: string) => { delete store[key] },
      clear: () => { store = {} },
      key: (index: number) => Object.keys(store)[index] ?? null,
      get length() { return Object.keys(store).length },
    },
  })
}

function resetKubeStore() {
  useKubeStore.setState({
    contexts: [],
    currentContext: undefined,
    selectedContext: undefined,
    selectedContexts: [],
    namespaces: [],
    namespacesByContext: {},
    selectedNamespace: undefined,
    selectedNamespaces: {},
    pods: [],
    podsByScope: {},
    selectedPod: undefined,
    selectedPods: {},
    selectedWorkloads: {},
    loadingContexts: false,
    loadingNamespaces: false,
    loadingPods: false,
    cacheLoaded: false,
    cacheRefreshing: false,
    cacheLastRefreshAt: undefined,
    error: undefined,
  })
}

describe('kubernetes store edge scenario', () => {
  beforeEach(() => {
    installLocalStorageMock()
    window.localStorage.clear()
    resetKubeStore()
    vi.clearAllMocks()
    vi.mocked(getCurrentContext).mockResolvedValue('ctx')
    vi.mocked(listContexts).mockResolvedValue({ contexts: [{ name: 'ctx' }, { name: 'prod' }] })
    vi.mocked(listNamespaces).mockImplementation(async (context?: string) => ({ context, namespaces: [{ name: context === 'prod' ? 'live' : 'foo' }] }))
    vi.mocked(listPods).mockImplementation(async (namespace: string, context?: string) => ({
      context,
      namespace,
      pods: [{ name: `${namespace}-api-7d9c8f6b8d-x2abc`, namespace, phase: 'Running', containers: ['app'] }],
    }))
  })

  it('hydrates, skips, clears, and rejects cache states', () => {
    expect(useKubeStore.getState().loadCachedTargets()).toBe(false)
    expect(useKubeStore.getState().cacheLoaded).toBe(true)

    window.localStorage.setItem('klogcat:kube-cache:v1', '{bad json')
    expect(useKubeStore.getState().loadCachedTargets()).toBe(false)

    clearKubeCache()
    writeKubeCache({
      savedAt: 123,
      currentContext: 'ctx',
      contexts: [{ name: 'ctx' }],
      namespacesByContext: { ctx: [{ name: 'foo' }] },
      podsByScope: { [scopeKey('ctx', 'foo')]: [{ name: 'stale', namespace: 'foo', phase: 'Running', containers: ['app'] }] },
    })
    expect(useKubeStore.getState().loadCachedTargets()).toBe(true)
    expect(useKubeStore.getState().podsByScope).toEqual({})
    expect(useKubeStore.getState().shouldRefreshCache(123)).toBe(false)
    useKubeStore.getState().clearCachedTargets()
    expect(useKubeStore.getState().contexts).toEqual([])
  })

  it('executes refresh skip, success, inaccessible, and failure paths', async () => {
    useKubeStore.setState({ cacheRefreshing: true })
    await useKubeStore.getState().refreshAllTargets(true)
    expect(listContexts).not.toHaveBeenCalled()

    useKubeStore.setState({ cacheRefreshing: false, cacheLastRefreshAt: Date.now() })
    await useKubeStore.getState().refreshAllTargets(false)
    expect(listContexts).not.toHaveBeenCalled()

    useKubeStore.setState({ cacheLastRefreshAt: 1 })
    vi.mocked(listContexts).mockResolvedValueOnce({ contexts: [{ name: 'ctx' }, { name: 'blocked' }, { name: 'empty' }, { name: 'prod' }] })
    vi.mocked(listNamespaces).mockImplementationOnce(async () => ({ namespaces: [{ name: 'foo' }] }))
      .mockImplementationOnce(async () => { throw { code: 'blocked', message: 'blocked' } })
      .mockImplementationOnce(async () => ({ namespaces: [] }))
      .mockImplementationOnce(async () => ({ namespaces: [{ name: 'live' }] }))
    await useKubeStore.getState().refreshAllTargets(false)
    expect(useKubeStore.getState().contexts).toEqual([{ name: 'ctx' }, { name: 'prod' }])
    expect(useKubeStore.getState().namespacesByContext.blocked).toBeUndefined()

    vi.mocked(listContexts).mockRejectedValueOnce({ code: 'contexts_failed', message: 'contexts failed' })
    await useKubeStore.getState().refreshAllTargets(true)
    expect(useKubeStore.getState().error?.message).toBe('contexts failed')
  })

  it('executes current context, context list, namespace, pod, and selection edge paths', async () => {
    await useKubeStore.getState().loadCurrentContext()
    expect(useKubeStore.getState().selectedContext).toBe('ctx')
    vi.mocked(getCurrentContext).mockRejectedValueOnce({ code: 'current_failed', message: 'current failed' })
    await useKubeStore.getState().loadCurrentContext()
    expect(useKubeStore.getState().error?.message).toBe('current failed')

    await useKubeStore.getState().loadContexts()
    expect(useKubeStore.getState().contexts).toEqual([{ name: 'ctx' }, { name: 'prod' }])
    vi.mocked(listContexts).mockRejectedValueOnce({ code: 'contexts_failed', message: 'contexts failed' })
    await useKubeStore.getState().loadContexts()
    expect(useKubeStore.getState().error?.message).toBe('contexts failed')

    useKubeStore.setState({ selectedContext: undefined, currentContext: undefined })
    await useKubeStore.getState().loadNamespaces()
    expect(useKubeStore.getState().loadingNamespaces).toBe(false)

    useKubeStore.setState({ selectedContext: 'ctx', contexts: [{ name: 'ctx' }, { name: 'prod' }] })
    await useKubeStore.getState().loadNamespaces()
    expect(useKubeStore.getState().namespaces).toEqual([{ name: 'foo' }])
    await useKubeStore.getState().selectNamespace('foo')
    expect(useKubeStore.getState().selectedNamespaces).toEqual({ ctx: ['foo'] })
    vi.mocked(listNamespaces).mockRejectedValueOnce({ code: 'namespaces_failed', message: 'namespaces failed' })
    await useKubeStore.getState().loadNamespaces('prod')
    expect(useKubeStore.getState().contexts).toEqual([{ name: 'ctx' }])

    await useKubeStore.getState().selectContext('')
    expect(useKubeStore.getState().selectedContexts).toEqual([])
    useKubeStore.setState({
      contexts: [{ name: 'ctx' }, { name: 'prod' }],
      selectedNamespaces: { ctx: ['foo'], prod: ['live'] },
      selectedPods: { [scopeKey('prod', 'live')]: ['live-api-7d9c8f6b8d-x2abc'] },
      selectedWorkloads: { [scopeKey('prod', 'live')]: ['live-api'] },
      podsByScope: { [scopeKey('prod', 'live')]: [{ name: 'live-api-7d9c8f6b8d-x2abc', namespace: 'live', phase: 'Running', containers: ['app'] }] },
    })
    await useKubeStore.getState().selectContexts(['prod'])
    expect(useKubeStore.getState().selectedPods).toEqual({ [scopeKey('prod', 'live')]: ['live-api-7d9c8f6b8d-x2abc'] })
    expect(useKubeStore.getState().selectedWorkloads).toEqual({ [scopeKey('prod', 'live')]: ['live-api'] })
    useKubeStore.setState({ contexts: undefined as never })
    await useKubeStore.getState().ensureNamespacesForContexts(['broken'])
    expect(useKubeStore.getState().loadingNamespaces).toBe(false)
    resetKubeStore()
    useKubeStore.setState({ contexts: [{ name: 'ctx' }], selectedContext: 'ctx' })
    await useKubeStore.getState().selectNamespaces([])
    expect(useKubeStore.getState().loadingPods).toBe(false)

    const key = scopeKey('ctx', 'foo')
    await useKubeStore.getState().selectNamespaces([key])
    expect(useKubeStore.getState().podsByScope[key]?.[0].name).toContain('foo-api')
    vi.mocked(listPods).mockRejectedValueOnce({ code: 'refresh_pods_failed', message: 'refresh pods failed' })
    await useKubeStore.getState().refreshPodsForSelections()
    expect(useKubeStore.getState().error?.message).toBe('refresh pods failed')
    vi.mocked(listPods).mockRejectedValueOnce({ code: 'pods_failed', message: 'pods failed' })
    await useKubeStore.getState().selectNamespaces([key])
    expect(useKubeStore.getState().error?.message).toBe('pods failed')

    useKubeStore.setState({ selectedContext: undefined, currentContext: undefined })
    await useKubeStore.getState().loadPods('foo')
    expect(useKubeStore.getState().loadingPods).toBe(false)
    vi.mocked(listPods).mockRejectedValueOnce({ code: 'pods_failed', message: 'pods failed' })
    await useKubeStore.getState().loadPods('foo', 'ctx')
    expect(useKubeStore.getState().error?.message).toBe('pods failed')

    useKubeStore.setState({ selectedContext: 'ctx', currentContext: 'ctx', selectedNamespace: 'foo' })
    useKubeStore.getState().selectPod('api-7d9')
    expect(useKubeStore.getState().selectedPods[scopeKey('ctx', 'foo')]).toEqual(['api-7d9'])
    useKubeStore.getState().selectPod('')
    expect(useKubeStore.getState().selectedPods).toEqual({})

    useKubeStore.setState({ selectedContext: undefined, selectedNamespace: undefined })
    useKubeStore.getState().selectPod('loose-pod')
    expect(useKubeStore.getState().selectedPod).toBe('loose-pod')
    useKubeStore.getState().selectPods(['bad', `${key}\u0000api-7d9c8f6b8d-old`])
    expect(parseScopeKey(key)).toEqual({ context: 'ctx', namespace: 'foo' })
    useKubeStore.setState({
      selectedPods: {},
      selectedWorkloads: { [key]: ['foo-api'] },
      podsByScope: { [key]: [
        { name: 'foo-api-64cc9db7fd-z9999', namespace: 'foo', phase: 'Running', containers: ['app'] },
        { name: 'foo-api-64cc9db7fd-a1111', namespace: 'foo', phase: 'Running', containers: ['app'] },
      ] },
    })
    expect(useKubeStore.getState().getSelectedPodTargets()[0]?.pod.name).toBe('foo-api-64cc9db7fd-a1111')
    useKubeStore.setState({
      selectedWorkloads: {},
      selectedContext: 'ctx',
      selectedNamespace: 'foo',
      selectedPod: 'fallback-pod',
      pods: [{ name: 'fallback-pod', namespace: 'foo', phase: 'Running', containers: ['app'] }],
    })
    expect(useKubeStore.getState().getSelectedPodTargets()[0]?.pod.name).toBe('fallback-pod')
  })
})
