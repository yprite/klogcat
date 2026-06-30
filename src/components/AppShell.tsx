import { useEffect, useState } from 'react'
import type { SourceLogType } from '../types/log'
import { useKubeStore } from '../stores/kubeStore'
import { useLogStore } from '../stores/logStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useVmStore } from '../stores/vmStore'
import { isTargetPluginEnabled } from '../plugins/targetPluginRegistry'
import { stopLogStream } from '../commands/tauriLogs'
import { ErrorBanner } from './ErrorBanner'
import { GrepBar } from './GrepBar'
import { LogToolbar } from './LogToolbar'
import { LogViewerExtensionHost } from './LogViewerExtensionHost'
import { SettingsModal } from './SettingsModal'
import { TopBar } from './TopBar'

async function stopAndClearIfActive() {
  const log = useLogStore.getState()
  const ids = log.activeStreamIds.length ? log.activeStreamIds : log.activeStreamId ? [log.activeStreamId] : []
  await Promise.all(ids.map(async (id) => { log.markStopping(id); try { await stopLogStream(id); log.markStopped(id) } catch (e) { log.markError(id, e instanceof Error ? e.message : String(e)) } }))
  useLogStore.getState().resetForSelectionChange()
}

function matchesShortcut(event: KeyboardEvent, shortcut?: string) {
  if (!shortcut) return false
  const parts = shortcut.split('+').map((part) => part.trim().toLowerCase()).filter(Boolean)
  const key = parts.find((part) => !['meta', 'cmd', 'command', 'ctrl', 'control', 'shift', 'alt', 'option'].includes(part))
  const meta = parts.includes('meta') || parts.includes('cmd') || parts.includes('command')
  const ctrl = parts.includes('ctrl') || parts.includes('control')
  const alt = parts.includes('alt') || parts.includes('option')
  const shift = parts.includes('shift')
  return Boolean(key)
    && event.key.toLowerCase() === key
    && event.metaKey === meta
    && event.ctrlKey === ctrl
    && event.altKey === alt
    && event.shiftKey === shift
}

export function AppShell({ eventError }: { eventError?: string }) {
  const [sourceTypes, setSourceTypes] = useState<SourceLogType[]>(['info'])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [defaultNamespaceWarning, setDefaultNamespaceWarning] = useState<string>()
  const settings = useSettingsStore(); const kube = useKubeStore(); const log = useLogStore(); const vm = useVmStore()
  useEffect(() => { (async () => {
    await settings.loadSettings()
    const kubeStore = useKubeStore.getState()
    const loadedCache = kubeStore.loadCachedTargets()
    const refreshPromise = useKubeStore.getState().refreshAllTargets(false)
    void refreshPromise
    const s = useSettingsStore.getState().settings
    if (isTargetPluginEnabled(s?.targetPlugins, 'awsVm')) void useVmStore.getState().loadTargets(s!.targetPlugins)
    if (s?.defaultNamespace) {
      if (!loadedCache && !useKubeStore.getState().selectedContext) await refreshPromise
      if (!useKubeStore.getState().namespaces.some(ns => ns.name === s.defaultNamespace)) await useKubeStore.getState().loadNamespaces()
      const namespaces = useKubeStore.getState().namespaces
      if (namespaces.some(ns => ns.name === s.defaultNamespace)) {
        await useKubeStore.getState().selectNamespace(s.defaultNamespace)
        setDefaultNamespaceWarning(undefined)
      } else {
        setDefaultNamespaceWarning(`Default namespace "${s.defaultNamespace}" was not found in the selected context`)
      }
    }
  })() }, [])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const shortcuts = useSettingsStore.getState().settings?.shortcuts
      if (matchesShortcut(event, shortcuts?.openSettings)) { event.preventDefault(); setSettingsOpen(true); return }
      if (matchesShortcut(event, shortcuts?.openTargetPicker)) { event.preventDefault(); window.dispatchEvent(new Event('klogcat:open-target-picker')); return }
      if (matchesShortcut(event, shortcuts?.toggleStream)) { event.preventDefault(); window.dispatchEvent(new Event('klogcat:toggle-stream')); return }
      if (matchesShortcut(event, shortcuts?.restartStream)) { event.preventDefault(); window.dispatchEvent(new Event('klogcat:restart-stream')) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
  const changeSources = async (next: SourceLogType[]) => { log.recordActionDebug(`Sources clicked: ${next.join(', ') || '(none)'}`); if (next.length === sourceTypes.length && next.every((value, index) => value === sourceTypes[index])) return; setSourceTypes(next); await stopAndClearIfActive() }
  const changeContext = async (contexts: string[]) => { log.recordActionDebug(`Contexts selected: ${contexts.join(', ') || '(empty)'}`); const selection = useKubeStore.getState().selectContexts(contexts); await stopAndClearIfActive(); await selection }
  const changeNamespace = async (namespaces: string[]) => { log.recordActionDebug(`Namespaces selected: ${namespaces.join(', ') || '(empty)'}`); const selection = useKubeStore.getState().selectNamespaces(namespaces); await stopAndClearIfActive(); await selection }
  const changePod = async (pods: string[]) => { log.recordActionDebug(`Pods selected: ${pods.join(', ') || '(empty)'}`); useKubeStore.getState().selectPods(pods); await stopAndClearIfActive() }
  const changeVmTarget = async (targets: string[]) => { log.recordActionDebug(`VM targets selected: ${targets.join(', ') || '(empty)'}`); useVmStore.getState().selectTargets(targets); await stopAndClearIfActive() }
  return <div className="flex h-screen flex-col overflow-hidden">
    <TopBar onSettings={() => { log.recordActionDebug('Settings clicked'); setSettingsOpen(true) }} onContextChange={changeContext} onNamespaceChange={changeNamespace} onPodChange={changePod} onVmTargetChange={changeVmTarget} />
    <main className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden p-2">
      <ErrorBanner error={eventError || settings.error || kube.error || vm.error || log.errorMessage} />
      {settings.warning && <div className="rounded border border-yellow-700 bg-yellow-950 px-2 py-1 text-xs">{settings.warning.message}</div>}
      {defaultNamespaceWarning && <div className="rounded border border-yellow-700 bg-yellow-950 px-2 py-1 text-xs">{defaultNamespaceWarning}</div>}
      <LogViewerExtensionHost>
        <GrepBar />
        <LogToolbar sourceTypes={sourceTypes} onSourceTypesChange={changeSources} />
      </LogViewerExtensionHost>
    </main>
    <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
  </div>
}
