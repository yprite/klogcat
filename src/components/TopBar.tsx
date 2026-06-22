import { parseScopeKey, scopeKey, useKubeStore } from '../stores/kubeStore'

const selectedValues = (select: HTMLSelectElement) => Array.from(select.selectedOptions).map((option) => option.value)

export function TopBar({ onSettings, onContextChange, onNamespaceChange, onPodChange }: { onSettings: () => void; onContextChange: (contexts: string[]) => void | Promise<void>; onNamespaceChange: (namespaces: string[]) => void | Promise<void>; onPodChange: (pods: string[]) => void | Promise<void> }) {
  const kube = useKubeStore()
  const contextValues = kube.selectedContexts.length ? kube.selectedContexts : kube.selectedContext ? [kube.selectedContext] : []
  const namespaceValues = Object.entries(kube.selectedNamespaces).flatMap(([context, namespaces]) => namespaces.map((namespace) => scopeKey(context, namespace)))
  const podValues = Object.entries(kube.selectedPods).flatMap(([key, pods]) => pods.map((pod) => `${key}\u0000${pod}`))
  const namespaceOptions = (kube.selectedContexts.length ? kube.selectedContexts : kube.selectedContext ? [kube.selectedContext] : []).flatMap((context) => (kube.namespacesByContext[context] ?? (context === kube.selectedContext ? kube.namespaces : [])).map((namespace) => ({ context, namespace: namespace.name })))
  const podOptions = Object.entries(kube.podsByScope).flatMap(([key, pods]) => {
    const { context, namespace } = parseScopeKey(key)
    return pods.map((pod) => ({ context, namespace, pod }))
  })
  return <div className="flex flex-wrap gap-3 items-center p-3 border-b border-slate-800 bg-slate-950">
    <strong>klogcat</strong>
    <label>Cluster <select aria-label="Context" multiple size={Math.min(4, Math.max(2, kube.contexts.length || 2))} className="klogcat-select" value={contextValues} onChange={e=>{ void onContextChange(selectedValues(e.currentTarget).filter(Boolean)) }}><option value="">Select...</option>{kube.contexts.map(ctx=><option key={ctx.name} value={ctx.name}>{ctx.name}</option>)}</select></label>
    <label>Namespace <select aria-label="Namespace" multiple size={Math.min(6, Math.max(2, namespaceOptions.length || 2))} className="klogcat-select" value={namespaceValues} onChange={e=>{ void onNamespaceChange(selectedValues(e.currentTarget).filter(Boolean)) }}><option value="">Select...</option>{namespaceOptions.map(({ context, namespace })=><option key={scopeKey(context, namespace)} value={scopeKey(context, namespace)}>{context} / {namespace}</option>)}</select></label>
    <label>Pod <select aria-label="Pod" multiple size={Math.min(8, Math.max(2, podOptions.length || 2))} className="klogcat-select" value={podValues} onChange={e=>{ void onPodChange(selectedValues(e.currentTarget).filter(Boolean)) }}><option value="">Select...</option>{podOptions.map(({ context, namespace, pod })=><option key={`${scopeKey(context, namespace)}\u0000${pod.name}`} value={`${scopeKey(context, namespace)}\u0000${pod.name}`}>{context} / {namespace} / {pod.name} ({pod.phase})</option>)}</select></label>
    <button onClick={onSettings}>Settings</button>
  </div>
}
