export type PodPhase = 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown'
export type NamespaceInfo = { name: string }
export type PodInfo = { name: string; namespace: string; phase: PodPhase; containers: string[] }
export type ListNamespacesResponse = { namespaces: NamespaceInfo[] }
export type ListPodsResponse = { namespace: string; pods: PodInfo[] }
