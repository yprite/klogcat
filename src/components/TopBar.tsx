import { useKubeStore } from '../stores/kubeStore'

export function TopBar({ onSettings, onNamespaceChange, onPodChange }: { onSettings: () => void; onNamespaceChange: (namespace: string) => void | Promise<void>; onPodChange: (pod: string) => void | Promise<void> }) {
  const kube = useKubeStore()
  return <div className="flex flex-wrap gap-3 items-center p-3 border-b border-slate-800 bg-slate-950">
    <strong>klogcat</strong><span>Context: {kube.currentContext ?? 'unknown'}</span>
    <label>Namespace <select className="text-black" value={kube.selectedNamespace ?? ''} onChange={e=>{ void onNamespaceChange(e.target.value) }}><option value="">Select...</option>{kube.namespaces.map(ns=><option key={ns.name} value={ns.name}>{ns.name}</option>)}</select></label>
    <label>Pod <select className="text-black" value={kube.selectedPod ?? ''} onChange={e=>{ void onPodChange(e.target.value) }}><option value="">Select...</option>{kube.pods.map(p=><option key={p.name} value={p.name}>{p.name} ({p.phase})</option>)}</select></label>
    <button onClick={onSettings}>Settings</button>
  </div>
}
