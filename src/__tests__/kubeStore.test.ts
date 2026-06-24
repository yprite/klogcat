import { beforeEach, describe, expect, it, vi } from 'vitest'
import { scopeKey, useKubeStore } from '../stores/kubeStore'
import { getCurrentContext, listContexts, listNamespaces, listPods } from '../commands/tauriKube'
import { writeKubeCache } from '../utils/kubeCache'

const storage = (() => {
  let data: Record<string, string> = {}
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value },
    removeItem: (key: string) => { delete data[key] },
    clear: () => { data = {} },
    key: (index: number) => Object.keys(data)[index] ?? null,
    get length() { return Object.keys(data).length },
  } satisfies Storage
})()
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })

vi.mock('../commands/tauriKube', () => ({
  getCurrentContext: vi.fn(async () => 'ctx'),
  listContexts: vi.fn(async () => ({ contexts: [{ name: 'ctx' }, { name: 'cluster-a' }] })),
  listNamespaces: vi.fn(async (context: string) => ({ namespaces: [{ name: context === 'cluster-a' ? 'prod' : 'default' }] })),
  listPods: vi.fn(async (namespace: string, context: string) => ({ context, namespace, pods: [{ name: `${namespace}-pod`, namespace, phase: 'Running', containers: ['app'] }] })),
}))

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
    loadingContexts: false,
    loadingNamespaces: false,
    loadingPods: false,
    cacheLoaded: false,
    cacheRefreshing: false,
    cacheLastRefreshAt: undefined,
    error: undefined,
  })
}

describe('kubeStore context selection', () => {
  beforeEach(() => { resetKubeStore(); localStorage.clear(); vi.clearAllMocks() })

  it('preserves namespace and pod selections for contexts that remain selected', async () => {
    const clusterScope = scopeKey('cluster-a', 'prod')
    useKubeStore.setState({
      contexts: [{ name: 'ctx' }, { name: 'cluster-a' }],
      selectedContext: 'ctx',
      selectedContexts: ['ctx', 'cluster-a'],
      namespaces: [{ name: 'default' }],
      namespacesByContext: {
        ctx: [{ name: 'default' }],
        'cluster-a': [{ name: 'prod' }],
      },
      selectedNamespace: 'default',
      selectedNamespaces: { ctx: ['default'], 'cluster-a': ['prod'] },
      pods: [{ name: 'api-1', namespace: 'default', phase: 'Running', containers: ['app'] }],
      podsByScope: {
        [scopeKey('ctx', 'default')]: [{ name: 'api-1', namespace: 'default', phase: 'Running', containers: ['app'] }],
        [clusterScope]: [{ name: 'gateway-1', namespace: 'prod', phase: 'Running', containers: ['app'] }],
      },
      selectedPod: 'api-1',
      selectedPods: {
        [scopeKey('ctx', 'default')]: ['api-1'],
        [clusterScope]: ['gateway-1'],
      },
    })

    await useKubeStore.getState().selectContexts(['cluster-a'])

    const next = useKubeStore.getState()
    expect(next.selectedNamespaces).toEqual({ 'cluster-a': ['prod'] })
    expect(next.selectedPods).toEqual({ [clusterScope]: ['gateway-1'] })
    expect(next.podsByScope).toEqual({ [clusterScope]: [{ name: 'gateway-1', namespace: 'prod', phase: 'Running', containers: ['app'] }] })
    expect(next.selectedContext).toBe('cluster-a')
    expect(next.selectedNamespace).toBe('prod')
    expect(next.selectedPod).toBe('gateway-1')
  })

  it('keeps context selection responsive while namespaces load lazily', async () => {
    useKubeStore.setState({ contexts: [{ name: 'ctx' }, { name: 'cluster-a' }], selectedContext: 'ctx', selectedContexts: ['ctx'], namespacesByContext: { ctx: [{ name: 'default' }] } })

    await useKubeStore.getState().selectContexts(['ctx', 'cluster-a'])

    const loading = useKubeStore.getState()
    expect(loading.selectedContexts).toEqual(['ctx', 'cluster-a'])
    expect(loading.namespaces).toEqual([{ name: 'default' }])
    expect(loading.loadingNamespaces).toBe(true)
    await vi.waitFor(() => expect(useKubeStore.getState().namespacesByContext['cluster-a']).toEqual([{ name: 'prod' }]))
  })

  it('loads namespaces only for missing selected contexts', async () => {
    vi.mocked(listNamespaces).mockClear()
    useKubeStore.setState({ contexts: [{ name: 'ctx' }, { name: 'cluster-a' }], namespacesByContext: { ctx: [{ name: 'default' }] } })

    await useKubeStore.getState().ensureNamespacesForContexts(['ctx', 'cluster-a'])

    expect(listNamespaces).toHaveBeenCalledTimes(1)
    expect(listNamespaces).toHaveBeenCalledWith('cluster-a')
    expect(useKubeStore.getState().namespacesByContext).toEqual({ ctx: [{ name: 'default' }], 'cluster-a': [{ name: 'prod' }] })
  })

  it('hides a context when namespace discovery cannot access that cluster', async () => {
    vi.mocked(listNamespaces).mockImplementationOnce(async () => { throw { code: 'list_namespaces_failed', message: 'failed to list namespaces' } })
    useKubeStore.setState({
      contexts: [{ name: 'ctx' }, { name: 'blocked' }],
      selectedContext: 'blocked',
      selectedContexts: ['ctx', 'blocked'],
      namespacesByContext: { ctx: [{ name: 'default' }] },
    })

    await useKubeStore.getState().ensureNamespacesForContexts(['blocked'])

    const state = useKubeStore.getState()
    expect(state.contexts).toEqual([{ name: 'ctx' }])
    expect(state.selectedContexts).toEqual(['ctx'])
    expect(state.selectedContext).toBe('ctx')
    expect(state.namespacesByContext.blocked).toBeUndefined()
  })

  it('excludes inaccessible contexts during full target refresh', async () => {
    vi.mocked(listContexts).mockResolvedValueOnce({ contexts: [{ name: 'ctx' }, { name: 'blocked' }, { name: 'cluster-a' }] })
    vi.mocked(listNamespaces).mockImplementation(async (context?: string) => {
      if (context === 'blocked') throw { code: 'list_namespaces_failed', message: 'failed to list namespaces' }
      return { namespaces: [{ name: context === 'cluster-a' ? 'prod' : 'default' }] }
    })
    useKubeStore.setState({ cacheLastRefreshAt: Date.now() - 25 * 60 * 60 * 1000 })

    await useKubeStore.getState().refreshAllTargets(false)

    expect(useKubeStore.getState().contexts).toEqual([{ name: 'ctx' }, { name: 'cluster-a' }])
    expect(useKubeStore.getState().namespacesByContext.blocked).toBeUndefined()
    expect(listPods).not.toHaveBeenCalledWith(expect.anything(), 'blocked')
  })

  it('uses cached pods when selecting a cached namespace', async () => {
    const key = scopeKey('ctx', 'default')
    useKubeStore.setState({ selectedContext: 'ctx', selectedContexts: ['ctx'], podsByScope: { [key]: [{ name: 'cached-pod', namespace: 'default', phase: 'Running', containers: ['app'] }] } })

    await useKubeStore.getState().selectNamespaces([key])

    expect(listPods).not.toHaveBeenCalled()
    expect(useKubeStore.getState().pods).toEqual([{ name: 'cached-pod', namespace: 'default', phase: 'Running', containers: ['app'] }])
  })

  it('hydrates cached targets before making kubectl calls', () => {
    writeKubeCache({
      savedAt: Date.now(),
      currentContext: 'ctx',
      contexts: [{ name: 'ctx' }],
      namespacesByContext: { ctx: [{ name: 'default' }] },
      podsByScope: { [scopeKey('ctx', 'default')]: [{ name: 'cached-pod', namespace: 'default', phase: 'Running', containers: ['app'] }] },
    })

    const loaded = useKubeStore.getState().loadCachedTargets()

    expect(loaded).toBe(true)
    expect(useKubeStore.getState().contexts).toEqual([{ name: 'ctx' }])
    expect(useKubeStore.getState().namespacesByContext).toEqual({ ctx: [{ name: 'default' }] })
    expect(listContexts).not.toHaveBeenCalled()
    expect(listNamespaces).not.toHaveBeenCalled()
    expect(listPods).not.toHaveBeenCalled()
  })

  it('skips daily refresh when cache is fresh', async () => {
    useKubeStore.setState({ cacheLastRefreshAt: Date.now() })

    await useKubeStore.getState().refreshAllTargets(false)

    expect(getCurrentContext).not.toHaveBeenCalled()
    expect(listContexts).not.toHaveBeenCalled()
  })

  it('refreshes all contexts, namespaces, and pods when cache is stale', async () => {
    useKubeStore.setState({ cacheLastRefreshAt: Date.now() - 25 * 60 * 60 * 1000 })

    await useKubeStore.getState().refreshAllTargets(false)

    expect(getCurrentContext).toHaveBeenCalledTimes(1)
    expect(listContexts).toHaveBeenCalledTimes(1)
    expect(listNamespaces).toHaveBeenCalledWith('ctx')
    expect(listNamespaces).toHaveBeenCalledWith('cluster-a')
    expect(listPods).toHaveBeenCalledWith('default', 'ctx')
    expect(listPods).toHaveBeenCalledWith('prod', 'cluster-a')
    expect(useKubeStore.getState().podsByScope[scopeKey('ctx', 'default')][0].name).toBe('default-pod')
  })
})
