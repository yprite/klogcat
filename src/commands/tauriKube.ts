import { invoke, isTauri } from '@tauri-apps/api/core'
import type { ListContextsResponse, ListNamespacesResponse, ListPodsResponse } from '../types/kube'

export const getCurrentContext = () => isTauri() ? invoke<string>('get_current_context') : Promise.resolve('')
export const listContexts = () => isTauri() ? invoke<ListContextsResponse>('list_contexts') : Promise.resolve({ contexts: [] })
export const listNamespaces = (context?: string) => isTauri()
  ? invoke<ListNamespacesResponse>('list_namespaces', { context })
  : Promise.resolve({ context, namespaces: [] })
export const listPods = (namespace: string, context?: string) => isTauri()
  ? invoke<ListPodsResponse>('list_pods', { namespace, context })
  : Promise.resolve({ context, namespace, pods: [] })
