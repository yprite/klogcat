import type { PodInfo } from '../types/kube'
import type { SourceLogType } from '../types/log'
import type { PersistedSettings } from '../types/settings'
import { scopeKey, useKubeStore } from '../stores/kubeStore'
import { useLogStore } from '../stores/logStore'
import { startLogStream, stopLogStream } from '../commands/tauriLogs'
import { buildLogPathFromPolicy, getLogPolicy } from '../utils/logPolicy'
import { enforceStreamTargetLimit, type ResolvedStreamTarget } from '../utils/streamTargets'
import { findFallbackPod } from '../utils/podFallback'

export type LogStoreState = ReturnType<typeof useLogStore.getState>
type KubeStoreState = ReturnType<typeof useKubeStore.getState>
export type SelectedTarget = { context: string; namespace: string; pod: PodInfo }
export type ContainerResolver = (containers: string[]) => string
type LaunchResult = { status: 'cancelled' | 'started' | 'failed'; container: string }

export type ToolbarStatus = {
  startBusy: boolean
  stopBusy: boolean
  alreadyRunning: boolean
  canStop: boolean
  canRestart: boolean
  disabledReason: string
  startBlockedReason: string
}

export function selectedStreamIds(log: LogStoreState) {
  if (log.activeStreamIds.length > 0) return log.activeStreamIds
  return log.activeStreamId ? [log.activeStreamId] : []
}

export function containerResolver(settings: PersistedSettings | undefined, sourceType: SourceLogType): ContainerResolver {
  const source = settings?.logSources[sourceType]
  return (containers) => source && containers.includes(source.container)
    ? source.container
    : containers[0] ?? source?.container ?? ''
}

export function toolbarStatus(
  log: LogStoreState,
  settings: PersistedSettings | undefined,
  selectedSourceTypes: SourceLogType[],
  targets: SelectedTarget[],
) {
  const startBusy = log.streamStatus === 'starting' || log.streamStatus === 'stopping'
  const stopBusy = log.streamStatus === 'stopping'
  const alreadyRunning = log.activeStreamIds.length > 0 || log.streamStatus === 'running'
  const invalidTargets = targets.filter((target) => target.pod.phase !== 'Running' || target.pod.containers.length === 0)
  const missingSourceConfig = selectedSourceTypes.some((type) => !settings?.logSources[type])
  const disabledReason = startDisabledReason(settings, selectedSourceTypes, targets, invalidTargets, missingSourceConfig)
  const startBlockedReason = startBusy ? `Busy: ${log.streamStatus}` : alreadyRunning ? 'Stream is already running' : disabledReason
  const canStop = alreadyRunning && !stopBusy
  const canRestart = alreadyRunning && !startBusy && !stopBusy

  return { startBusy, stopBusy, alreadyRunning, canStop, canRestart, disabledReason, startBlockedReason }
}

function startDisabledReason(
  settings: PersistedSettings | undefined,
  selectedSourceTypes: SourceLogType[],
  targets: SelectedTarget[],
  invalidTargets: SelectedTarget[],
  missingSourceConfig: boolean,
) {
  if (!settings) return 'Settings are not loaded'
  if (selectedSourceTypes.length === 0) return 'Select at least one log type'
  if (missingSourceConfig) return 'Settings are not loaded'
  if (targets.length === 0) return 'Select namespace and pod'
  if (invalidTargets.length > 0) return 'Every selected pod must be Running and have a container'
  return ''
}

export function operationState(log: LogStoreState, kube: KubeStoreState, targets: SelectedTarget[], selectedSourceTypes: SourceLogType[]) {
  const streamStarting = log.streamStatus === 'starting'
  const streamStopping = log.streamStatus === 'stopping'
  const refreshingPods = kube.loadingPods
  const refreshingCache = kube.cacheRefreshing
  const active = streamStarting || streamStopping || refreshingPods || refreshingCache

  const streamStatusLabels: Record<string, string> = {
    starting: 'Starting streams',
    stopping: 'Stopping streams',
    ready: 'Ready',
    idle: 'Ready',
  }
  const label = streamStatusLabels[log.streamStatus] ??
    (refreshingPods ? 'Refreshing pods' : refreshingCache ? 'Refreshing target cache' : 'Ready')
  const targetCount = Math.max(1, targets.length * selectedSourceTypes.length)
  const detail = streamStarting
    ? `${log.activeStreamIds.length}/${targetCount} streams`
    : refreshingPods
      ? `${targets.length || 1} target scope`
      : undefined

  return { active, label, detail }
}

function filePathForSettings(settings: PersistedSettings, namespace: string, pod: string, sourceType: SourceLogType) {
  return buildLogPathFromPolicy(settings.logPolicy ?? getLogPolicy(), namespace, pod, sourceType)
}

function resolvedStreamTargetsForStart(targets: SelectedTarget[], selectedSourceTypes: SourceLogType[], settings: PersistedSettings, resolveContainer: ContainerResolver): ResolvedStreamTarget[] {
  return targets.flatMap((target) => selectedSourceTypes.map((sourceType) => {
    const container = resolveContainer(target.pod.containers)
    const filePath = filePathForSettings(settings, target.namespace, target.pod.name, sourceType)
    const base = {
      context: target.context,
      namespace: target.namespace,
      pod: target.pod.name,
      container,
      sourceType,
      filePath,
    }
    return {
      ...base,
      streamTargetId: [base.context, base.namespace, base.pod, '', base.container, base.sourceType, base.filePath].join('\u0000'),
      validationState: target.pod.containers.includes(container) ? 'not_checked' : 'missing_container',
      diagnostics: target.pod.containers.includes(container) ? [] : [`container ${container} not found in pod ${target.pod.name}`],
    }
  }))
}

function streamLimitErrorMessage(result: ReturnType<typeof enforceStreamTargetLimit>) {
  if (result.ok) return undefined
  const hints = result.narrowingHints.map((hint) => hint.replace(/_/g, ' ')).join(', ')
  return `Too many stream targets: ${result.count}/${result.hardLimit}. Narrow selection: ${hints}`
}

function replaceSelectedPod(context: string, namespace: string, stalePod: string, fallbackPod: string) {
  const key = scopeKey(context, namespace)
  const current = useKubeStore.getState().selectedPods[key] ?? []
  const next = current.map((pod) => pod === stalePod ? fallbackPod : pod)
  useKubeStore.setState((state) => ({
    selectedPods: { ...state.selectedPods, [key]: next },
    selectedPod: state.selectedPod === stalePod ? fallbackPod : state.selectedPod,
  }))
}

async function resolveLiveTargetsForStart(
  targets: SelectedTarget[],
  resolveContainer: ContainerResolver,
  log: LogStoreState,
) {
  await useKubeStore.getState().refreshPodsForSelections()
  const state = useKubeStore.getState()
  const selectedEntries = Object.entries(state.selectedPods)
  if (selectedEntries.length === 0) return useKubeStore.getState().getSelectedPodTargets()

  const resolved: SelectedTarget[] = []
  for (const [key, selectedNames] of selectedEntries) {
    resolved.push(...resolveSelectedPodsForScope(key, selectedNames, state, targets, resolveContainer, log))
  }
  return resolved
}

function resolveSelectedPodsForScope(
  key: string,
  selectedNames: string[],
  state: KubeStoreState,
  targets: SelectedTarget[],
  resolveContainer: ContainerResolver,
  log: LogStoreState,
) {
  const [context, namespace] = key.split('\u0000')
  const pods = state.podsByScope[key] ?? []
  const resolved: SelectedTarget[] = []

  for (const selectedName of selectedNames) {
    const exact = pods.find((pod) => pod.name === selectedName)
    if (exact) {
      resolved.push({ context, namespace, pod: exact })
      continue
    }
    const fallback = fallbackForStaleSelection(context, namespace, selectedName, pods, targets, resolveContainer)
    if (fallback) {
      replaceSelectedPod(context, namespace, selectedName, fallback.name)
      log.recordActionDebug(`Pod live resolve: ${context}/${namespace}/${selectedName} -> ${fallback.name}`)
      resolved.push({ context, namespace, pod: fallback })
    }
  }

  return resolved
}

function fallbackForStaleSelection(
  context: string,
  namespace: string,
  selectedName: string,
  pods: PodInfo[],
  targets: SelectedTarget[],
  resolveContainer: ContainerResolver,
) {
  const previousPod = targets.find((target) =>
    target.context === context && target.namespace === namespace && target.pod.name === selectedName,
  )?.pod
  const stalePod = previousPod ?? { name: selectedName, namespace, phase: 'Running' as const, containers: pods[0]?.containers ?? [] }
  return findFallbackPod(stalePod, pods, resolveContainer(stalePod.containers))
}

async function resolveFallbackTarget(target: SelectedTarget, container: string, log: LogStoreState) {
  await useKubeStore.getState().refreshPodsForSelections()
  const key = scopeKey(target.context, target.namespace)
  const refreshedPods = useKubeStore.getState().podsByScope[key] ?? []
  if (refreshedPods.some((pod) => pod.name === target.pod.name)) return undefined

  const fallbackPod = findFallbackPod(target.pod, refreshedPods, container)
  if (!fallbackPod) return undefined

  replaceSelectedPod(target.context, target.namespace, target.pod.name, fallbackPod.name)
  log.recordActionDebug(`Pod fallback: ${target.context}/${target.namespace}/${target.pod.name} -> ${fallbackPod.name}`)
  return { ...target, pod: fallbackPod }
}

async function launchLogStream(
  target: SelectedTarget,
  selectedSourceType: SourceLogType,
  settings: PersistedSettings,
  resolveContainer: ContainerResolver,
  log: LogStoreState,
): Promise<LaunchResult> {
  const container = resolveContainer(target.pod.containers)
  const filePath = filePathForSettings(settings, target.namespace, target.pod.name, selectedSourceType)
  const streamId = crypto.randomUUID()
  const sourceId = `${target.context}/${target.namespace}/${target.pod.name}/${container}/${selectedSourceType}/${filePath}`
  log.prepareStarting({ streamId, sourceId, context: target.context, namespace: target.namespace, pod: target.pod.name, container, filePath, sourceType: selectedSourceType, initialTailLines: settings.initialTailLines })

  try {
    await startLogStream({ streamId, context: target.context, namespace: target.namespace, pod: target.pod.name, container, filePath, sourceType: selectedSourceType, initialTailLines: settings.initialTailLines })
    return await settleStartedStream(streamId, container, log)
  } catch (error) {
    log.markStartRejected(streamId, error)
    return { status: 'failed', container }
  }
}

async function settleStartedStream(streamId: string, container: string, log: LogStoreState): Promise<LaunchResult> {
  if (!useLogStore.getState().activeStreamIds.includes(streamId)) {
    try { await stopLogStream(streamId) } catch { /* best-effort cleanup for cancelled start */ }
    return { status: 'cancelled', container }
  }
  log.markRunning(streamId)
  return { status: 'started', container }
}

export async function stopStreams(log: LogStoreState, ids: string[], recordEmptyError: boolean) {
  if (!ids.length) {
    if (recordEmptyError) log.markError(undefined, 'No active stream to stop')
    return
  }
  await Promise.all(ids.map(async (id) => {
    log.markStopping(id)
    try {
      await stopLogStream(id)
      log.markStopped(id)
    } catch (error) {
      log.markError(id, error instanceof Error ? error.message : String(error))
    }
  }))
}

export async function startStreams({
  selectedSourceTypes,
  targets,
  settings,
  log,
  status,
  resolveContainer,
  allowRestart,
}: {
  selectedSourceTypes: SourceLogType[]
  targets: SelectedTarget[]
  settings: PersistedSettings | undefined
  log: LogStoreState
  status: ToolbarStatus
  resolveContainer: ContainerResolver
  allowRestart: boolean
}) {
  log.recordActionDebug(startDebugMessage(log, targets, selectedSourceTypes, resolveContainer, status.startBlockedReason))
  if (status.startBusy) { log.markError(undefined, `Busy: ${log.streamStatus}`); return }
  if (status.alreadyRunning && !allowRestart) { log.markError(log.activeStreamId, 'Stream is already running'); return }
  if (status.disabledReason || !settings) { log.markError(undefined, status.disabledReason || 'invalid_source_config'); return }

  const liveTargets = await resolveLiveTargetsForStart(targets, resolveContainer, log)
  if (liveTargets.length === 0) { log.markError(undefined, 'No live pod found for selected target'); return }

  const limitMessage = streamLimitErrorMessage(enforceStreamTargetLimit(resolvedStreamTargetsForStart(liveTargets, selectedSourceTypes, settings, resolveContainer)))
  if (limitMessage) { log.markError(undefined, limitMessage); return }

  for (const originalTarget of liveTargets) {
    const cancelled = await startTargetStreams(originalTarget, selectedSourceTypes, settings, resolveContainer, log)
    if (cancelled) return
  }
}

function startDebugMessage(
  log: LogStoreState,
  targets: SelectedTarget[],
  selectedSourceTypes: SourceLogType[],
  resolveContainer: ContainerResolver,
  startBlockedReason: string,
) {
  const targetText = targets
    .map((target) => `${target.context}/${target.namespace}/${target.pod.name}/${resolveContainer(target.pod.containers)}`)
    .join(', ') || '(none)'
  return `Start clicked: status=${log.streamStatus}, targets=${targetText}, sources=${selectedSourceTypes.join(', ') || '(none)'}, startBlockedReason=${startBlockedReason || '(none)'}`
}

async function startTargetStreams(
  originalTarget: SelectedTarget,
  selectedSourceTypes: SourceLogType[],
  settings: PersistedSettings,
  resolveContainer: ContainerResolver,
  log: LogStoreState,
) {
  let target = originalTarget
  for (const selectedSourceType of selectedSourceTypes) {
    const result = await launchLogStream(target, selectedSourceType, settings, resolveContainer, log)
    if (result.status === 'cancelled') return true
    if (result.status === 'started') continue

    const fallbackTarget = await resolveFallbackTarget(target, result.container, log)
    if (!fallbackTarget) continue
    target = fallbackTarget
    const retry = await launchLogStream(target, selectedSourceType, settings, resolveContainer, log)
    if (retry.status === 'cancelled') return true
  }
  return false
}
