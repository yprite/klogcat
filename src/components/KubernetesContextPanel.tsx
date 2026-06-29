import { useState } from 'react'
import type { SelectedPodTarget } from '../stores/kubeStore'
import { buildDiagnosticCommand } from '../utils/kubernetesContext'

export function KubernetesContextPanel({ target }: { target?: SelectedPodTarget }) {
  const [copied, setCopied] = useState<string | undefined>()
  if (!target) return <section role="region" aria-label="Kubernetes context" className="rounded border border-slate-800 bg-slate-950/60 p-2">
    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Kubernetes context</h3>
    <p className="mt-2 text-xs text-slate-500">Select a target to inspect Kubernetes context.</p>
  </section>

  const podContext = buildDiagnosticCommand({ kind: 'podContext', context: target.context, namespace: target.namespace, pod: target.pod.name })
  const podEvents = buildDiagnosticCommand({ kind: 'podEvents', context: target.context, namespace: target.namespace, pod: target.pod.name })
  const copy = async (kind: string, command: string) => {
    await navigator.clipboard.writeText(command)
    setCopied(kind)
  }

  return <section role="region" aria-label="Kubernetes context" className="rounded border border-slate-800 bg-slate-950/60 p-2">
    <div className="mb-2 flex items-center justify-between gap-2">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Kubernetes context</h3>
        <p className="mt-1 text-xs text-slate-200">{target.context} / {target.namespace} / {target.pod.name}</p>
      </div>
      {copied && <span className="text-xs text-emerald-300">Copied {copied}</span>}
    </div>
    <CommandRow label="Pod context" command={podContext.displayCommand} copyLabel="Copy pod context command" onCopy={() => void copy('pod context', podContext.displayCommand)} />
    <CommandRow label="Events" command={podEvents.displayCommand} copyLabel="Copy events command" onCopy={() => void copy('events', podEvents.displayCommand)} />
  </section>
}

function CommandRow({ command, copyLabel, label, onCopy }: { command: string; copyLabel: string; label: string; onCopy: () => void }) {
  return <div className="mt-2 rounded border border-slate-800 bg-slate-900 px-2 py-1 text-xs">
    <div className="mb-1 flex items-center justify-between gap-2">
      <span className="font-semibold text-slate-300">{label}</span>
      <button type="button" aria-label={copyLabel} className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-100 hover:bg-slate-800" onClick={onCopy}>Copy</button>
    </div>
    <code className="block whitespace-pre-wrap break-all text-sky-200">{command}</code>
  </div>
}
