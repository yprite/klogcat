export type PodPhase = 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown'
export type ContextInfo = { name: string }
export type NamespaceInfo = { name: string }
export type PodInfo = { name: string; namespace: string; phase: PodPhase; containers: string[]; labels?: Record<string, string> }
export type ListContextsResponse = { contexts: ContextInfo[] }
export type ListNamespacesResponse = { context?: string; namespaces: NamespaceInfo[] }
export type ListPodsResponse = { context?: string; namespace: string; pods: PodInfo[] }
