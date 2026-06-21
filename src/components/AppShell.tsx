import { useEffect, useState } from 'react'
import type { SourceLogType } from '../types/log'
import { useKubeStore } from '../stores/kubeStore'
import { useLogStore } from '../stores/logStore'
import { useSettingsStore } from '../stores/settingsStore'
import { stopLogStream } from '../commands/tauriLogs'
import { ErrorBanner } from './ErrorBanner'
import { GrepBar } from './GrepBar'
import { LogToolbar } from './LogToolbar'
import { LogTypeSelector } from './LogTypeSelector'
import { LogViewer } from './LogViewer'
import { SettingsModal } from './SettingsModal'
import { TopBar } from './TopBar'

async function stopAndClearIfActive() {
  const log = useLogStore.getState()
  if (log.activeStreamId) { const id = log.activeStreamId; log.markStopping(id); try { await stopLogStream(id); log.markStopped(id) } catch (e) { log.markError(id, e instanceof Error ? e.message : String(e)) } }
  useLogStore.getState().resetForSelectionChange()
}

export function AppShell({ eventError }: { eventError?: string }) {
  const [sourceType, setSourceType] = useState<SourceLogType>('app')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [defaultNamespaceWarning, setDefaultNamespaceWarning] = useState<string>()
  const settings = useSettingsStore(); const kube = useKubeStore(); const log = useLogStore()
  useEffect(() => { (async () => { await settings.loadSettings(); await kube.loadCurrentContext(); await kube.loadNamespaces(); const s = useSettingsStore.getState().settings; const namespaces = useKubeStore.getState().namespaces; if (s?.defaultNamespace) { if (namespaces.some(ns => ns.name === s.defaultNamespace)) { await kube.selectNamespace(s.defaultNamespace); setDefaultNamespaceWarning(undefined) } else { setDefaultNamespaceWarning(`Default namespace "${s.defaultNamespace}" was not found in the current context`) } } })() }, [])
  const changeSource = async (next: SourceLogType) => { if (next === sourceType) return; await stopAndClearIfActive(); setSourceType(next) }
  const changeNamespace = async (namespace: string) => { await stopAndClearIfActive(); await useKubeStore.getState().selectNamespace(namespace) }
  const changePod = async (pod: string) => { await stopAndClearIfActive(); useKubeStore.getState().selectPod(pod) }
  return <div className="min-h-screen">
    <TopBar onSettings={() => setSettingsOpen(true)} onNamespaceChange={changeNamespace} onPodChange={changePod} />
    <main className="p-3 space-y-3">
      <ErrorBanner error={eventError || settings.error || kube.error || log.errorMessage} />
      {settings.warning && <div className="bg-yellow-950 border border-yellow-700 p-2 rounded">{settings.warning.message}</div>}
      {defaultNamespaceWarning && <div className="bg-yellow-950 border border-yellow-700 p-2 rounded">{defaultNamespaceWarning}</div>}
      <div className="flex flex-wrap gap-3 items-center"><LogTypeSelector value={sourceType} onChange={changeSource} /><GrepBar /></div>
      <LogToolbar sourceType={sourceType} />
      <LogViewer />
    </main>
    <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
  </div>
}
