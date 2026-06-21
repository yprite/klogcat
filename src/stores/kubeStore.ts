import { create } from 'zustand'
import { getCurrentContext, listNamespaces, listPods } from '../commands/tauriKube'
import type { CommandError } from '../commands/types'
import type { NamespaceInfo, PodInfo } from '../types/kube'

type KubeState = { currentContext?: string; namespaces: NamespaceInfo[]; selectedNamespace?: string; pods: PodInfo[]; selectedPod?: string; loadingNamespaces: boolean; loadingPods: boolean; error?: CommandError; loadCurrentContext(): Promise<void>; loadNamespaces(): Promise<void>; selectNamespace(namespace: string): Promise<void>; loadPods(namespace: string): Promise<void>; selectPod(pod: string): void }
export const useKubeStore = create<KubeState>((set) => ({
  namespaces: [], pods: [], loadingNamespaces: false, loadingPods: false,
  async loadCurrentContext() { try { set({ currentContext: await getCurrentContext(), error: undefined }) } catch (e) { set({ error: e as CommandError }) } },
  async loadNamespaces() { set({ loadingNamespaces: true }); try { const res = await listNamespaces(); set({ namespaces: res.namespaces, loadingNamespaces: false, error: undefined }) } catch (e) { set({ error: e as CommandError, loadingNamespaces: false }) } },
  async selectNamespace(namespace) { set({ selectedNamespace: namespace, selectedPod: undefined, pods: [] }); await useKubeStore.getState().loadPods(namespace) },
  async loadPods(namespace) { set({ loadingPods: true }); try { const res = await listPods(namespace); set({ pods: res.pods, loadingPods: false, error: undefined }) } catch (e) { set({ error: e as CommandError, loadingPods: false }) } },
  selectPod(pod) { set({ selectedPod: pod }) },
}))
