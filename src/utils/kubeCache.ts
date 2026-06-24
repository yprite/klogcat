import type { ContextInfo, NamespaceInfo, PodInfo } from '../types/kube'

export const KUBE_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const parseScopeKey = (key: string) => {
  const [context, namespace] = key.split('\u0000')
  return { context, namespace }
}
const KUBE_CACHE_KEY = 'klogcat:kube-cache:v1'

type RawKubeCache = {
  version: 1
  savedAt: number
  currentContext?: string
  contexts: ContextInfo[]
  namespacesByContext: Record<string, NamespaceInfo[]>
  podsByScope: Record<string, PodInfo[]>
}

export type KubeCache = RawKubeCache

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const validNamedItems = <T extends { name: string }>(items: unknown): T[] => Array.isArray(items) ? items.filter((item): item is T => isObject(item) && typeof item.name === 'string') : []
const validPods = (items: unknown): PodInfo[] => Array.isArray(items) ? items.filter((item): item is PodInfo => isObject(item) && typeof item.name === 'string' && typeof item.namespace === 'string' && typeof item.phase === 'string' && Array.isArray(item.containers)).map((pod) => ({ ...pod, containers: pod.containers.filter((container): container is string => typeof container === 'string') })) : []

export function isKubeCacheStale(savedAt?: number, now = Date.now()) {
  return !savedAt || now - savedAt >= KUBE_CACHE_TTL_MS
}

export function prunePodsByNamespaces(podsByScope: Record<string, PodInfo[]>, namespacesByContext: Record<string, NamespaceInfo[]>) {
  const next: Record<string, PodInfo[]> = {}
  for (const [key, pods] of Object.entries(podsByScope)) {
    const { context, namespace } = parseScopeKey(key)
    if ((namespacesByContext[context] ?? []).some((item) => item.name === namespace)) next[key] = pods
  }
  return next
}

export function readKubeCache(storage: Storage | undefined = globalThis.localStorage): KubeCache | undefined {
  if (!storage) return undefined
  const raw = storage.getItem(KUBE_CACHE_KEY)
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isObject(parsed) || parsed.version !== 1 || typeof parsed.savedAt !== 'number') return undefined
    const namespacesByContext: Record<string, NamespaceInfo[]> = {}
    if (isObject(parsed.namespacesByContext)) {
      for (const [context, namespaces] of Object.entries(parsed.namespacesByContext)) namespacesByContext[context] = validNamedItems<NamespaceInfo>(namespaces)
    }
    const podsByScope: Record<string, PodInfo[]> = {}
    if (isObject(parsed.podsByScope)) {
      for (const [scope, pods] of Object.entries(parsed.podsByScope)) podsByScope[scope] = validPods(pods)
    }
    return {
      version: 1,
      savedAt: parsed.savedAt,
      currentContext: typeof parsed.currentContext === 'string' ? parsed.currentContext : undefined,
      contexts: validNamedItems<ContextInfo>(parsed.contexts),
      namespacesByContext,
      podsByScope: prunePodsByNamespaces(podsByScope, namespacesByContext),
    }
  } catch {
    return undefined
  }
}

export function writeKubeCache(cache: Omit<KubeCache, 'version' | 'savedAt'> & { savedAt?: number }, storage: Storage | undefined = globalThis.localStorage) {
  if (!storage) return
  const normalized: KubeCache = {
    version: 1,
    savedAt: cache.savedAt ?? Date.now(),
    currentContext: cache.currentContext,
    contexts: cache.contexts,
    namespacesByContext: cache.namespacesByContext,
    podsByScope: prunePodsByNamespaces(cache.podsByScope, cache.namespacesByContext),
  }
  storage.setItem(KUBE_CACHE_KEY, JSON.stringify(normalized))
}

export function clearKubeCache(storage: Storage | undefined = globalThis.localStorage) {
  storage?.removeItem(KUBE_CACHE_KEY)
}
