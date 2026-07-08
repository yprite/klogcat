import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { parseScopeKey, scopeKey, useKubeStore } from '../stores/kubeStore'
import type { ContextInfo, NamespaceInfo, PodInfo } from '../types/kube'
import { ActivityDots, ActivityRing, ProgressStripe } from './ProgressFeedback'
import { useSettingsStore } from '../stores/settingsStore'
import { useVmStore, vmTargetValue } from '../stores/vmStore'
import { isTargetPluginEnabled } from '../plugins/targetPluginRegistry'
import { targetSelectionPanels } from '../plugins/targetSelectionPanels'
import { isCsvTargetId } from '../plugins/csvFileTargetPlugin'
import { t, translatePhase, type Language } from '../utils/i18n'

type TargetSelectionHandlers = {
  onClose: () => void
  onContextChange: (contexts: string[]) => void | Promise<void>
  onNamespaceChange: (namespaces: string[]) => void | Promise<void>
  onPodChange: (pods: string[]) => void | Promise<void>
  onVmTargetChange?: (targets: string[]) => void | Promise<void>
}

type VisibleNamespace = { namespace: NamespaceInfo; pods: PodInfo[] }
type VisibleContext = { context: ContextInfo; namespaces: VisibleNamespace[] }

const podValue = (context: string, namespace: string, pod: string) => `${scopeKey(context, namespace)}\u0000${pod}`
export const selectedPodValues = (selectedPods: Record<string, string[]>) => Object.entries(selectedPods).flatMap(([key, pods]) => pods.map((pod) => `${key}\u0000${pod}`))
const toggleValue = (values: string[], value: string) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value]

function phaseClass(phase: string) {
  if (phase === 'Running') return 'border-emerald-700 bg-emerald-950 text-emerald-300'
  if (phase === 'Pending') return 'border-yellow-700 bg-yellow-950 text-yellow-300'
  if (phase === 'Failed') return 'border-red-700 bg-red-950 text-red-300'
  return 'border-slate-700 bg-slate-900 text-slate-300'
}

function panelIdForContext(contextName: string) {
  return `target-context-${contextName.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function splitSelectedPodValue(value: string) {
  const parts = value.split('\u0000')
  if (parts.length === 3) return { scope: parts.slice(0, 2).join('\u0000'), pod: parts[2] }
  return { scope: '', pod: value }
}

function useSelectionDrafts(selectionPending: boolean) {
  const kube = useKubeStore()
  const storeContextValues = kube.selectedContexts.length ? kube.selectedContexts : kube.selectedContext ? [kube.selectedContext] : []
  const storeNamespaceValues = Object.entries(kube.selectedNamespaces).flatMap(([context, namespaces]) => namespaces.map((namespace) => scopeKey(context, namespace)))
  const storeSelectedPods = selectedPodValues(kube.selectedPods)
  const [draftContextValues, setDraftContextValues] = useState<string[]>(storeContextValues)
  const [draftNamespaceValues, setDraftNamespaceValues] = useState<string[]>(storeNamespaceValues)
  const [draftSelectedPods, setDraftSelectedPods] = useState<string[]>(storeSelectedPods)

  useEffect(() => {
    if (selectionPending) return
    setDraftContextValues(storeContextValues)
    setDraftNamespaceValues(storeNamespaceValues)
    setDraftSelectedPods(storeSelectedPods)
  }, [selectionPending, storeContextValues.join('\u0000'), storeNamespaceValues.join('\u0000'), storeSelectedPods.join('\u0000')])

  return {
    kube,
    contextValues: draftContextValues,
    namespaceValues: draftNamespaceValues,
    selectedPods: draftSelectedPods,
    setDraftContextValues,
    setDraftNamespaceValues,
    setDraftSelectedPods,
  }
}

function buildVisibleTree(kube: ReturnType<typeof useKubeStore.getState>, normalizedQuery: string) {
  const matches = (values: string[]) => values.join(' ').toLowerCase().includes(normalizedQuery)
  return kube.contexts.map((context) => {
    const namespaces = kube.namespacesByContext[context.name] ?? (context.name === kube.selectedContext ? kube.namespaces : [])
    const visibleNamespaces = namespaces.map((namespace) => {
      const pods = kube.podsByScope[scopeKey(context.name, namespace.name)] ?? []
      const visiblePods = pods.filter((pod) => matches([context.name, namespace.name, pod.name, pod.phase, ...pod.containers]))
      return { namespace, pods: matches([context.name, namespace.name]) ? pods : visiblePods }
    }).filter(({ namespace, pods }) => !normalizedQuery || matches([context.name, namespace.name]) || pods.length > 0)
    return { context, namespaces: visibleNamespaces }
  }).filter(({ context, namespaces }) => !normalizedQuery || context.name.toLowerCase().includes(normalizedQuery) || namespaces.length > 0)
}

function ProgressPanel({ progressLabel, language }: { progressLabel: string; language?: Language }) {
  return <div className="rounded border border-yellow-400/30 bg-slate-900/90 px-2 py-1.5">
    <div className="flex items-center justify-between gap-3 text-xs text-yellow-100">
      <span className="inline-flex items-center gap-2"><ActivityRing label={`${progressLabel || t(language, 'Target refresh')} activity`} />{progressLabel || t(language, 'Updating targets')}</span>
      <ActivityDots label={t(language, 'Target progress dots')} />
    </div>
  </div>
}

function LoadingTargetsBanner({ progressLabel, language }: { progressLabel: string; language?: Language }) {
  return <div role="status" aria-label={t(language, 'Loading targets')} className="mb-3 overflow-hidden rounded border border-yellow-400/30 bg-slate-900 px-3 py-2 text-xs text-slate-300 animate-klogcat-status-glow">
    <div className="mb-2 flex items-center gap-2">
      <ActivityRing label={t(language, 'Loading targets activity')} />
      <span>{progressLabel || t(language, 'Loading targets')}</span>
      <ActivityDots label={t(language, 'Loading targets progress')} />
    </div>
    <ProgressStripe label={t(language, 'Target discovery progress')} />
  </div>
}

function EmptyTargetsState({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded border border-dashed border-slate-700 bg-slate-900/60 p-4">
    <p className="text-sm font-semibold text-slate-100">{title}</p>
    <p className="mt-2 text-sm text-slate-400">{detail}</p>
  </div>
}

type TargetTreeProps = {
  language?: Language
  collapsedContexts: Record<string, boolean>
  contextValues: string[]
  namespaceValues: string[]
  onContextChange: (contexts: string[]) => void | Promise<void>
  onNamespaceChange: (namespaces: string[]) => void | Promise<void>
  onPodChange: (pods: string[]) => void | Promise<void>
  progressLabel: string
  runSelectionChange: (change: () => void | Promise<void>, lockControls?: boolean) => void
  selectedPods: string[]
  selectionPending: boolean
  setCollapsedContexts: (update: (current: Record<string, boolean>) => Record<string, boolean>) => void
  setDraftContextValues: (values: string[]) => void
  setDraftNamespaceValues: (values: string[]) => void
  setDraftSelectedPods: (values: string[]) => void
  visibleTree: VisibleContext[]
  emptyState: { title: string; detail: string }
}

function TargetTree(props: TargetTreeProps) {
  const kube = useKubeStore()
  const loadingTargets = kube.loadingContexts || kube.loadingNamespaces || kube.cacheRefreshing
  return <div aria-label={t(props.language, 'Target tree')} className="min-h-0 flex-1 overflow-y-auto p-3">
    {loadingTargets && <LoadingTargetsBanner progressLabel={props.progressLabel} language={props.language} />}
    {props.visibleTree.length === 0 && !kube.loadingContexts && !kube.loadingNamespaces && <EmptyTargetsState {...props.emptyState} />}
    {props.visibleTree.map((item) => <ContextPanel key={item.context.name} {...props} contextItem={item} />)}
  </div>
}

function ContextPanel({ contextItem, collapsedContexts, contextValues, namespaceValues, onContextChange, onNamespaceChange, onPodChange, runSelectionChange, selectedPods, selectionPending, setCollapsedContexts, setDraftContextValues, setDraftNamespaceValues, setDraftSelectedPods, language }: TargetTreeProps & { contextItem: VisibleContext }) {
  const kube = useKubeStore()
  const { context, namespaces } = contextItem
  const contextChecked = contextValues.includes(context.name)
  const collapsed = Boolean(collapsedContexts[context.name])
  const panelId = panelIdForContext(context.name)
  const toggleExpanded = () => setCollapsedContexts((current) => ({ ...current, [context.name]: !current[context.name] }))
  const toggleContext = () => {
    const next = toggleValue(contextValues, context.name)
    setDraftContextValues(next)
    runSelectionChange(() => onContextChange(next), false)
  }

  return <div className="mb-3 rounded border border-slate-800 bg-slate-900/40">
    <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2 font-semibold text-white">
      <button type="button" aria-expanded={!collapsed} aria-controls={panelId} aria-label={`${t(language, collapsed ? 'Expand' : 'Collapse')} ${context.name}`} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-700 bg-slate-950 text-xs text-slate-200 hover:border-yellow-400 hover:text-yellow-300" onClick={toggleExpanded}>
        <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
      </button>
      <label className={`flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 ${contextChecked ? 'bg-yellow-400/10 text-yellow-100 ring-1 ring-yellow-400/30' : ''}`}>
        <input type="checkbox" checked={contextChecked} disabled={selectionPending} onChange={toggleContext} />
        <span className="min-w-0 truncate">{context.name}</span>
        {contextChecked && <span className="shrink-0 rounded bg-yellow-400 px-1.5 py-0.5 text-[10px] font-semibold text-slate-950">{t(language, 'Selected')}</span>}
        <span className="shrink-0 text-xs font-normal text-slate-500">{namespaces.length} {t(language, 'namespaces')}</span>
      </label>
    </div>
    {!collapsed && <div id={panelId} className="space-y-2 p-2">
      {namespaces.length === 0 && kube.loadingNamespaces && <NamespaceSkeleton contextName={context.name} />}
      {namespaces.map((namespaceItem) => <NamespacePanel key={scopeKey(context.name, namespaceItem.namespace.name)} context={context} namespaceItem={namespaceItem} namespaceValues={namespaceValues} onNamespaceChange={onNamespaceChange} onPodChange={onPodChange} runSelectionChange={runSelectionChange} selectedPods={selectedPods} selectionPending={selectionPending} setDraftNamespaceValues={setDraftNamespaceValues} setDraftSelectedPods={setDraftSelectedPods} />)}
    </div>}
  </div>
}

function NamespaceSkeleton({ contextName }: { contextName: string }) {
  return <div className="space-y-2 px-1 py-2" aria-label={t(useSettingsStore.getState().settings?.language, 'Loading namespaces for {name}', { name: contextName })}>
    <div className="h-8 animate-pulse rounded bg-slate-800/70" />
    <div className="h-8 animate-pulse rounded bg-slate-800/40" />
  </div>
}

type NamespacePanelProps = {
  context: ContextInfo
  namespaceItem: VisibleNamespace
  namespaceValues: string[]
  onNamespaceChange: (namespaces: string[]) => void | Promise<void>
  onPodChange: (pods: string[]) => void | Promise<void>
  runSelectionChange: (change: () => void | Promise<void>, lockControls?: boolean) => void
  selectedPods: string[]
  selectionPending: boolean
  setDraftNamespaceValues: (values: string[]) => void
  setDraftSelectedPods: (values: string[]) => void
}

function NamespacePanel({ context, namespaceItem, namespaceValues, onNamespaceChange, onPodChange, runSelectionChange, selectedPods, selectionPending, setDraftNamespaceValues, setDraftSelectedPods }: NamespacePanelProps) {
  const kube = useKubeStore()
  const { namespace, pods } = namespaceItem
  const nsKey = scopeKey(context.name, namespace.name)
  const namespaceChecked = namespaceValues.includes(nsKey)
  const toggleNamespace = () => {
    const next = toggleValue(namespaceValues, nsKey)
    setDraftNamespaceValues(next)
    runSelectionChange(() => onNamespaceChange(next), false)
  }

  return <div className="rounded border border-slate-800 bg-slate-950/70">
    <label className={`flex items-center gap-2 px-3 py-2 text-sm font-medium ${namespaceChecked ? 'bg-yellow-400/10 text-yellow-100' : 'text-slate-100'}`}>
      <input type="checkbox" checked={namespaceChecked} disabled={selectionPending} onChange={toggleNamespace} />
      <span>{namespace.name}</span>
      {namespaceChecked && <span className="rounded bg-yellow-400 px-1.5 py-0.5 text-[10px] font-semibold text-slate-950">{t(useSettingsStore.getState().settings?.language, 'Selected')}</span>}
      <span className="text-xs font-normal text-slate-500">{pods.length} {t(useSettingsStore.getState().settings?.language, 'pods')}</span>
    </label>
    <div className="space-y-1 pb-2 pl-7 pr-2">
      {pods.length === 0 && kube.loadingPods && namespaceChecked && <LoadingPods namespaceName={namespace.name} />}
      {pods.length === 0 && (!kube.loadingPods || !namespaceChecked) && <p className="px-2 py-1 text-xs text-slate-500">{t(useSettingsStore.getState().settings?.language, 'No loaded pods')}</p>}
      {pods.map((pod) => <PodRow key={podValue(context.name, namespace.name, pod.name)} context={context.name} namespace={namespace.name} onPodChange={onPodChange} pod={pod} runSelectionChange={runSelectionChange} selectedPods={selectedPods} selectionPending={selectionPending} setDraftSelectedPods={setDraftSelectedPods} />)}
    </div>
  </div>
}

function LoadingPods({ namespaceName }: { namespaceName: string }) {
  const language = useSettingsStore((s) => s.settings?.language)
  return <div role="status" aria-label={t(language, 'Loading pods for {name}', { name: namespaceName })} className="mx-2 my-1 rounded border border-yellow-400/20 bg-yellow-400/5 px-2 py-1.5 text-xs text-yellow-100">
    <div className="mb-1 flex items-center gap-2"><ActivityRing label={t(language, 'Loading pods activity')} /><span>{t(language, 'Loading pods')}</span><ActivityDots label={t(language, 'Loading pods progress')} /></div>
    <ProgressStripe label={`${t(language, 'Loading pods progress')} ${namespaceName}`} />
  </div>
}

function getProgressLabelFromKube(kube: ReturnType<typeof useKubeStore.getState>, language?: Language) {
  if (kube.targetRefreshPhase) return t(language, kube.targetRefreshPhase)
  if (kube.cacheRefreshing) return t(language, 'Refreshing cache')
  if (kube.loadingContexts) return t(language, 'Loading contexts')
  if (kube.loadingNamespaces) return t(language, 'Loading namespaces')
  if (kube.loadingPods) return t(language, 'Loading pods')
  return ''
}

function resolveTargetSearchState(kube: ReturnType<typeof useKubeStore.getState>, query: string, language?: Language) {
  if (kube.error) return { title: t(language, 'Target discovery failed'), detail: kube.error.message }
  if (query) return { title: t(language, 'No targets match the current search'), detail: t(language, 'Clear or broaden the search to show available clusters, namespaces, and pods.') }
  return { title: t(language, 'No selectable pods loaded'), detail: t(language, 'Check kubectl access, refresh targets, or select a namespace that has running pods.') }
}

function getDiscoverySummaryState(kube: ReturnType<typeof useKubeStore.getState>) {
  return {
    discoveryActive: kube.loadingContexts || kube.loadingNamespaces || kube.cacheRefreshing,
    podRefreshActive: kube.loadingPods,
  }
}

function contextsToProbeFromStore(kube: ReturnType<typeof useKubeStore.getState>, contextValues: string[]) {
  const availableContexts = kube.contexts.map((context) => context.name)
  return availableContexts.length ? availableContexts : contextValues
}

function createSelectionChangeHandler(selectionPending: boolean, setSelectionPending: (value: boolean) => void) {
  return (change: () => void | Promise<void>, lockControls = true) => {
    if (selectionPending) return
    const result = change()
    if (!result || typeof result.then !== 'function') return
    if (lockControls) setSelectionPending(true)
    void result.finally(() => {
      if (lockControls) setSelectionPending(false)
    }).catch(() => undefined)
  }
}

function targetPickerCopy(vmTargetsEnabled: boolean) {
  if (vmTargetsEnabled) return {
    helpText: 'Kubernetes uses Cluster -> Namespace -> Pod. VM uses Region/Bastion -> Module -> VM.',
    searchPlaceholder: 'context / namespace / pod / region / bastion / module / VM name / IP',
  }
  return {
    helpText: 'Kubernetes uses Cluster -> Namespace -> Pod.',
    searchPlaceholder: 'context / namespace / pod',
  }
}

type PodRowProps = {
  context: string
  namespace: string
  onPodChange: (pods: string[]) => void | Promise<void>
  pod: PodInfo
  runSelectionChange: (change: () => void | Promise<void>, lockControls?: boolean) => void
  selectedPods: string[]
  selectionPending: boolean
  setDraftSelectedPods: (values: string[]) => void
}

function PodRow({ context, namespace, onPodChange, pod, runSelectionChange, selectedPods, selectionPending, setDraftSelectedPods }: PodRowProps) {
  const value = podValue(context, namespace, pod.name)
  const podChecked = selectedPods.includes(value)
  const togglePod = () => {
    const next = toggleValue(selectedPods, value)
    setDraftSelectedPods(next)
    runSelectionChange(() => onPodChange(next))
  }

  return <label className={`flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-800 ${podChecked ? 'border border-yellow-400/40 bg-yellow-400/10 text-yellow-100 shadow-[0_0_0_1px_rgba(250,204,21,0.10)]' : 'text-slate-200'}`}>
    <input aria-label={`${context} / ${namespace} / ${pod.name}`} type="checkbox" checked={podChecked} disabled={selectionPending} onChange={togglePod} />
    <span className="min-w-0 flex-1 truncate">{pod.name}</span>
    {podChecked && <span className="rounded bg-yellow-400 px-1.5 py-0.5 text-[10px] font-semibold text-slate-950">{t(useSettingsStore.getState().settings?.language, 'Selected')}</span>}
    <span className={`rounded border px-1.5 py-0.5 text-[10px] ${phaseClass(pod.phase)}`}>{translatePhase(useSettingsStore.getState().settings?.language, pod.phase)}</span>
  </label>
}

type SelectedTargetsProps = {
  vmTargetsEnabled: boolean
  onPodChange: (pods: string[]) => void | Promise<void>
  onVmTargetChange: (targets: string[]) => void | Promise<void>
  runSelectionChange: (change: () => void | Promise<void>, lockControls?: boolean) => void
  selectedPods: string[]
  selectedVmTargets: string[]
  selectionPending: boolean
  setDraftSelectedPods: (values: string[]) => void
  setDraftSelectedVmTargets: (values: string[]) => void
}

function SelectedTargetsPanel({ onPodChange, onVmTargetChange, runSelectionChange, selectedPods, selectedVmTargets, selectionPending, setDraftSelectedPods, setDraftSelectedVmTargets, vmTargetsEnabled }: SelectedTargetsProps) {
  return <aside aria-label={t(useSettingsStore.getState().settings?.language, 'Selected targets')} className="min-h-0 overflow-y-auto border-t border-slate-800 bg-slate-900/40 p-3 lg:border-l lg:border-t-0">
    <div className="mb-3 rounded border border-slate-800 bg-slate-950 p-3">
      <h3 className="text-sm font-semibold">{t(useSettingsStore.getState().settings?.language, 'Selected targets')}</h3>
      <p className="mt-1 text-xs text-slate-400">{t(useSettingsStore.getState().settings?.language, '{count} selected', { count: selectedPods.length + selectedVmTargets.length })}{selectionPending ? ` · ${t(useSettingsStore.getState().settings?.language, 'applying…')}` : ''}</p>
    </div>
    {selectionPending && <div role="status" aria-label={t(useSettingsStore.getState().settings?.language, 'Selection shown immediately')} className="mb-2 rounded border border-yellow-400/30 bg-yellow-400/10 px-2 py-1 text-xs text-yellow-100">{t(useSettingsStore.getState().settings?.language, 'Selection shown immediately. Applying target change…')}</div>}
    <div className="space-y-2">
      {selectedPods.length === 0 && selectedVmTargets.length === 0 && <NoSelectedTargets vmTargetsEnabled={vmTargetsEnabled} />}
      {selectedPods.map((value) => <SelectedTargetButton key={value} onPodChange={onPodChange} runSelectionChange={runSelectionChange} selectedPods={selectedPods} selectionPending={selectionPending} setDraftSelectedPods={setDraftSelectedPods} value={value} />)}
      {selectedVmTargets.map((value) => <SelectedVmTargetButton key={value} onVmTargetChange={onVmTargetChange} runSelectionChange={runSelectionChange} selectedVmTargets={selectedVmTargets} selectionPending={selectionPending} setDraftSelectedVmTargets={setDraftSelectedVmTargets} value={value} />)}
    </div>
  </aside>
}

function NoSelectedTargets({ vmTargetsEnabled }: { vmTargetsEnabled: boolean }) {
  return <div className="rounded border border-dashed border-slate-700 bg-slate-950 p-3 text-xs text-slate-400">
    <p className="font-semibold text-slate-200">{t(useSettingsStore.getState().settings?.language, vmTargetsEnabled ? 'No targets selected' : 'No pods selected')}</p>
    <p className="mt-1">{t(useSettingsStore.getState().settings?.language, vmTargetsEnabled ? 'Choose one or more Kubernetes pods or VM targets.' : 'Choose one or more running pods from the target tree.')}</p>
  </div>
}

function SelectedTargetButton({ onPodChange, runSelectionChange, selectedPods, selectionPending, setDraftSelectedPods, value }: Pick<SelectedTargetsProps, 'onPodChange' | 'runSelectionChange' | 'selectedPods' | 'selectionPending' | 'setDraftSelectedPods'> & { value: string }) {
  const { scope, pod } = splitSelectedPodValue(value)
  const { context, namespace } = parseScopeKey(scope)
  const removePod = () => {
    const next = selectedPods.filter((item) => item !== value)
    setDraftSelectedPods(next)
    runSelectionChange(() => onPodChange(next))
  }

  return <button disabled={selectionPending} className="block w-full rounded border border-yellow-400/40 bg-yellow-400/10 px-2 py-1 text-left text-xs text-yellow-100 hover:bg-yellow-400/20 disabled:cursor-not-allowed disabled:opacity-70" onClick={removePod}>
    {context} / {namespace} / {pod} ×
  </button>
}

function SelectedVmTargetButton({ onVmTargetChange, runSelectionChange, selectedVmTargets, selectionPending, setDraftSelectedVmTargets, value }: Pick<SelectedTargetsProps, 'onVmTargetChange' | 'runSelectionChange' | 'selectedVmTargets' | 'selectionPending' | 'setDraftSelectedVmTargets'> & { value: string }) {
  const target = useVmStore.getState().targets.find((item) => vmTargetValue(item) === value)
  const label = target ? [target.bastionName, target.moduleName, target.name, target.address].filter(Boolean).join(' / ') : value
  const targetLabel = isCsvTargetId(value) ? 'CSV' : 'AWS VM'
  const removeTarget = () => {
    const next = selectedVmTargets.filter((item) => item !== value)
    setDraftSelectedVmTargets(next)
    runSelectionChange(() => onVmTargetChange(next))
  }

  return <button disabled={selectionPending} className="block w-full rounded border border-sky-400/40 bg-sky-400/10 px-2 py-1 text-left text-xs text-sky-100 hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-70" onClick={removeTarget}>
    {targetLabel} / {label} ×
  </button>
}

export function TargetPickerDialog({ onClose, onContextChange, onNamespaceChange, onPodChange, onVmTargetChange = () => undefined }: TargetSelectionHandlers) {
  const [query, setQuery] = useState('')
  const language = useSettingsStore((s) => s.settings?.language)
  const awsVmTargetsEnabled = useSettingsStore((s) => isTargetPluginEnabled(s.settings?.plugins.targets, 'awsVm'))
  const csvTargetsEnabled = useSettingsStore((s) => isTargetPluginEnabled(s.settings?.plugins.targets, 'csvFile'))
  const vmTargetsEnabled = awsVmTargetsEnabled || csvTargetsEnabled
  const [selectionPending, setSelectionPending] = useState(false)
  const [collapsedContexts, setCollapsedContexts] = useState<Record<string, boolean>>({})
  const { kube, contextValues, namespaceValues, selectedPods, setDraftContextValues, setDraftNamespaceValues, setDraftSelectedPods } = useSelectionDrafts(selectionPending)
  const vm = useVmStore()
  const [draftSelectedVmTargets, setDraftSelectedVmTargets] = useState<string[]>(vm.selectedTargetIds)
  const visibleVmDraftTargets = vmTargetsEnabled ? draftSelectedVmTargets : []
  const normalizedQuery = query.trim().toLowerCase()
  const visibleTree = useMemo(() => buildVisibleTree(kube, normalizedQuery), [kube, normalizedQuery])
  const contextsToProbe = contextsToProbeFromStore(kube, contextValues)
  const { discoveryActive, podRefreshActive } = getDiscoverySummaryState(kube)
  const AwsVmTargetSelectionPanel = targetSelectionPanels.awsVm
  const CsvFileTargetSelectionPanel = targetSelectionPanels.csvFile
  const progressLabel = getProgressLabelFromKube(kube, language)
  const emptyState = resolveTargetSearchState(kube, normalizedQuery, language)

  useEffect(() => {
    const targets = contextsToProbe.length ? contextsToProbe : contextValues
    if (targets.length === 0) return
    void useKubeStore.getState().ensureNamespacesForContexts(targets)
  }, [contextsToProbe.join('\u0000'), contextValues.join('\u0000')])

  const runSelectionChange = createSelectionChangeHandler(selectionPending, setSelectionPending)
  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') onClose()
  }
  const [targetTab, setTargetTab] = useState<'kubernetes' | 'aws-vm' | 'csv-file'>('kubernetes')

  useEffect(() => {
    if ((!awsVmTargetsEnabled && targetTab === 'aws-vm') || (!csvTargetsEnabled && targetTab === 'csv-file')) setTargetTab('kubernetes')
  }, [targetTab, awsVmTargetsEnabled, csvTargetsEnabled])

  useEffect(() => {
    if ((targetTab !== 'aws-vm' && targetTab !== 'csv-file') || !vmTargetsEnabled) return
    const pluginSettings = useSettingsStore.getState().settings?.plugins.targets
    const vmState = useVmStore.getState()
    if (pluginSettings && !vmState.loading && vmState.targets.length === 0) void vmState.loadTargets(pluginSettings)
  }, [targetTab, vmTargetsEnabled])
  const activeTargetTab = vmTargetsEnabled ? targetTab : 'kubernetes'

  useEffect(() => {
    if (selectionPending) return
    setDraftSelectedVmTargets(vmTargetsEnabled ? vm.selectedTargetIds : [])
  }, [selectionPending, vmTargetsEnabled, vm.selectedTargetIds.join('\u0000')])

  const { helpText, searchPlaceholder } = targetPickerCopy(vmTargetsEnabled)

  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-2 sm:p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="target-picker-title" onKeyDown={handleDialogKeyDown} className="flex max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-950 shadow-xl">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-slate-800 p-3 sm:p-4">
        <div className="min-w-0">
          <h2 id="target-picker-title" className="text-lg font-semibold">{t(language, 'Select Log Targets')}</h2>
          <p className="text-xs text-slate-400">{t(language, helpText)}</p>
        </div>
        {(discoveryActive || podRefreshActive) && <ProgressPanel progressLabel={progressLabel} language={language} />}
        <button className="rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800" onClick={onClose}>{t(language, 'Close')}</button>
      </div>
      <div className="shrink-0 border-b border-slate-800 p-3">
        <label className="block text-xs uppercase text-slate-400">{t(language, 'Search targets')}</label>
        <input aria-label={t(language, 'Search targets')} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t(language, searchPlaceholder)} className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500" />
        {vmTargetsEnabled && <div className="mt-3 inline-flex max-w-full overflow-x-auto rounded border border-slate-700 bg-slate-900 p-1" role="tablist" aria-label={t(language, 'Target source')}>
          <button className={`rounded px-3 py-1 text-sm ${activeTargetTab === 'kubernetes' ? 'bg-yellow-400 text-slate-950' : 'text-slate-300 hover:bg-slate-800'}`} role="tab" aria-selected={activeTargetTab === 'kubernetes'} onClick={() => setTargetTab('kubernetes')}>{t(language, 'Kubernetes')}</button>
          {awsVmTargetsEnabled && <button className={`rounded px-3 py-1 text-sm ${activeTargetTab === 'aws-vm' ? 'bg-yellow-400 text-slate-950' : 'text-slate-300 hover:bg-slate-800'}`} role="tab" aria-selected={activeTargetTab === 'aws-vm'} onClick={() => setTargetTab('aws-vm')}>{t(language, 'AWS VM')}</button>}
          {csvTargetsEnabled && <button className={`rounded px-3 py-1 text-sm ${activeTargetTab === 'csv-file' ? 'bg-yellow-400 text-slate-950' : 'text-slate-300 hover:bg-slate-800'}`} role="tab" aria-selected={activeTargetTab === 'csv-file'} onClick={() => setTargetTab('csv-file')}>{t(language, 'CSV File')}</button>}
        </div>}
      </div>
      <div data-testid="target-picker-layout" className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-h-0 flex-col overflow-hidden">
          {activeTargetTab === 'aws-vm'
            ? <AwsVmTargetSelectionPanel language={language} normalizedQuery={normalizedQuery} onVmTargetChange={onVmTargetChange} runSelectionChange={runSelectionChange} selectedVmTargets={visibleVmDraftTargets} selectionPending={selectionPending} setDraftSelectedVmTargets={setDraftSelectedVmTargets} />
            : activeTargetTab === 'csv-file'
              ? <CsvFileTargetSelectionPanel language={language} normalizedQuery={normalizedQuery} onVmTargetChange={onVmTargetChange} runSelectionChange={runSelectionChange} selectedVmTargets={visibleVmDraftTargets} selectionPending={selectionPending} setDraftSelectedVmTargets={setDraftSelectedVmTargets} />
            : <TargetTree collapsedContexts={collapsedContexts} contextValues={contextValues} namespaceValues={namespaceValues} onContextChange={onContextChange} onNamespaceChange={onNamespaceChange} onPodChange={onPodChange} progressLabel={progressLabel} runSelectionChange={runSelectionChange} selectedPods={selectedPods} selectionPending={selectionPending} setCollapsedContexts={setCollapsedContexts} setDraftContextValues={setDraftContextValues} setDraftNamespaceValues={setDraftNamespaceValues} setDraftSelectedPods={setDraftSelectedPods} visibleTree={visibleTree} emptyState={emptyState} language={language} />}
        </div>
        <SelectedTargetsPanel onPodChange={onPodChange} onVmTargetChange={onVmTargetChange} runSelectionChange={runSelectionChange} selectedPods={selectedPods} selectedVmTargets={visibleVmDraftTargets} selectionPending={selectionPending} setDraftSelectedPods={setDraftSelectedPods} setDraftSelectedVmTargets={setDraftSelectedVmTargets} vmTargetsEnabled={vmTargetsEnabled} />
      </div>
    </section>
  </div>
}
