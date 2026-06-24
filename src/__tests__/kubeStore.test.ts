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

describe('kubeStore context selection', () => {
  beforeEach(() => {
    resetKubeStore()
    localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(getCurrentContext).mockImplementation(async () => 'ctx')
    vi.mocked(listContexts).mockImplementation(async () => ({ contexts: [{ name: 'ctx' }, { name: 'cluster-a' }] }))
    vi.mocked(listNamespaces).mockImplementation(async (context?: string) => ({ namespaces: [{ name: context === 'cluster-a' ? 'prod' : 'default' }] }))
    vi.mocked(listPods).mockImplementation(async (namespace: string, context?: string) => ({ context, namespace, pods: [{ name: `${namespace}-pod`, namespace, phase: 'Running', containers: ['app'] }] }))
  })

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

  it('hides a context when no namespaces are pod-accessible', async () => {
    vi.mocked(listNamespaces).mockResolvedValueOnce({ namespaces: [] })
    useKubeStore.setState({
      contexts: [{ name: 'ctx' }, { name: 'empty' }],
      selectedContext: 'ctx',
      selectedContexts: ['ctx', 'empty'],
      namespacesByContext: { ctx: [{ name: 'default' }] },
    })

    await useKubeStore.getState().ensureNamespacesForContexts(['empty'])

    const state = useKubeStore.getState()
    expect(state.contexts).toEqual([{ name: 'ctx' }])
    expect(state.selectedContexts).toEqual(['ctx'])
    expect(state.namespacesByContext.empty).toBeUndefined()
  })

  it('excludes inaccessible contexts during full target refresh', async () => {
    vi.mocked(listContexts).mockResolvedValueOnce({ contexts: [{ name: 'ctx' }, { name: 'blocked' }, { name: 'empty' }, { name: 'cluster-a' }] })
    vi.mocked(listNamespaces).mockImplementation(async (context?: string) => {
      if (context === 'blocked') throw { code: 'list_namespaces_failed', message: 'failed to list namespaces' }
      if (context === 'empty') return { namespaces: [] }
      return { namespaces: [{ name: context === 'cluster-a' ? 'prod' : 'default' }] }
    })
    useKubeStore.setState({ cacheLastRefreshAt: Date.now() - 25 * 60 * 60 * 1000 })

    await useKubeStore.getState().refreshAllTargets(false)

    expect(useKubeStore.getState().contexts).toEqual([{ name: 'ctx' }, { name: 'cluster-a' }])
    expect(useKubeStore.getState().namespacesByContext.blocked).toBeUndefined()
    expect(useKubeStore.getState().namespacesByContext.empty).toBeUndefined()
    expect(listPods).not.toHaveBeenCalledWith(expect.anything(), 'blocked')
    expect(listPods).not.toHaveBeenCalledWith(expect.anything(), 'empty')
  })

  it('loads live pods when selecting a namespace even if stale pods exist in memory', async () => {
    const key = scopeKey('ctx', 'default')
    useKubeStore.setState({ selectedContext: 'ctx', selectedContexts: ['ctx'], podsByScope: { [key]: [{ name: 'cached-pod', namespace: 'default', phase: 'Running', containers: ['app'] }] } })
    vi.mocked(listPods).mockResolvedValueOnce({ context: 'ctx', namespace: 'default', pods: [{ name: 'live-pod', namespace: 'default', phase: 'Running', containers: ['app'] }] })

    await useKubeStore.getState().selectNamespaces([key])

    expect(listPods).toHaveBeenCalledWith('default', 'ctx')
    expect(useKubeStore.getState().pods).toEqual([{ name: 'live-pod', namespace: 'default', phase: 'Running', containers: ['app'] }])
  })

  it('keeps exact selected pods when they are still live and uses workload only for stale selections', () => {
    const key = scopeKey('ctx', 'default')
    useKubeStore.setState({
      selectedContext: 'ctx',
      selectedNamespace: 'default',
      podsByScope: {
        [key]: [
          { name: 'api-7d9c8f6b8d-x2abc', namespace: 'default', phase: 'Running', containers: ['app'] },
          { name: 'api-7d9c8f6b8d-z9999', namespace: 'default', phase: 'Running', containers: ['app'] },
          { name: 'worker-6f87d5b7c9-a1111', namespace: 'default', phase: 'Running', containers: ['app'] },
        ],
      },
    })

    useKubeStore.getState().selectPods([`${key}\u0000api-7d9c8f6b8d-z9999`])
    expect(useKubeStore.getState().selectedWorkloads[key]).toEqual(['api'])
    expect(useKubeStore.getState().getSelectedPodTargets()).toEqual([
      { context: 'ctx', namespace: 'default', pod: { name: 'api-7d9c8f6b8d-z9999', namespace: 'default', phase: 'Running', containers: ['app'] } },
    ])

    useKubeStore.setState({
      podsByScope: {
        [key]: [
          { name: 'api-64cc9db7fd-k9f2p', namespace: 'default', phase: 'Running', containers: ['app'] },
          { name: 'worker-6f87d5b7c9-a1111', namespace: 'default', phase: 'Running', containers: ['app'] },
        ],
      },
    })

    expect(useKubeStore.getState().getSelectedPodTargets()).toEqual([
      { context: 'ctx', namespace: 'default', pod: { name: 'api-64cc9db7fd-k9f2p', namespace: 'default', phase: 'Running', containers: ['app'] } },
    ])
  })

  it('hydrates cached contexts and namespaces but ignores stale cached pods', () => {
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
    expect(useKubeStore.getState().podsByScope).toEqual({})
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
