import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useKubeStore } from '../stores/kubeStore'
import { useLogStore } from '../stores/logStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useVmStore } from '../stores/vmStore'
import { DEFAULT_LOG_VIEWER_EXTENSION_ID, findLogViewerExtension, useLogViewerExtensions } from '../extensions/logViewerExtensions'
import { toLogViewerExtensionSnapshot } from '../extensions/logViewerSdkAdapter'
import { createLogViewerExtensionHostApi } from '../sdk/log-viewer'
import { InvestigationModeSelector, logViewerPanelId, logViewerTabId, type InvestigationMode } from './InvestigationModeSelector'
import { LogViewerExtensionBoundary } from './LogViewerExtensionBoundary'

export function LogViewerExtensionHost({ children }: { children: ReactNode }) {
  const [investigationMode, setInvestigationMode] = useState<InvestigationMode>(DEFAULT_LOG_VIEWER_EXTENSION_ID)
  const kube = useKubeStore()
  const log = useLogStore()
  const vm = useVmStore()
  const settings = useSettingsStore()
  const logViewerExtensions = useLogViewerExtensions()
  useEffect(() => {
    if (!findLogViewerExtension(investigationMode, logViewerExtensions)) setInvestigationMode(DEFAULT_LOG_VIEWER_EXTENSION_ID)
  }, [investigationMode, logViewerExtensions])

  const activeLogViewerExtension = findLogViewerExtension(investigationMode, logViewerExtensions) ?? logViewerExtensions[0]
  const ActiveLogViewer = activeLogViewerExtension.component
  const extensionSnapshot = toLogViewerExtensionSnapshot(log, kube, vm, settings)
  const extensionSdk = useMemo(() => createLogViewerExtensionHostApi({
    capabilities: activeLogViewerExtension.requestedCapabilities,
    getSnapshot: () => toLogViewerExtensionSnapshot(useLogStore.getState(), useKubeStore.getState(), useVmStore.getState(), useSettingsStore.getState()),
    subscribe: (listener) => {
      let sequence = 0
      const unsubscribeLog = useLogStore.subscribe(() => listener({ type: 'snapshot', reason: 'log-state', sequence: sequence += 1 }))
      const unsubscribeKube = useKubeStore.subscribe(() => listener({ type: 'snapshot', reason: 'target-state', sequence: sequence += 1 }))
      const unsubscribeVm = useVmStore.subscribe(() => listener({ type: 'snapshot', reason: 'target-state', sequence: sequence += 1 }))
      const unsubscribeSettings = useSettingsStore.subscribe(() => listener({ type: 'snapshot', reason: 'target-state', sequence: sequence += 1 }))
      return () => {
        unsubscribeLog()
        unsubscribeKube()
        unsubscribeVm()
        unsubscribeSettings()
      }
    },
    actions: {
      setGrepQuery: (query) => useLogStore.getState().setGrepQuery(query),
      setGrepMode: (mode) => useLogStore.getState().setGrepMode(mode),
      pauseViewer: () => useLogStore.getState().pause(),
      resumeViewer: () => useLogStore.getState().resume(),
      clearViewer: () => useLogStore.getState().clear(),
      setAutoScrollEnabled: (enabled) => useLogStore.getState().setAutoScrollEnabled(enabled),
    },
  }), [activeLogViewerExtension.requestedCapabilities])

  return <>
    <InvestigationModeSelector value={activeLogViewerExtension.id} modes={logViewerExtensions} onChange={setInvestigationMode} />
    {children}
    <section
      id={logViewerPanelId(activeLogViewerExtension.id)}
      role="tabpanel"
      aria-labelledby={logViewerTabId(activeLogViewerExtension.id)}
      className="contents"
    >
      <LogViewerExtensionBoundary extensionLabel={activeLogViewerExtension.label}>
        <ActiveLogViewer sdk={extensionSdk} snapshot={extensionSnapshot} />
      </LogViewerExtensionBoundary>
    </section>
  </>
}
