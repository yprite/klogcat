import { useEffect, useState } from 'react'
import { useKubeStore } from '../stores/kubeStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useVmStore } from '../stores/vmStore'
import { isTargetPluginEnabled } from '../plugins/targetPluginRegistry'
import { t, type Language } from '../utils/i18n'
import { ActivityDots, ActivityRing } from './ProgressFeedback'
import { selectedPodValues, TargetPickerDialog } from './TargetPickerDialog'

function targetStatusLabel(kube: ReturnType<typeof useKubeStore.getState>, selectedCount: number, language: Language | undefined) {
  if (kube.targetRefreshPhase) return t(language, kube.targetRefreshPhase)
  if (kube.cacheRefreshing) return t(language, 'Refreshing target cache')
  if (kube.loadingPods) return t(language, 'Loading pods')
  if (kube.loadingNamespaces) return t(language, 'Loading namespaces')
  if (kube.loadingContexts) return t(language, 'Loading contexts')
  return selectedCount > 0 ? t(language, 'Targets selected') : t(language, 'Select a target')
}

export function TopBar({ onSettings, onContextChange, onNamespaceChange, onPodChange, onVmTargetChange = () => undefined }: { onSettings: () => void; onContextChange: (contexts: string[]) => void | Promise<void>; onNamespaceChange: (namespaces: string[]) => void | Promise<void>; onPodChange: (pods: string[]) => void | Promise<void>; onVmTargetChange?: (targets: string[]) => void | Promise<void> }) {
  const kube = useKubeStore()
  const vm = useVmStore()
  const language = useSettingsStore((s) => s.settings?.language)
  const vmTargetsEnabled = useSettingsStore((s) => isTargetPluginEnabled(s.settings?.targetPlugins, 'awsVm'))
  const [targetPickerOpen, setTargetPickerOpen] = useState(false)
  const selectedCount = (selectedPodValues(kube.selectedPods).length || (kube.selectedPod ? 1 : 0)) + (vmTargetsEnabled ? vm.selectedTargetIds.length : 0)
  const targetsLoading = kube.loadingContexts || kube.loadingNamespaces || kube.loadingPods || kube.cacheRefreshing || vm.loading
  const statusLabel = targetStatusLabel(kube, selectedCount, language)
  useEffect(() => {
    const openTargetPicker = () => setTargetPickerOpen(true)
    window.addEventListener('klogcat:open-target-picker', openTargetPicker)
    return () => window.removeEventListener('klogcat:open-target-picker', openTargetPicker)
  }, [])
  return <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-950 px-2 py-1.5">
    <strong>klogcat</strong>
    <button className={`rounded border border-yellow-500 bg-yellow-400 px-3 py-1 text-sm font-semibold text-slate-950 hover:bg-yellow-300 ${targetsLoading ? 'animate-klogcat-status-glow' : ''}`} onClick={() => setTargetPickerOpen(true)}>{selectedCount > 0 ? t(language, 'Change Targets') : t(language, 'Choose Target')}</button>
    <button className="rounded border border-slate-700 px-3 py-1 text-sm text-slate-100 hover:bg-slate-800" onClick={onSettings}>{t(language, 'Settings')}</button>
    <div aria-label={targetsLoading ? statusLabel : undefined} className={`ml-auto flex items-center gap-2 rounded border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-300 ${targetsLoading ? 'animate-klogcat-status-glow' : ''}`} role={targetsLoading ? 'status' : undefined}>
      {targetsLoading && <ActivityRing label={t(language, 'Target refresh activity')} />}
      <span>{statusLabel}</span>
      <span className="text-slate-500">{t(language, 'Targets: {count} selected', { count: selectedCount })}</span>
      {targetsLoading && <ActivityDots label={t(language, 'Target refresh progress')} />}
    </div>
    {targetPickerOpen && <TargetPickerDialog onClose={() => setTargetPickerOpen(false)} onContextChange={onContextChange} onNamespaceChange={onNamespaceChange} onPodChange={onPodChange} onVmTargetChange={onVmTargetChange} />}
  </div>
}
