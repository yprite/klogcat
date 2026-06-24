import type { PodInfo } from '../types/kube'

const deploymentPodPattern = /^(.+)-[a-z0-9]{8,10}-[a-z0-9]{5}$/
const statefulSetPodPattern = /^(.+)-\d+$/

export function stablePodPrefix(podName: string) {
  const deploymentMatch = podName.match(deploymentPodPattern)
  if (deploymentMatch) return deploymentMatch[1]
  const statefulSetMatch = podName.match(statefulSetPodPattern)
  if (statefulSetMatch) return statefulSetMatch[1]
  const lastDash = podName.lastIndexOf('-')
  return lastDash > 0 ? podName.slice(0, lastDash) : podName
}

export function findFallbackPod(stalePod: PodInfo, candidates: PodInfo[], preferredContainer?: string) {
  const running = candidates.filter((pod) => pod.phase === 'Running')
  const compatible = preferredContainer
    ? running.filter((pod) => pod.containers.includes(preferredContainer))
    : running.filter((pod) => pod.containers.some((container) => stalePod.containers.includes(container)))
  const pool = compatible.length ? compatible : running
  const stalePrefix = stablePodPrefix(stalePod.name)
  const prefixMatches = pool.filter((pod) => pod.name !== stalePod.name && stablePodPrefix(pod.name) === stalePrefix)
  if (prefixMatches.length === 1) return prefixMatches[0]
  if (prefixMatches.length > 1) return prefixMatches.sort((a, b) => a.name.localeCompare(b.name))[0]
  return pool.length === 1 && pool[0].name !== stalePod.name ? pool[0] : undefined
}
