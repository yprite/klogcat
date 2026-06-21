import { invoke } from '@tauri-apps/api/core'
import type { ListNamespacesResponse, ListPodsResponse } from '../types/kube'
export const getCurrentContext = () => invoke<string>('get_current_context')
export const listNamespaces = () => invoke<ListNamespacesResponse>('list_namespaces')
export const listPods = (namespace: string) => invoke<ListPodsResponse>('list_pods', { namespace })
