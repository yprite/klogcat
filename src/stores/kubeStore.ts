import { create } from 'zustand'
import { getCurrentContext, listContexts, listNamespaces, listPods } from '../commands/tauriKube'
import type { CommandError } from '../commands/types'
import type { ContextInfo, NamespaceInfo, PodInfo } from '../types/kube'

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
  loadingContexts: boolean
  loadingNamespaces: boolean
  loadingPods: boolean
  error?: CommandError
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

const first = <T,>(items: T[]) => items[0]

export const useKubeStore = create<KubeState>((set, get) => ({
  contexts: [], currentContext: undefined, selectedContext: undefined, selectedContexts: [], namespaces: [], namespacesByContext: {}, selectedNamespace: undefined, selectedNamespaces: {}, pods: [], podsByScope: {}, selectedPod: undefined, selectedPods: {}, loadingContexts: false, loadingNamespaces: false, loadingPods: false,
  async loadCurrentContext() {
    try {
      recordKubeDebug('loadCurrentContext start')
      const currentContext = await getCurrentContext()
      recordKubeDebug(`loadCurrentContext ok current=${currentContext}`)
      set({ currentContext, selectedContext: currentContext, selectedContexts: [currentContext], error: undefined })
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
    }
    catch (e) {
      recordKubeDebug(`loadContexts failed ${JSON.stringify(e)}`)
      set({ error: e as CommandError, loadingContexts: false })
    }
  },
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
    const podsByScope: Record<string, PodInfo[]> = {}
    for (const [key, pods] of Object.entries(previous.selectedPods)) {
      const { context, namespace } = parseScopeKey(key)
      if (contextSet.has(context) && (selectedNamespaces[context] ?? []).includes(namespace)) selectedPods[key] = pods
    }
    for (const [key, pods] of Object.entries(previous.podsByScope)) {
      const { context, namespace } = parseScopeKey(key)
      if (contextSet.has(context) && (selectedNamespaces[context] ?? []).includes(namespace)) podsByScope[key] = pods
    }
    const selectedScope = selectedContext && selectedNamespace ? scopeKey(selectedContext, selectedNamespace) : undefined
    const selectedPod = selectedScope ? first(selectedPods[selectedScope] ?? []) : undefined
    const pods = selectedScope ? podsByScope[selectedScope] ?? [] : []
    set({ selectedContexts: contexts, selectedContext, selectedNamespace, selectedNamespaces, selectedPod, selectedPods, namespaces: selectedContext ? previous.namespacesByContext[selectedContext] ?? [] : [], pods, podsByScope, loadingNamespaces: false })
    void get().ensureNamespacesForContexts(contexts)
  },
  async ensureNamespacesForContexts(contexts) {
    const missingContexts = contexts.filter((context) => !get().namespacesByContext[context])
    if (missingContexts.length === 0) return
    set({ loadingNamespaces: true })
    try {
      recordKubeDebug(`ensureNamespaces start contexts=${missingContexts.join(',') || '(none)'}`)
      const entries = await Promise.all(missingContexts.map(async (ctx) => [ctx, (await listNamespaces(ctx)).namespaces] as const))
      recordKubeDebug(`ensureNamespaces ok ${entries.map(([ctx, namespaces]) => `${ctx}:${namespaces.length}`).join(', ') || '(none)'}`)
      set((s) => {
        const namespacesByContext = { ...s.namespacesByContext, ...Object.fromEntries(entries) }
        return { namespacesByContext, namespaces: s.selectedContext ? namespacesByContext[s.selectedContext] ?? [] : [], loadingNamespaces: false, error: undefined }
      })
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
    } catch (e) {
      recordKubeDebug(`loadNamespaces failed context=${selectedContext} ${JSON.stringify(e)}`)
      set({ error: e as CommandError, loadingNamespaces: false })
    }
  },
  async selectNamespace(namespace) {
    const context = get().selectedContext ?? get().currentContext
    await get().selectNamespaces(context && namespace ? [`${context}\u0000${namespace}`] : [])
  },
  async selectNamespaces(scopeValues) {
    const selectedNamespaces: Record<string, string[]> = {}
    for (const value of scopeValues) {
      const { context, namespace } = parseScopeKey(value)
      if (!context || !namespace) continue
      selectedNamespaces[context] = [...(selectedNamespaces[context] ?? []), namespace]
    }
    const firstContext = Object.keys(selectedNamespaces)[0]
    const firstNs = firstContext ? selectedNamespaces[firstContext][0] : undefined
    set({ selectedNamespaces, selectedNamespace: firstNs, selectedPod: undefined, selectedPods: {}, pods: [], podsByScope: {}, loadingPods: true })
    try {
      const pairs = Object.entries(selectedNamespaces).flatMap(([context, namespaces]) => namespaces.map((namespace) => ({ context, namespace })))
      recordKubeDebug(`selectNamespaces loadPods start targets=${pairs.map(({ context, namespace }) => `${context}/${namespace}`).join(',') || '(none)'}`)
      const entries = await Promise.all(pairs.map(async ({ context, namespace }) => [scopeKey(context, namespace), (await listPods(namespace, context)).pods] as const))
      const podsByScope = Object.fromEntries(entries)
      recordKubeDebug(`selectNamespaces loadPods ok ${entries.map(([key, pods]) => `${key.replace('\u0000', '/')}:${pods.length}`).join(', ') || '(none)'}`)
      set({ podsByScope, pods: firstContext && firstNs ? podsByScope[scopeKey(firstContext, firstNs)] ?? [] : [], loadingPods: false, error: undefined })
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
    } catch (e) {
      recordKubeDebug(`loadPods failed context=${selectedContext} namespace=${namespace} ${JSON.stringify(e)}`)
      set({ error: e as CommandError, loadingPods: false })
    }
  },
  selectPod(pod) {
    const context = get().selectedContext ?? get().currentContext
    const namespace = get().selectedNamespace
    if (!context || !namespace) { set({ selectedPod: pod }); return }
    get().selectPods(pod ? [`${context}\u0000${namespace}\u0000${pod}`] : [])
  },
  selectPods(scopePodValues) {
    const selectedPods: Record<string, string[]> = {}
    for (const value of scopePodValues) {
      const [context, namespace, pod] = value.split('\u0000')
      if (!context || !namespace || !pod) continue
      const key = scopeKey(context, namespace)
      selectedPods[key] = [...(selectedPods[key] ?? []), pod]
    }
    const firstKey = Object.keys(selectedPods)[0]
    set({ selectedPods, selectedPod: firstKey ? selectedPods[firstKey][0] : undefined })
  },
  getSelectedPodTargets() {
    const state = get()
    const targets: SelectedPodTarget[] = []
    for (const [key, names] of Object.entries(state.selectedPods)) {
      const { context, namespace } = parseScopeKey(key)
      const pods = state.podsByScope[key] ?? []
      for (const name of names) {
        const pod = pods.find((p) => p.name === name)
        if (pod) targets.push({ context, namespace, pod })
      }
    }
    if (targets.length === 0 && state.selectedContext && state.selectedNamespace && state.selectedPod) {
      const pod = state.pods.find((p) => p.name === state.selectedPod)
      if (pod) targets.push({ context: state.selectedContext, namespace: state.selectedNamespace, pod })
    }
    return targets
  },
}))
