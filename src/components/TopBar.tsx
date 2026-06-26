import { useEffect, useMemo, useState } from 'react'
import { parseScopeKey, scopeKey, useKubeStore } from '../stores/kubeStore'
import { ActivityDots, ActivityRing, AnimatedStatusPill, ProgressStripe } from './ProgressFeedback'

const podValue = (context: string, namespace: string, pod: string) => `${scopeKey(context, namespace)}\u0000${pod}`
const selectedPodValues = (selectedPods: Record<string, string[]>) => Object.entries(selectedPods).flatMap(([key, pods]) => pods.map((pod) => `${key}\u0000${pod}`))
const toggleValue = (values: string[], value: string) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value]

function phaseClass(phase: string) {
  if (phase === 'Running') return 'border-emerald-700 bg-emerald-950 text-emerald-300'
  if (phase === 'Pending') return 'border-yellow-700 bg-yellow-950 text-yellow-300'
  if (phase === 'Failed') return 'border-red-700 bg-red-950 text-red-300'
  return 'border-slate-700 bg-slate-900 text-slate-300'
}

function TargetPickerDialog({
  onClose,
  onContextChange,
  onNamespaceChange,
  onPodChange,
}: {
  onClose: () => void
  onContextChange: (contexts: string[]) => void | Promise<void>
  onNamespaceChange: (namespaces: string[]) => void | Promise<void>
  onPodChange: (pods: string[]) => void | Promise<void>
}) {
  const kube = useKubeStore()
  const [query, setQuery] = useState('')
  const [selectionPending, setSelectionPending] = useState(false)
  const [collapsedContexts, setCollapsedContexts] = useState<Record<string, boolean>>({})
  const normalizedQuery = query.trim().toLowerCase()
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
  const toggleContextExpanded = (contextName: string) => {
    setCollapsedContexts((current) => ({ ...current, [contextName]: !current[contextName] }))
  }
  const runSelectionChange = (change: () => void | Promise<void>) => {
    if (selectionPending) return
    const result = change()
    if (result && typeof result.then === 'function') {
      setSelectionPending(true)
      void result.finally(() => setSelectionPending(false)).catch(() => undefined)
    }
  }
  const contextValues = draftContextValues
  const contextsToProbe = kube.contexts.map((context) => context.name)
  useEffect(() => {
    const targets = contextsToProbe.length ? contextsToProbe : contextValues
    if (targets.length === 0) return
    void useKubeStore.getState().ensureNamespacesForContexts(targets)
  }, [contextsToProbe.join('\u0000'), contextValues.join('\u0000')])
  const namespaceValues = draftNamespaceValues
  const selectedPods = draftSelectedPods
  const discoveryActive = kube.loadingContexts || kube.loadingNamespaces || kube.cacheRefreshing
  const podRefreshActive = kube.loadingPods
  const progressLabel = kube.cacheRefreshing ? 'Refreshing cache' : kube.loadingContexts ? 'Loading contexts' : kube.loadingNamespaces ? 'Loading namespaces' : kube.loadingPods ? 'Loading pods' : ''
  const visibleTree = useMemo(() => kube.contexts.map((context) => {
    const namespaces = kube.namespacesByContext[context.name] ?? (context.name === kube.selectedContext ? kube.namespaces : [])
    const visibleNamespaces = namespaces.map((namespace) => {
      const pods = kube.podsByScope[scopeKey(context.name, namespace.name)] ?? []
      const visiblePods = pods.filter((pod) => {
        const haystack = [context.name, namespace.name, pod.name, pod.phase, ...pod.containers].join(' ').toLowerCase()
        return !normalizedQuery || haystack.includes(normalizedQuery)
      })
      const namespaceMatches = [context.name, namespace.name].join(' ').toLowerCase().includes(normalizedQuery)
      return { namespace, pods: namespaceMatches ? pods : visiblePods }
    }).filter(({ namespace, pods }) => {
      const namespaceMatches = [context.name, namespace.name].join(' ').toLowerCase().includes(normalizedQuery)
      return !normalizedQuery || namespaceMatches || pods.length > 0
    })
    return { context, namespaces: visibleNamespaces }
  }).filter(({ context, namespaces }) => !normalizedQuery || context.name.toLowerCase().includes(normalizedQuery) || namespaces.length > 0), [kube.contexts, kube.namespaces, kube.namespacesByContext, kube.podsByScope, kube.selectedContext, normalizedQuery])

  const emptyState = kube.error
    ? { title: 'Target discovery failed', detail: kube.error.message }
    : normalizedQuery
      ? { title: 'No targets match the current search', detail: 'Clear or broaden the search to show available clusters, namespaces, and pods.' }
      : { title: 'No selectable pods loaded', detail: 'Check kubectl access, refresh targets, or select a namespace that has running pods.' }

  return <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="target-picker-title" className="flex max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-950 shadow-xl">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800 p-4">
        <div>
          <h2 id="target-picker-title" className="text-lg font-semibold">Select Log Targets</h2>
          <p className="text-xs text-slate-400">Cluster → Namespace → Pod 구조로 선택해.</p>
        </div>
        <button className="rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800" onClick={onClose}>Close</button>
      </div>
      <div className="shrink-0 border-b border-slate-800 p-3">
        {(discoveryActive || podRefreshActive) && <div className="mb-3 rounded-lg border border-yellow-400/30 bg-slate-900/90 p-3 shadow-[0_0_24px_rgba(250,204,21,0.08)]">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs text-yellow-100">
            <span className="inline-flex items-center gap-2"><ActivityRing label={`${progressLabel || 'Target refresh'} activity`} />{progressLabel || 'Updating targets'}</span>
            <ActivityDots label="Target progress dots" />
          </div>
          <ProgressStripe label="Target discovery progress" />
        </div>}
        <label className="block text-xs uppercase text-slate-400">Search targets</label>
        <input aria-label="Search targets" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="context / namespace / pod / phase / container" className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_22rem] overflow-hidden">
        <div aria-label="Target tree" className="min-h-0 overflow-y-auto p-3">
          {(kube.loadingContexts || kube.loadingNamespaces || kube.cacheRefreshing) && <div role="status" aria-label="Loading targets" className="mb-3 overflow-hidden rounded border border-yellow-400/30 bg-slate-900 px-3 py-2 text-xs text-slate-300 animate-klogcat-status-glow">
            <div className="mb-2 flex items-center gap-2">
              <ActivityRing label="Loading targets activity" />
              <span>{progressLabel || 'Loading targets'}</span>
              <ActivityDots label="Loading targets progress" />
            </div>
            <ProgressStripe label="Loading targets progress bar" />
          </div>}
          {visibleTree.length === 0 && !kube.loadingContexts && !kube.loadingNamespaces && <div className="rounded border border-dashed border-slate-700 bg-slate-900/60 p-4">
            <p className="text-sm font-semibold text-slate-100">{emptyState.title}</p>
            <p className="mt-2 text-sm text-slate-400">{emptyState.detail}</p>
          </div>}
          {visibleTree.map(({ context, namespaces }) => {
            const contextChecked = contextValues.includes(context.name)
            const collapsed = Boolean(collapsedContexts[context.name])
            const panelId = `target-context-${context.name.replace(/[^a-zA-Z0-9_-]/g, '-')}`
            return <div key={context.name} className="mb-3 rounded border border-slate-800 bg-slate-900/40">
              <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2 font-semibold text-white">
                <button
                  type="button"
                  aria-expanded={!collapsed}
                  aria-controls={panelId}
                  aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${context.name}`}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-700 bg-slate-950 text-xs text-slate-200 hover:border-yellow-400 hover:text-yellow-300"
                  onClick={() => toggleContextExpanded(context.name)}
                >
                  <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
                </button>
                <label className={`flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 ${contextChecked ? 'bg-yellow-400/10 text-yellow-100 ring-1 ring-yellow-400/30' : ''}`}>
                  <input type="checkbox" checked={contextChecked} disabled={selectionPending} onChange={() => { const next = toggleValue(contextValues, context.name); setDraftContextValues(next); void runSelectionChange(() => onContextChange(next)) }} />
                  <span className="min-w-0 truncate">{context.name}</span>
                  {contextChecked && <span className="shrink-0 rounded bg-yellow-400 px-1.5 py-0.5 text-[10px] font-semibold text-slate-950">Selected</span>}
                  <span className="shrink-0 text-xs font-normal text-slate-500">{namespaces.length} namespaces</span>
                </label>
              </div>
              {!collapsed && <div id={panelId} className="space-y-2 p-2">
                {namespaces.length === 0 && kube.loadingNamespaces && <div className="space-y-2 px-1 py-2" aria-label={`Loading namespaces for ${context.name}`}>
                  <div className="h-8 animate-pulse rounded bg-slate-800/70" />
                  <div className="h-8 animate-pulse rounded bg-slate-800/40" />
                </div>}
                {namespaces.map(({ namespace, pods }) => {
                  const nsKey = scopeKey(context.name, namespace.name)
                  const namespaceChecked = namespaceValues.includes(nsKey)
                  return <div key={nsKey} className="rounded border border-slate-800 bg-slate-950/70">
                    <label className={`flex items-center gap-2 px-3 py-2 text-sm font-medium ${namespaceChecked ? 'bg-yellow-400/10 text-yellow-100' : 'text-slate-100'}`}>
                      <input type="checkbox" checked={namespaceChecked} disabled={selectionPending} onChange={() => { const next = toggleValue(namespaceValues, nsKey); setDraftNamespaceValues(next); void runSelectionChange(() => onNamespaceChange(next)) }} />
                      <span>{namespace.name}</span>
                      {namespaceChecked && <span className="rounded bg-yellow-400 px-1.5 py-0.5 text-[10px] font-semibold text-slate-950">Selected</span>}
                      <span className="text-xs font-normal text-slate-500">{pods.length} pods</span>
                    </label>
                    <div className="space-y-1 pb-2 pl-7 pr-2">
                      {pods.length === 0 && kube.loadingPods && namespaceChecked && <div role="status" aria-label={`Loading pods for ${namespace.name}`} className="mx-2 my-1 rounded border border-yellow-400/20 bg-yellow-400/5 px-2 py-1.5 text-xs text-yellow-100">
                        <div className="mb-1 flex items-center gap-2"><ActivityRing label="Loading pods activity" /><span>Loading pods</span><ActivityDots label="Loading pods progress" /></div>
                        <ProgressStripe label={`Loading pods progress for ${namespace.name}`} />
                      </div>}
                      {pods.length === 0 && (!kube.loadingPods || !namespaceChecked) && <p className="px-2 py-1 text-xs text-slate-500">No loaded pods</p>}
                      {pods.map((pod) => {
                        const value = podValue(context.name, namespace.name, pod.name)
                        const podChecked = selectedPods.includes(value)
                        return <label key={value} className={`flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-800 ${podChecked ? 'border border-yellow-400/40 bg-yellow-400/10 text-yellow-100 shadow-[0_0_0_1px_rgba(250,204,21,0.10)]' : 'text-slate-200'}`}>
                          <input aria-label={`${context.name} / ${namespace.name} / ${pod.name}`} type="checkbox" checked={podChecked} disabled={selectionPending} onChange={() => { const next = toggleValue(selectedPods, value); setDraftSelectedPods(next); void runSelectionChange(() => onPodChange(next)) }} />
                          <span className="min-w-0 flex-1 truncate">{pod.name}</span>
                          {podChecked && <span className="rounded bg-yellow-400 px-1.5 py-0.5 text-[10px] font-semibold text-slate-950">Selected</span>}
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] ${phaseClass(pod.phase)}`}>{pod.phase}</span>
                        </label>
                      })}
                    </div>
                  </div>
                })}
              </div>}
            </div>
          })}
        </div>
        <aside aria-label="Selected targets" className="min-h-0 overflow-y-auto border-l border-slate-800 bg-slate-900/40 p-3">
          <div className="mb-3 rounded border border-slate-800 bg-slate-950 p-3">
            <h3 className="text-sm font-semibold">Selected targets</h3>
            <p className="mt-1 text-xs text-slate-400">{selectedPods.length} selected{selectionPending ? ' · applying…' : ''}</p>
          </div>
          {selectionPending && <div role="status" aria-label="Selection shown immediately" className="mb-2 rounded border border-yellow-400/30 bg-yellow-400/10 px-2 py-1 text-xs text-yellow-100">Selection shown immediately. Applying target change…</div>}
          <div className="space-y-2">
            {selectedPods.length === 0 && <div className="rounded border border-dashed border-slate-700 bg-slate-950 p-3 text-xs text-slate-400">
              <p className="font-semibold text-slate-200">No pods selected</p>
              <p className="mt-1">Choose one or more running pods from the target tree.</p>
            </div>}
            {selectedPods.map((value) => {
              const [scope, pod] = value.split('\u0000').length === 3 ? [value.split('\u0000').slice(0, 2).join('\u0000'), value.split('\u0000')[2]] : ['', value]
              const { context, namespace } = parseScopeKey(scope)
              return <button key={value} disabled={selectionPending} className="block w-full rounded border border-yellow-400/40 bg-yellow-400/10 px-2 py-1 text-left text-xs text-yellow-100 hover:bg-yellow-400/20 disabled:cursor-not-allowed disabled:opacity-70" onClick={() => { const next = selectedPods.filter((item) => item !== value); setDraftSelectedPods(next); void runSelectionChange(() => onPodChange(next)) }}>
                {context} / {namespace} / {pod} ×
              </button>
            })}
          </div>
        </aside>
      </div>
    </section>
  </div>
}

export function TopBar({ onSettings, onContextChange, onNamespaceChange, onPodChange }: { onSettings: () => void; onContextChange: (contexts: string[]) => void | Promise<void>; onNamespaceChange: (namespaces: string[]) => void | Promise<void>; onPodChange: (pods: string[]) => void | Promise<void> }) {
  const kube = useKubeStore()
  const [targetPickerOpen, setTargetPickerOpen] = useState(false)
  const selectedCount = selectedPodValues(kube.selectedPods).length || (kube.selectedPod ? 1 : 0)
  const targetsLoading = kube.loadingContexts || kube.loadingNamespaces || kube.loadingPods || kube.cacheRefreshing
  const targetStatusLabel = kube.cacheRefreshing ? 'Refreshing target cache' : kube.loadingPods ? 'Loading pods' : kube.loadingNamespaces ? 'Loading namespaces' : kube.loadingContexts ? 'Loading contexts' : selectedCount > 0 ? 'Targets selected' : 'Select a target'
  useEffect(() => {
    const openTargetPicker = () => setTargetPickerOpen(true)
    window.addEventListener('klogcat:open-target-picker', openTargetPicker)
    return () => window.removeEventListener('klogcat:open-target-picker', openTargetPicker)
  }, [])
  return <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-950 px-2 py-1.5">
    <strong>klogcat</strong>
    <AnimatedStatusPill active={targetsLoading} label={targetStatusLabel} detail={`Targets: ${selectedCount} selected`} />
    <button className={`rounded border border-yellow-500 bg-yellow-400 px-3 py-1 text-sm font-semibold text-slate-950 hover:bg-yellow-300 ${targetsLoading ? 'animate-klogcat-status-glow' : ''}`} onClick={() => setTargetPickerOpen(true)}>Change Targets</button>
    <button className="rounded border border-slate-700 px-3 py-1 text-sm text-slate-100 hover:bg-slate-800" onClick={onSettings}>Settings</button>
    {targetPickerOpen && <TargetPickerDialog onClose={() => setTargetPickerOpen(false)} onContextChange={onContextChange} onNamespaceChange={onNamespaceChange} onPodChange={onPodChange} />}
  </div>
}
