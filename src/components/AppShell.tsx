import { useEffect, useState } from 'react'
import type { SourceLogType } from '../types/log'
import { useKubeStore } from '../stores/kubeStore'
import { useLogStore } from '../stores/logStore'
import { useSettingsStore } from '../stores/settingsStore'
import { stopLogStream } from '../commands/tauriLogs'
import { ActionDebugPanel } from './ActionDebugPanel'
import { ErrorBanner } from './ErrorBanner'
import { GrepBar } from './GrepBar'
import { LogToolbar } from './LogToolbar'
import { LogViewer } from './LogViewer'
import { SettingsModal } from './SettingsModal'
import { TopBar } from './TopBar'

async function stopAndClearIfActive() {
  const log = useLogStore.getState()
  const ids = log.activeStreamIds.length ? log.activeStreamIds : log.activeStreamId ? [log.activeStreamId] : []
  await Promise.all(ids.map(async (id) => { log.markStopping(id); try { await stopLogStream(id); log.markStopped(id) } catch (e) { log.markError(id, e instanceof Error ? e.message : String(e)) } }))
  useLogStore.getState().resetForSelectionChange()
}

export function AppShell({ eventError }: { eventError?: string }) {
  const [sourceTypes, setSourceTypes] = useState<SourceLogType[]>(['info'])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [defaultNamespaceWarning, setDefaultNamespaceWarning] = useState<string>()
  const settings = useSettingsStore(); const kube = useKubeStore(); const log = useLogStore()
  useEffect(() => { (async () => {
    await settings.loadSettings()
    const kubeStore = useKubeStore.getState()
    const loadedCache = kubeStore.loadCachedTargets()
    const refreshPromise = useKubeStore.getState().refreshAllTargets(false)
    void refreshPromise
    const s = useSettingsStore.getState().settings
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
  const changeSources = async (next: SourceLogType[]) => { log.recordActionDebug(`Sources clicked: ${next.join(', ') || '(none)'}`); if (next.length === sourceTypes.length && next.every((value, index) => value === sourceTypes[index])) return; await stopAndClearIfActive(); setSourceTypes(next) }
  const changeContext = async (contexts: string[]) => { log.recordActionDebug(`Contexts selected: ${contexts.join(', ') || '(empty)'}`); await stopAndClearIfActive(); await useKubeStore.getState().selectContexts(contexts) }
  const changeNamespace = async (namespaces: string[]) => { log.recordActionDebug(`Namespaces selected: ${namespaces.join(', ') || '(empty)'}`); await stopAndClearIfActive(); await useKubeStore.getState().selectNamespaces(namespaces) }
  const changePod = async (pods: string[]) => { log.recordActionDebug(`Pods selected: ${pods.join(', ') || '(empty)'}`); await stopAndClearIfActive(); useKubeStore.getState().selectPods(pods) }
  return <div className="flex h-screen flex-col overflow-hidden">
    <TopBar onSettings={() => { log.recordActionDebug('Settings clicked'); setSettingsOpen(true) }} onContextChange={changeContext} onNamespaceChange={changeNamespace} onPodChange={changePod} />
    <main className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden p-2">
      <ErrorBanner error={eventError || settings.error || kube.error || log.errorMessage} />
      {settings.warning && <div className="rounded border border-yellow-700 bg-yellow-950 px-2 py-1 text-xs">{settings.warning.message}</div>}
      {defaultNamespaceWarning && <div className="rounded border border-yellow-700 bg-yellow-950 px-2 py-1 text-xs">{defaultNamespaceWarning}</div>}
      <GrepBar />
      <LogToolbar sourceTypes={sourceTypes} onSourceTypesChange={changeSources} />
      <ActionDebugPanel />
      <LogViewer />
    </main>
    <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
  </div>
}
