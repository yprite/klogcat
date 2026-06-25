import type { ContextInfo, NamespaceInfo, PodInfo } from '../types/kube'

export const KUBE_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const KUBE_CACHE_KEY = 'klogcat:kube-cache:v1'

type RawKubeCache = {
  version: 1
  savedAt: number
  currentContext?: string
  contexts: ContextInfo[]
  namespacesByContext: Record<string, NamespaceInfo[]>
  /** Deprecated volatile data accepted for backward compatibility but never hydrated or written. */
  podsByScope?: Record<string, PodInfo[]>
}

export type KubeCache = RawKubeCache

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const validNamedItems = <T extends { name: string }>(items: unknown): T[] => Array.isArray(items) ? items.filter((item): item is T => isObject(item) && typeof item.name === 'string') : []

export function isKubeCacheStale(savedAt?: number, now = Date.now()) {
  return !savedAt || now - savedAt >= KUBE_CACHE_TTL_MS
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
    return {
      version: 1,
      savedAt: parsed.savedAt,
      currentContext: typeof parsed.currentContext === 'string' ? parsed.currentContext : undefined,
      contexts: validNamedItems<ContextInfo>(parsed.contexts),
      namespacesByContext,
      podsByScope: {},
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
    podsByScope: {},
  }
  storage.setItem(KUBE_CACHE_KEY, JSON.stringify(normalized))
}

export function clearKubeCache(storage: Storage | undefined = globalThis.localStorage) {
  storage?.removeItem(KUBE_CACHE_KEY)
}
