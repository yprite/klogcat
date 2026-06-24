import { beforeEach, describe, expect, it, vi } from 'vitest'
import { scopeKey, useKubeStore } from '../stores/kubeStore'
import { listNamespaces } from '../commands/tauriKube'

vi.mock('../commands/tauriKube', () => ({
  getCurrentContext: vi.fn(),
  listContexts: vi.fn(),
  listNamespaces: vi.fn(async (context: string) => ({ namespaces: [{ name: context === 'cluster-a' ? 'prod' : 'default' }] })),
  listPods: vi.fn(),
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
    error: undefined,
  })
}

describe('kubeStore context selection', () => {
  beforeEach(() => resetKubeStore())

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
    useKubeStore.setState({ namespacesByContext: { ctx: [{ name: 'default' }] } })

    await useKubeStore.getState().ensureNamespacesForContexts(['ctx', 'cluster-a'])

    expect(listNamespaces).toHaveBeenCalledTimes(1)
    expect(listNamespaces).toHaveBeenCalledWith('cluster-a')
    expect(useKubeStore.getState().namespacesByContext).toEqual({ ctx: [{ name: 'default' }], 'cluster-a': [{ name: 'prod' }] })
  })
})
