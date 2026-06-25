import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '../../config/defaultSettings'
import { assertValidSettings, validateSettings } from '../../config/validateSettings'
import { scopeKey, useKubeStore } from '../../stores/kubeStore'
import { clearKubeCache, isKubeCacheStale, readKubeCache, writeKubeCache } from '../../utils/kubeCache'
import { findFallbackPod, stablePodPrefix } from '../../utils/podFallback'

vi.mock('../../commands/tauriKube', () => ({
  getCurrentContext: vi.fn(async () => 'ctx'),
  listContexts: vi.fn(async () => ({ contexts: [{ name: 'ctx' }, { name: 'blocked' }, { name: 'prod' }] })),
  listNamespaces: vi.fn(async (context?: string) => {
    if (context === 'blocked') throw { code: 'list_namespaces_failed', message: 'blocked' }
    return { context, namespaces: [{ name: context === 'prod' ? 'live' : 'default' }] }
  }),
  listPods: vi.fn(async (namespace: string, context?: string) => ({
    context,
    namespace,
    pods: [
      { name: `${namespace}-api-7d9c8f6b8d-x2abc`, namespace, phase: 'Running', containers: ['app'] },
      { name: `${namespace}-worker-0`, namespace, phase: 'Pending', containers: ['worker'] },
    ],
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

describe('kubernetes settings domain scenario', () => {
  beforeEach(() => {
    installLocalStorageMock()
    window.localStorage.clear()
    clearKubeCache()
    resetKubeStore()
    vi.clearAllMocks()
  })

  it('validates settings, handles cache, selects Kubernetes targets, and finds fallback pods', async () => {
    expect(validateSettings(defaultSettings)).toEqual([])
    expect(validateSettings({ ...defaultSettings, initialTailLines: -1 })).toContainEqual(expect.objectContaining({ field: 'initialTailLines' }))
    expect(validateSettings({ ...defaultSettings, bufferLimit: 999 })).toContainEqual(expect.objectContaining({ field: 'bufferLimit' }))
    expect(validateSettings({ ...defaultSettings, defaultNamespace: 123 })).toContainEqual(expect.objectContaining({ field: 'defaultNamespace' }))
    expect(validateSettings({ ...defaultSettings, extra: true })).toContainEqual(expect.objectContaining({ field: 'settings.extra' }))
    expect(validateSettings({ ...defaultSettings, logPolicy: { version: 1 } })).toContainEqual(expect.objectContaining({ field: 'logPolicy' }))
    expect(validateSettings({ ...defaultSettings, logSources: { INFO: { container: 'app', filePath: '/x' } } })).toContainEqual(expect.objectContaining({ field: 'logSources' }))
    expect(validateSettings({ ...defaultSettings, logSources: { ...defaultSettings.logSources, info: { container: '', filePath: 'relative.log' } } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'logSources.info.container' }),
      expect.objectContaining({ field: 'logSources.info.filePath' }),
    ]))
    expect(() => assertValidSettings({ ...defaultSettings, schemaVersion: 2 })).toThrow('settings validation failed')

    expect(isKubeCacheStale(undefined, 1)).toBe(true)
    writeKubeCache({
      savedAt: 100,
      currentContext: 'ctx',
      contexts: [{ name: 'ctx' }],
      namespacesByContext: { ctx: [{ name: 'default' }] },
      podsByScope: { [scopeKey('ctx', 'default')]: [{ name: 'stale-pod', namespace: 'default', phase: 'Running', containers: ['app'] }] },
    })
    expect(readKubeCache()?.podsByScope).toEqual({})
    clearKubeCache()
    expect(readKubeCache()).toBeUndefined()

    await useKubeStore.getState().loadCurrentContext()
    await useKubeStore.getState().loadContexts()
    await useKubeStore.getState().ensureNamespacesForContexts(['ctx', 'blocked', 'prod'])
    expect(useKubeStore.getState().contexts.find((context) => context.name === 'blocked')).toBeUndefined()
    await useKubeStore.getState().selectContexts(['ctx', 'prod'])
    await vi.waitFor(() => expect(useKubeStore.getState().namespacesByContext.prod).toEqual([{ name: 'live' }]))
    await useKubeStore.getState().selectNamespaces([scopeKey('ctx', 'default')])
    const key = scopeKey('ctx', 'default')
    expect(useKubeStore.getState().podsByScope[key]?.length).toBeGreaterThan(0)
    useKubeStore.getState().selectPods([`${key}\u0000default-api-7d9c8f6b8d-x2abc`])
    expect(useKubeStore.getState().getSelectedPodTargets()[0]?.pod.name).toContain('default-api')
    await useKubeStore.getState().refreshPodsForSelections()
    await useKubeStore.getState().loadPods('default', 'ctx')
    useKubeStore.getState().clearCachedTargets()
    expect(useKubeStore.getState().cacheLoaded).toBe(true)

    expect(stablePodPrefix('api-7d9c8f6b8d-x2abc')).toBe('api')
    expect(stablePodPrefix('redis-0')).toBe('redis')
    expect(findFallbackPod(
      { name: 'api-7d9c8f6b8d-x2abc', namespace: 'default', phase: 'Running', containers: ['app'] },
      [
        { name: 'api-64cc9db7fd-k9f2p', namespace: 'default', phase: 'Running', containers: ['app'] },
        { name: 'worker-64cc9db7fd-k9f2p', namespace: 'default', phase: 'Running', containers: ['worker'] },
      ],
      'app',
    )?.name).toBe('api-64cc9db7fd-k9f2p')
    expect(findFallbackPod(
      { name: 'orphan-old', namespace: 'default', phase: 'Running', containers: ['app'] },
      [{ name: 'orphan-new', namespace: 'default', phase: 'Running', containers: ['app'] }],
    )?.name).toBe('orphan-new')
  })
})
