import { create } from 'zustand'
import { getCurrentContext, listContexts, listNamespaces, listPods } from '../commands/tauriKube'
import type { CommandError } from '../commands/types'
import type { ContextInfo, NamespaceInfo, PodInfo } from '../types/kube'

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
      const currentContext = await getCurrentContext()
      set({ currentContext, selectedContext: currentContext, selectedContexts: [currentContext], error: undefined })
    } catch (e) { set({ error: e as CommandError }) }
  },
  async loadContexts() {
    set({ loadingContexts: true })
    try { const res = await listContexts(); set({ contexts: res.contexts, loadingContexts: false, error: undefined }) }
    catch (e) { set({ error: e as CommandError, loadingContexts: false }) }
  },
  async selectContext(context) { await get().selectContexts(context ? [context] : []) },
  async selectContexts(contexts) {
    const selectedContext = first(contexts)
    set({ selectedContexts: contexts, selectedContext, selectedNamespace: undefined, selectedNamespaces: {}, selectedPod: undefined, selectedPods: {}, namespaces: [], namespacesByContext: {}, pods: [], podsByScope: {} })
    set({ loadingNamespaces: true })
    try {
      const entries = await Promise.all(contexts.map(async (ctx) => [ctx, (await listNamespaces(ctx)).namespaces] as const))
      const namespacesByContext = Object.fromEntries(entries)
      set({ namespacesByContext, namespaces: selectedContext ? namespacesByContext[selectedContext] ?? [] : [], loadingNamespaces: false, error: undefined })
    } catch (e) { set({ error: e as CommandError, loadingNamespaces: false }) }
  },
  async loadNamespaces(context) {
    const selectedContext = context ?? get().selectedContext ?? get().currentContext
    if (!selectedContext) return
    set({ loadingNamespaces: true })
    try {
      const res = await listNamespaces(selectedContext)
      set((s) => ({ namespacesByContext: { ...s.namespacesByContext, [selectedContext]: res.namespaces }, namespaces: res.namespaces, loadingNamespaces: false, error: undefined }))
    } catch (e) { set({ error: e as CommandError, loadingNamespaces: false }) }
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
      const entries = await Promise.all(pairs.map(async ({ context, namespace }) => [scopeKey(context, namespace), (await listPods(namespace, context)).pods] as const))
      const podsByScope = Object.fromEntries(entries)
      set({ podsByScope, pods: firstContext && firstNs ? podsByScope[scopeKey(firstContext, firstNs)] ?? [] : [], loadingPods: false, error: undefined })
    } catch (e) { set({ error: e as CommandError, loadingPods: false }) }
  },
  async loadPods(namespace, context) {
    const selectedContext = context ?? get().selectedContext ?? get().currentContext
    if (!selectedContext) return
    set({ loadingPods: true })
    try {
      const res = await listPods(namespace, selectedContext)
      set((s) => ({ podsByScope: { ...s.podsByScope, [scopeKey(selectedContext, namespace)]: res.pods }, pods: res.pods, loadingPods: false, error: undefined }))
    } catch (e) { set({ error: e as CommandError, loadingPods: false }) }
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
