import { useEffect, useState } from 'react'
import { useKubeStore } from '../stores/kubeStore'
import { useSettingsStore } from '../stores/settingsStore'
import { t, type Language } from '../utils/i18n'
import { AnimatedStatusPill } from './ProgressFeedback'
import { selectedPodValues, TargetPickerDialog } from './TargetPickerDialog'

function targetStatusLabel(kube: ReturnType<typeof useKubeStore.getState>, selectedCount: number, language: Language | undefined) {
  if (kube.cacheRefreshing) return t(language, 'Refreshing target cache')
  if (kube.loadingPods) return t(language, 'Loading pods')
  if (kube.loadingNamespaces) return t(language, 'Loading namespaces')
  if (kube.loadingContexts) return t(language, 'Loading contexts')
  return selectedCount > 0 ? t(language, 'Targets selected') : t(language, 'Select a target')
}

export function TopBar({ onSettings, onContextChange, onNamespaceChange, onPodChange }: { onSettings: () => void; onContextChange: (contexts: string[]) => void | Promise<void>; onNamespaceChange: (namespaces: string[]) => void | Promise<void>; onPodChange: (pods: string[]) => void | Promise<void> }) {
  const kube = useKubeStore()
  const language = useSettingsStore((s) => s.settings?.language)
  const [targetPickerOpen, setTargetPickerOpen] = useState(false)
  const selectedCount = selectedPodValues(kube.selectedPods).length || (kube.selectedPod ? 1 : 0)
  const targetsLoading = kube.loadingContexts || kube.loadingNamespaces || kube.loadingPods || kube.cacheRefreshing
  useEffect(() => {
    const openTargetPicker = () => setTargetPickerOpen(true)
    window.addEventListener('klogcat:open-target-picker', openTargetPicker)
    return () => window.removeEventListener('klogcat:open-target-picker', openTargetPicker)
  }, [])
  return <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-950 px-2 py-1.5">
    <strong>klogcat</strong>
    <AnimatedStatusPill active={targetsLoading} label={targetStatusLabel(kube, selectedCount, language)} detail={t(language, 'Targets: {count} selected', { count: selectedCount })} />
    {selectedCount > 0 && <button className={`rounded border border-yellow-500 bg-yellow-400 px-3 py-1 text-sm font-semibold text-slate-950 hover:bg-yellow-300 ${targetsLoading ? 'animate-klogcat-status-glow' : ''}`} onClick={() => setTargetPickerOpen(true)}>{t(language, 'Change Targets')}</button>}
    <button className="rounded border border-slate-700 px-3 py-1 text-sm text-slate-100 hover:bg-slate-800" onClick={onSettings}>{t(language, 'Settings')}</button>
    {targetPickerOpen && <TargetPickerDialog onClose={() => setTargetPickerOpen(false)} onContextChange={onContextChange} onNamespaceChange={onNamespaceChange} onPodChange={onPodChange} />}
  </div>
}
