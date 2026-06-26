import { create } from 'zustand'
import { getCurrentContext, listContexts, listNamespaces, listPods } from '../commands/tauriKube'
import type { CommandError } from '../commands/types'
import type { ContextInfo, NamespaceInfo, PodInfo } from '../types/kube'
import { clearKubeCache, isKubeCacheStale, readKubeCache, writeKubeCache } from '../utils/kubeCache'
import { stablePodPrefix } from '../utils/podFallback'

function recordKubeDebug(message: string) {
  console.info(`[klogcat kube] ${message}`)
}

export const scopeKey = (context: string, namespace: string) => `${context}\u0000${namespace}`
export const parseScopeKey = (key: string) => {
  const [context, namespace] = key.split('\u0000')
  return { context, namespace }
}

export type SelectedPodTarget = { context: string; namespace: string; pod: PodInfo }

type KubeState = {
  contexts: ContextInfo[]
  currentContext?: string
  selectedContext?: string
  selectedContexts: string[]
  namespaces: NamespaceInfo[]
  namespacesByContext: Record<string, NamespaceInfo[]>
  selectedNamespace?: string
  selectedNamespaces: Record<string, string[]>
  pods: PodInfo[]
  podsByScope: Record<string, PodInfo[]>
  selectedPod?: string
  selectedPods: Record<string, string[]>
  selectedWorkloads: Record<string, string[]>
  loadingContexts: boolean
  loadingNamespaces: boolean
  loadingPods: boolean
  cacheLoaded: boolean
  cacheRefreshing: boolean
  cacheLastRefreshAt?: number
  error?: CommandError
  loadCachedTargets(): boolean
  clearCachedTargets(): void
  shouldRefreshCache(now?: number): boolean
  refreshAllTargets(force?: boolean): Promise<void>
  refreshPodsForSelections(): Promise<void>
  loadCurrentContext(): Promise<void>
  loadContexts(): Promise<void>
  selectContext(context: string): Promise<void>
  selectContexts(contexts: string[]): Promise<void>
  loadNamespaces(context?: string): Promise<void>
  ensureNamespacesForContexts(contexts: string[]): Promise<void>
  selectNamespace(namespace: string): Promise<void>
  selectNamespaces(scopeValues: string[]): Promise<void>
  loadPods(namespace: string, context?: string): Promise<void>
  selectPod(pod: string): void
  selectPods(scopePodValues: string[]): void
  getSelectedPodTargets(): SelectedPodTarget[]
}

export type KubeStoreState = KubeState

const first = <T,>(items: T[]) => items[0]
const KUBE_REFRESH_CONCURRENCY = 6

function currentCacheSnapshot(state: Pick<KubeState, 'currentContext' | 'contexts' | 'namespacesByContext' | 'podsByScope'>) {
  return { currentContext: state.currentContext, contexts: state.contexts, namespacesByContext: state.namespacesByContext, podsByScope: state.podsByScope }
}

function persistKubeCache(state: Pick<KubeState, 'currentContext' | 'contexts' | 'namespacesByContext' | 'podsByScope'>, savedAt?: number) {
  writeKubeCache({ ...currentCacheSnapshot(state), savedAt })
}

type KubeSelectionPatch = Partial<Pick<KubeState, 'contexts' | 'currentContext' | 'selectedContext' | 'selectedContexts' | 'namespaces' | 'namespacesByContext' | 'selectedNamespace' | 'selectedNamespaces' | 'pods' | 'podsByScope' | 'selectedPod' | 'selectedPods' | 'selectedWorkloads'>>
type KubeSet = (patch: Partial<KubeState> | ((state: KubeState) => Partial<KubeState>), replace?: false) => void
type KubeGet = () => KubeState
type KubeDataState = Pick<KubeState, 'contexts' | 'currentContext' | 'selectedContext' | 'selectedContexts' | 'namespaces' | 'namespacesByContext' | 'selectedNamespace' | 'selectedNamespaces' | 'pods' | 'podsByScope' | 'selectedPod' | 'selectedPods' | 'selectedWorkloads' | 'loadingContexts' | 'loadingNamespaces' | 'loadingPods' | 'cacheLoaded' | 'cacheRefreshing' | 'cacheLastRefreshAt' | 'error'>

const initialKubeDataState: KubeDataState = {
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
}

function allowedContextNames(contexts: ContextInfo[]) {
  return new Set(contexts.map((context) => context.name))
}

function selectedContextForAllowed(state: KubeState, contexts: ContextInfo[], allowed: Set<string>, currentContext?: string) {
  if (state.selectedContext && allowed.has(state.selectedContext)) return state.selectedContext
  const retainedSelection = first(state.selectedContexts.filter((context) => allowed.has(context)))
  if (retainedSelection) return retainedSelection
  return currentContext && allowed.has(currentContext) ? currentContext : first(contexts)?.name
}

function selectedContextsForAllowed(state: KubeState, selectedContext: string | undefined, allowed: Set<string>) {
  const retained = state.selectedContexts.filter((context) => allowed.has(context))
  return retained.length ? retained : selectedContext ? [selectedContext] : []
}

function keepContextRecord<T>(record: Record<string, T>, allowed: Set<string>) {
  return Object.fromEntries(Object.entries(record).filter(([context]) => allowed.has(context))) as Record<string, T>
}

function keepScopeRecord<T>(record: Record<string, T>, allowed: Set<string>) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => allowed.has(parseScopeKey(key).context))) as Record<string, T>
}

function selectedScopeForContext(selectedContext: string | undefined, selectedNamespaces: Record<string, string[]>) {
  const selectedNamespace = selectedContext ? first(selectedNamespaces[selectedContext] ?? []) : undefined
  const selectedScope = selectedContext && selectedNamespace ? scopeKey(selectedContext, selectedNamespace) : undefined
  return { selectedNamespace, selectedScope }
}

function restrictStateToContexts(state: KubeState, contexts: ContextInfo[], currentContext?: string): KubeSelectionPatch {
  const allowed = allowedContextNames(contexts)
  const selectedContext = selectedContextForAllowed(state, contexts, allowed, currentContext)
  const selectedContexts = selectedContextsForAllowed(state, selectedContext, allowed)
  const namespacesByContext = keepContextRecord(state.namespacesByContext, allowed)
  const selectedNamespaces = keepContextRecord(state.selectedNamespaces, allowed)
  const podsByScope = keepScopeRecord(state.podsByScope, allowed)
  const selectedPods = keepScopeRecord(state.selectedPods, allowed)
  const selectedWorkloads = keepScopeRecord(state.selectedWorkloads, allowed)
  const { selectedNamespace, selectedScope } = selectedScopeForContext(selectedContext, selectedNamespaces)
  return {
    contexts,
    currentContext: currentContext && allowed.has(currentContext) ? currentContext : selectedContext,
    selectedContext,
    selectedContexts,
    namespacesByContext,
    namespaces: selectedContext ? namespacesByContext[selectedContext] ?? [] : [],
    selectedNamespace,
    selectedNamespaces,
    podsByScope,
    pods: selectedScope ? podsByScope[selectedScope] ?? [] : [],
    selectedPod: selectedScope ? first(selectedPods[selectedScope] ?? []) : undefined,
    selectedPods,
    selectedWorkloads,
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await mapper(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

function createCacheActions(set: KubeSet, get: KubeGet): Pick<KubeState, 'loadCachedTargets' | 'clearCachedTargets' | 'shouldRefreshCache'> {
  return {
  loadCachedTargets() {
    const cache = readKubeCache()
    if (!cache) { set({ cacheLoaded: true }); return false }
    const selectedContext = get().selectedContext ?? cache.currentContext ?? first(cache.contexts)?.name
    const selectedContexts = get().selectedContexts.length ? get().selectedContexts : selectedContext ? [selectedContext] : []
    set({
      currentContext: cache.currentContext,
      contexts: cache.contexts,
      selectedContext,
      selectedContexts,
      namespacesByContext: cache.namespacesByContext,
      namespaces: selectedContext ? cache.namespacesByContext[selectedContext] ?? [] : [],
      podsByScope: {},
      pods: [],
      cacheLoaded: true,
      cacheLastRefreshAt: cache.savedAt,
      error: undefined,
    })
    return true
  },
  clearCachedTargets() {
    clearKubeCache()
    set({
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
      cacheLoaded: true,
      cacheLastRefreshAt: undefined,
      error: undefined,
    })
  },
  shouldRefreshCache(now) { return isKubeCacheStale(get().cacheLastRefreshAt, now) },
  }
}

function createRefreshActions(set: KubeSet, get: KubeGet): Pick<KubeState, 'refreshAllTargets' | 'refreshPodsForSelections' | 'loadCurrentContext' | 'loadContexts'> {
  return {
  async refreshAllTargets(force = false) {
    const state = get()
    if (state.cacheRefreshing) return
    if (!force && !state.shouldRefreshCache()) return
    set({ cacheRefreshing: true, loadingContexts: true, error: undefined })
    try {
      recordKubeDebug(`refreshAllTargets start force=${force}`)
      const [currentContext, contextsRes] = await Promise.all([getCurrentContext().catch(() => undefined), listContexts()])
      const contexts = contextsRes.contexts
      set((s) => ({ currentContext: currentContext ?? s.currentContext, contexts, selectedContext: s.selectedContext ?? currentContext ?? first(contexts)?.name, selectedContexts: s.selectedContexts.length ? s.selectedContexts : currentContext ? [currentContext] : first(contexts) ? [first(contexts)!.name] : [], loadingContexts: false, loadingNamespaces: true }))
      const namespaceResults = await mapWithConcurrency(contexts, KUBE_REFRESH_CONCURRENCY, async (context) => {
        try {
          return { ok: true as const, context: context.name, namespaces: (await listNamespaces(context.name)).namespaces }
        } catch (error) {
          recordKubeDebug(`refreshAllTargets hide inaccessible context=${context.name} error=${JSON.stringify(error)}`)
          return { ok: false as const, context: context.name }
        }
      })
      const namespaceEntries = namespaceResults.flatMap((result) => result.ok && result.namespaces.length > 0 ? [[result.context, result.namespaces] as const] : [])
      const accessibleContexts = contexts.filter((context) => namespaceEntries.some(([name]) => name === context.name))
      const namespacesByContext = Object.fromEntries(namespaceEntries)
      set((s) => ({ ...restrictStateToContexts({ ...s, namespacesByContext } as KubeState, accessibleContexts, currentContext), namespacesByContext, namespaces: (s.selectedContext && namespacesByContext[s.selectedContext]) ? namespacesByContext[s.selectedContext] : (first(accessibleContexts) ? namespacesByContext[first(accessibleContexts)!.name] ?? [] : []), loadingNamespaces: false, loadingPods: true }))
      const pairs = namespaceEntries.flatMap(([context, namespaces]) => namespaces.map((namespace) => ({ context, namespace: namespace.name })))
      const podEntries = await mapWithConcurrency(pairs, KUBE_REFRESH_CONCURRENCY, async ({ context, namespace }) => [scopeKey(context, namespace), (await listPods(namespace, context)).pods] as const)
      const podsByScope = Object.fromEntries(podEntries)
      const savedAt = Date.now()
      set((s) => {
        const selectedScope = s.selectedContext && s.selectedNamespace ? scopeKey(s.selectedContext, s.selectedNamespace) : undefined
        return { podsByScope, pods: selectedScope ? podsByScope[selectedScope] ?? [] : [], loadingPods: false, cacheRefreshing: false, cacheLastRefreshAt: savedAt, error: undefined }
      })
      persistKubeCache(get(), savedAt)
      recordKubeDebug(`refreshAllTargets ok contexts=${accessibleContexts.length} namespaces=${pairs.length} podScopes=${podEntries.length}`)
    } catch (e) {
      recordKubeDebug(`refreshAllTargets failed ${JSON.stringify(e)}`)
      set({ error: e as CommandError, loadingContexts: false, loadingNamespaces: false, loadingPods: false, cacheRefreshing: false })
    }
  },
  async refreshPodsForSelections() {
    const uniqueSelectionKeys = new Set([...Object.keys(get().selectedPods), ...Object.keys(get().selectedWorkloads)])
    const selections = [...uniqueSelectionKeys].map((key) => parseScopeKey(key))
    const namespaceSelections = Object.entries(get().selectedNamespaces).flatMap(([context, namespaces]) => namespaces.map((namespace) => ({ context, namespace })))
    const pairs = (selections.length ? selections : namespaceSelections).filter(({ context, namespace }) => context && namespace)
    if (pairs.length === 0) return
    set({ loadingPods: true })
    try {
      recordKubeDebug(`refreshPodsForSelections start targets=${pairs.map(({ context, namespace }) => `${context}/${namespace}`).join(',')}`)
      const podEntries = await mapWithConcurrency(pairs, KUBE_REFRESH_CONCURRENCY, async ({ context, namespace }) => [scopeKey(context, namespace), (await listPods(namespace, context)).pods] as const)
      const savedAt = get().cacheLastRefreshAt
      set((s) => {
        const podsByScope = { ...s.podsByScope, ...Object.fromEntries(podEntries) }
        const selectedScope = s.selectedContext && s.selectedNamespace ? scopeKey(s.selectedContext, s.selectedNamespace) : undefined
        return { podsByScope, pods: selectedScope ? podsByScope[selectedScope] ?? [] : [], loadingPods: false, error: undefined }
      })
      persistKubeCache(get(), savedAt)
    } catch (e) {
      set({ error: e as CommandError, loadingPods: false })
    }
  },
  async loadCurrentContext() {
    try {
      recordKubeDebug('loadCurrentContext start')
      const currentContext = await getCurrentContext()
      recordKubeDebug(`loadCurrentContext ok current=${currentContext}`)
      set({ currentContext, selectedContext: currentContext, selectedContexts: [currentContext], error: undefined })
      persistKubeCache(get())
    } catch (e) {
      recordKubeDebug(`loadCurrentContext failed ${JSON.stringify(e)}`)
      set({ error: e as CommandError })
    }
  },
  async loadContexts() {
    set({ loadingContexts: true })
    try {
      recordKubeDebug('loadContexts start')
      const res = await listContexts()
      recordKubeDebug(`loadContexts ok count=${res.contexts.length} names=${res.contexts.map((context) => context.name).join(',') || '(none)'}`)
      set({ contexts: res.contexts, loadingContexts: false, error: undefined })
      persistKubeCache(get())
    }
    catch (e) {
      recordKubeDebug(`loadContexts failed ${JSON.stringify(e)}`)
      set({ error: e as CommandError, loadingContexts: false })
    }
  },
  }
}

function createSelectionActions(set: KubeSet, get: KubeGet): Pick<KubeState, 'selectContext' | 'selectContexts' | 'ensureNamespacesForContexts' | 'loadNamespaces' | 'selectNamespace' | 'selectNamespaces' | 'loadPods'> {
  return {
  async selectContext(context) { await get().selectContexts(context ? [context] : []) },
  async selectContexts(contexts) {
    const previous = get()
    const selectedContext = first(contexts)
    const contextSet = new Set(contexts)
    const selectedNamespaces: Record<string, string[]> = {}
    for (const [context, namespaces] of Object.entries(previous.selectedNamespaces)) {
      if (contextSet.has(context)) selectedNamespaces[context] = namespaces
    }
    const selectedNamespace = selectedContext ? first(selectedNamespaces[selectedContext] ?? []) : undefined
    const selectedPods: Record<string, string[]> = {}
    const selectedWorkloads: Record<string, string[]> = {}
    const podsByScope: Record<string, PodInfo[]> = {}
    for (const [key, pods] of Object.entries(previous.selectedPods)) {
      const { context, namespace } = parseScopeKey(key)
      if (contextSet.has(context) && (selectedNamespaces[context] ?? []).includes(namespace)) selectedPods[key] = pods
    }
    for (const [key, workloads] of Object.entries(previous.selectedWorkloads)) {
      const { context, namespace } = parseScopeKey(key)
      if (contextSet.has(context) && (selectedNamespaces[context] ?? []).includes(namespace)) selectedWorkloads[key] = workloads
    }
    for (const [key, pods] of Object.entries(previous.podsByScope)) {
      const { context } = parseScopeKey(key)
      if (contextSet.has(context)) podsByScope[key] = pods
    }
    const selectedScope = selectedContext && selectedNamespace ? scopeKey(selectedContext, selectedNamespace) : undefined
    const selectedPod = selectedScope ? first(selectedPods[selectedScope] ?? []) : undefined
    const pods = selectedScope ? podsByScope[selectedScope] ?? [] : []
    set({ selectedContexts: contexts, selectedContext, selectedNamespace, selectedNamespaces, selectedPod, selectedPods, selectedWorkloads, namespaces: selectedContext ? previous.namespacesByContext[selectedContext] ?? [] : [], pods, podsByScope, loadingNamespaces: false })
    void get().ensureNamespacesForContexts(contexts)
  },
  async ensureNamespacesForContexts(contexts) {
    const missingContexts = contexts.filter((context) => !get().namespacesByContext[context])
    if (missingContexts.length === 0) return
    set({ loadingNamespaces: true })
    try {
      recordKubeDebug(`ensureNamespaces start contexts=${missingContexts.join(',') || '(none)'}`)
      const results = await Promise.all(missingContexts.map(async (ctx) => {
        try {
          return { ok: true as const, ctx, namespaces: (await listNamespaces(ctx)).namespaces }
        } catch (error) {
          recordKubeDebug(`ensureNamespaces hide inaccessible context=${ctx} error=${JSON.stringify(error)}`)
          return { ok: false as const, ctx }
        }
      }))
      const entries = results.flatMap((result) => result.ok && result.namespaces.length > 0 ? [[result.ctx, result.namespaces] as const] : [])
      const unavailable = new Set(results.filter((result) => !result.ok || result.namespaces.length === 0).map((result) => result.ctx))
      recordKubeDebug(`ensureNamespaces ok ${entries.map(([ctx, namespaces]) => `${ctx}:${namespaces.length}`).join(', ') || '(none)'}`)
      set((s) => {
        const contexts = s.contexts.filter((context) => !unavailable.has(context.name))
        const mergedNamespacesByContext = { ...s.namespacesByContext, ...Object.fromEntries(entries) }
        const namespacesByContext = Object.fromEntries(Object.entries(mergedNamespacesByContext).filter(([context]) => !unavailable.has(context)))
        return { ...restrictStateToContexts({ ...s, namespacesByContext } as KubeState, contexts, s.currentContext), namespacesByContext, loadingNamespaces: false, error: undefined }
      })
      persistKubeCache(get())
    } catch (e) {
      recordKubeDebug(`ensureNamespaces failed ${JSON.stringify(e)}`)
      set({ error: e as CommandError, loadingNamespaces: false })
    }
  },
  async loadNamespaces(context) {
    const selectedContext = context ?? get().selectedContext ?? get().currentContext
    if (!selectedContext) return
    set({ loadingNamespaces: true })
    try {
      recordKubeDebug(`loadNamespaces start context=${selectedContext}`)
      const res = await listNamespaces(selectedContext)
      recordKubeDebug(`loadNamespaces ok context=${selectedContext} count=${res.namespaces.length} names=${res.namespaces.map((namespace) => namespace.name).join(',') || '(none)'}`)
      set((s) => ({ namespacesByContext: { ...s.namespacesByContext, [selectedContext]: res.namespaces }, namespaces: res.namespaces, loadingNamespaces: false, error: undefined }))
      persistKubeCache(get())
    } catch (e) {
      recordKubeDebug(`loadNamespaces failed context=${selectedContext} ${JSON.stringify(e)}`)
      set((s) => {
        const contexts = s.contexts.filter((context) => context.name !== selectedContext)
        return { ...restrictStateToContexts(s, contexts, s.currentContext), loadingNamespaces: false, error: e as CommandError }
      })
      persistKubeCache(get())
    }
  },
  async selectNamespace(namespace) {
    const context = get().selectedContext ?? get().currentContext
    await get().selectNamespaces(context && namespace ? [`${context}\u0000${namespace}`] : [])
  },
  async selectNamespaces(scopeValues) {
    const state = get()
    const selectedNamespaces: Record<string, string[]> = {}
    for (const value of scopeValues) {
      const { context, namespace } = parseScopeKey(value)
      if (!context || !namespace) continue
      selectedNamespaces[context] = [...(selectedNamespaces[context] ?? []), namespace]
    }
    const firstContext = Object.keys(selectedNamespaces)[0]
    const firstNs = firstContext ? selectedNamespaces[firstContext][0] : undefined
    const pairs = Object.entries(selectedNamespaces).flatMap(([context, namespaces]) => namespaces.map((namespace) => ({ context, namespace })))
    const selectedContext = firstContext ?? state.selectedContext
    const selectedContexts = firstContext && !state.selectedContexts.includes(firstContext) ? [...state.selectedContexts, firstContext] : state.selectedContexts
    const cachedPodsByScope = state.podsByScope
    set({
      selectedContext,
      selectedContexts,
      selectedNamespaces,
      selectedNamespace: firstNs,
      selectedPod: undefined,
      selectedPods: {},
      selectedWorkloads: {},
      namespaces: selectedContext ? state.namespacesByContext[selectedContext] ?? [] : [],
      pods: firstContext && firstNs ? cachedPodsByScope[scopeKey(firstContext, firstNs)] ?? [] : [],
      loadingPods: pairs.length > 0,
    })
    if (pairs.length === 0) return
    try {
      recordKubeDebug(`selectNamespaces loadPods start targets=${pairs.map(({ context, namespace }) => `${context}/${namespace}`).join(',') || '(none)'}`)
      const entries = await Promise.all(pairs.map(async ({ context, namespace }) => [scopeKey(context, namespace), (await listPods(namespace, context)).pods] as const))
      const loadedPodsByScope = Object.fromEntries(entries)
      recordKubeDebug(`selectNamespaces loadPods ok ${entries.map(([key, pods]) => `${key.replace('\u0000', '/')}:${pods.length}`).join(', ') || '(none)'}`)
      set((s) => {
        const podsByScope = { ...s.podsByScope, ...loadedPodsByScope }
        return { podsByScope, pods: firstContext && firstNs ? podsByScope[scopeKey(firstContext, firstNs)] ?? [] : [], loadingPods: false, error: undefined }
      })
      persistKubeCache(get())
    } catch (e) {
      recordKubeDebug(`selectNamespaces loadPods failed ${JSON.stringify(e)}`)
      set({ error: e as CommandError, loadingPods: false })
    }
  },
  async loadPods(namespace, context) {
    const selectedContext = context ?? get().selectedContext ?? get().currentContext
    if (!selectedContext) return
    set({ loadingPods: true })
    try {
      recordKubeDebug(`loadPods start context=${selectedContext} namespace=${namespace}`)
      const res = await listPods(namespace, selectedContext)
      recordKubeDebug(`loadPods ok context=${selectedContext} namespace=${namespace} count=${res.pods.length} names=${res.pods.map((pod) => pod.name).join(',') || '(none)'}`)
      set((s) => ({ podsByScope: { ...s.podsByScope, [scopeKey(selectedContext, namespace)]: res.pods }, pods: res.pods, loadingPods: false, error: undefined }))
      persistKubeCache(get())
    } catch (e) {
      recordKubeDebug(`loadPods failed context=${selectedContext} namespace=${namespace} ${JSON.stringify(e)}`)
      set({ error: e as CommandError, loadingPods: false })
    }
  },
  }
}

function createPodTargetActions(set: KubeSet, get: KubeGet): Pick<KubeState, 'selectPod' | 'selectPods' | 'getSelectedPodTargets'> {
  return {
  selectPod(pod) {
    const context = get().selectedContext ?? get().currentContext
    const namespace = get().selectedNamespace
    if (!context || !namespace) { set({ selectedPod: pod }); return }
    get().selectPods(pod ? [`${context}\u0000${namespace}\u0000${pod}`] : [])
  },
  selectPods(scopePodValues) {
    const selectedPods: Record<string, string[]> = {}
    const selectedWorkloads: Record<string, string[]> = {}
    for (const value of scopePodValues) {
      const [context, namespace, pod] = value.split('\u0000')
      if (!context || !namespace || !pod) continue
      const key = scopeKey(context, namespace)
      selectedPods[key] = [...(selectedPods[key] ?? []), pod]
      const livePod = get().podsByScope[key]?.find((item) => item.name === pod)
      const workload = stablePodPrefix(livePod?.name ?? pod)
      selectedWorkloads[key] = [...(selectedWorkloads[key] ?? []), workload]
    }
    const firstKey = Object.keys(selectedPods)[0]
    set({ selectedPods, selectedWorkloads, selectedPod: firstKey ? selectedPods[firstKey][0] : undefined })
  },
  getSelectedPodTargets() {
    const state = get()
    const targets: SelectedPodTarget[] = []
    const pushWorkloadTarget = (key: string, workload: string, context: string, namespace: string) => {
      const pods = state.podsByScope[key] ?? []
      const match = pods
        .filter((pod) => pod.phase === 'Running' && stablePodPrefix(pod.name) === workload)
        .sort((a, b) => a.name.localeCompare(b.name))[0]
      if (match) targets.push({ context, namespace, pod: match })
      return Boolean(match)
    }
    for (const [key, names] of Object.entries(state.selectedPods)) {
      const { context, namespace } = parseScopeKey(key)
      const pods = state.podsByScope[key] ?? []
      for (const [index, name] of names.entries()) {
        const pod = pods.find((p) => p.name === name)
        if (pod) {
          targets.push({ context, namespace, pod })
          continue
        }
        const workload = state.selectedWorkloads[key]?.[index] ?? stablePodPrefix(name)
        if (pushWorkloadTarget(key, workload, context, namespace)) continue
        targets.push({ context, namespace, pod: { name, namespace, phase: 'Running', containers: first(pods)?.containers ?? [] } })
      }
    }
    const selectedPodScopes = new Set(Object.keys(state.selectedPods))
    for (const [key, workloads] of Object.entries(state.selectedWorkloads)) {
      if (selectedPodScopes.has(key)) continue
      const { context, namespace } = parseScopeKey(key)
      for (const workload of workloads) pushWorkloadTarget(key, workload, context, namespace)
    }
    if (targets.length === 0 && state.selectedContext && state.selectedNamespace && state.selectedPod) {
      const pod = state.pods.find((p) => p.name === state.selectedPod)
      if (pod) targets.push({ context: state.selectedContext, namespace: state.selectedNamespace, pod })
    }
    return targets
  },
  }
}

function createKubeStore(set: KubeSet, get: KubeGet): KubeState {
  return {
    ...initialKubeDataState,
    ...createCacheActions(set, get),
    ...createRefreshActions(set, get),
    ...createSelectionActions(set, get),
    ...createPodTargetActions(set, get),
  }
}

export const useKubeStore = create<KubeState>(createKubeStore)
