import { create } from 'zustand'
import { getCurrentContext, listContexts, listNamespaces, listPods } from '../commands/tauriKube'
import type { CommandError } from '../commands/types'
import type { ContextInfo, NamespaceInfo, PodInfo } from '../types/kube'

type KubeState = {
  contexts: ContextInfo[]
  currentContext?: string
  selectedContext?: string
  namespaces: NamespaceInfo[]
  selectedNamespace?: string
  pods: PodInfo[]
  selectedPod?: string
  loadingContexts: boolean
  loadingNamespaces: boolean
  loadingPods: boolean
  error?: CommandError
  loadCurrentContext(): Promise<void>
  loadContexts(): Promise<void>
  selectContext(context: string): Promise<void>
  loadNamespaces(context?: string): Promise<void>
  selectNamespace(namespace: string): Promise<void>
  loadPods(namespace: string): Promise<void>
  selectPod(pod: string): void
}
export const useKubeStore = create<KubeState>((set) => ({
  contexts: [], namespaces: [], pods: [], loadingContexts: false, loadingNamespaces: false, loadingPods: false,
  async loadCurrentContext() {
    try {
      const currentContext = await getCurrentContext()
      set({ currentContext, selectedContext: currentContext, error: undefined })
    } catch (e) { set({ error: e as CommandError }) }
  },
  async loadContexts() {
    set({ loadingContexts: true })
    try { const res = await listContexts(); set({ contexts: res.contexts, loadingContexts: false, error: undefined }) }
    catch (e) { set({ error: e as CommandError, loadingContexts: false }) }
  },
  async selectContext(context) {
    set({ selectedContext: context, selectedNamespace: undefined, selectedPod: undefined, namespaces: [], pods: [] })
    await useKubeStore.getState().loadNamespaces(context)
  },
  async loadNamespaces(context) {
    const selectedContext = context ?? useKubeStore.getState().selectedContext
    set({ loadingNamespaces: true })
    try { const res = await listNamespaces(selectedContext); set({ namespaces: res.namespaces, loadingNamespaces: false, error: undefined }) }
    catch (e) { set({ error: e as CommandError, loadingNamespaces: false }) }
  },
  async selectNamespace(namespace) { set({ selectedNamespace: namespace, selectedPod: undefined, pods: [] }); await useKubeStore.getState().loadPods(namespace) },
  async loadPods(namespace) {
    const selectedContext = useKubeStore.getState().selectedContext
    set({ loadingPods: true })
    try { const res = await listPods(namespace, selectedContext); set({ pods: res.pods, loadingPods: false, error: undefined }) }
    catch (e) { set({ error: e as CommandError, loadingPods: false }) }
  },
  selectPod(pod) { set({ selectedPod: pod }) },
}))
