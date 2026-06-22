import { invoke } from '@tauri-apps/api/core'
import type { ListContextsResponse, ListNamespacesResponse, ListPodsResponse } from '../types/kube'
export const getCurrentContext = () => invoke<string>('get_current_context')
export const listContexts = () => invoke<ListContextsResponse>('list_contexts')
export const listNamespaces = (context?: string) => invoke<ListNamespacesResponse>('list_namespaces', { context })
export const listPods = (namespace: string, context?: string) => invoke<ListPodsResponse>('list_pods', { namespace, context })
