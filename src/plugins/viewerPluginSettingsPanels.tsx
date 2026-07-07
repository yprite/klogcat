import type { PersistedSettings } from '../types/settings'
import { t, type Language } from '../utils/i18n'

type ViewerPluginSettingsPanelProps = {
  draft: PersistedSettings
  language?: Language
  settingsKey: string
  updateViewerPlugin: (settingsKey: keyof PersistedSettings['plugins']['viewers'], patch: Partial<PersistedSettings['plugins']['viewers'][keyof PersistedSettings['plugins']['viewers']]>) => void
}

function RawLogsViewerSettingsPanel({ language }: ViewerPluginSettingsPanelProps) {
  return <section id="settings-raw-viewer-plugin" className="rounded border border-slate-700 bg-slate-950/60 p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold text-white">{t(language, 'Raw Logs Viewer Plugin')}</h3>
        <p className="mt-1 text-xs text-slate-400">{t(language, 'Core source-of-truth log viewer. Raw Logs is always available so users can recover when other viewer plugins are disabled or fail.')}</p>
      </div>
      <span className="rounded border border-emerald-500/50 bg-emerald-500/10 px-3 py-1 text-sm text-emerald-100">{t(language, 'Always enabled')}</span>
    </div>
  </section>
}

function ApiFlowGraphViewerSettingsPanel({ draft, language, updateViewerPlugin }: ViewerPluginSettingsPanelProps) {
  const plugin = draft.plugins.viewers.apiFlowGraph
  return <section id="settings-api-flow-graph-viewer-plugin" className="rounded border border-slate-700 bg-slate-950/60 p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold text-white">{t(language, 'Graph Viewer Plugin')}</h3>
        <p className="mt-1 text-xs text-slate-400">{t(language, 'Visualizes trID-linked user API requests and backend module calls as an animated graph viewer tab.')}</p>
      </div>
      <label className="inline-flex items-center gap-2 rounded border border-slate-700 px-3 py-1 text-sm text-slate-100">
        <input type="checkbox" checked={plugin.enabled} onChange={(event) => updateViewerPlugin('apiFlowGraph', { enabled: event.target.checked })} />
        {t(language, 'Enabled')}
      </label>
    </div>
    <div className="mt-3 rounded border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-300">
      <p>{t(language, 'When enabled, the Graph Viewer tab appears beside Raw Logs and uses the current visible log rows, including query and column filters.')}</p>
      <p className="mt-1">{t(language, 'When disabled, the extension can remain installed but is hidden from the viewer tab list.')}</p>
    </div>
  </section>
}

const viewerPluginSettingsPanels = Object.freeze({
  raw: RawLogsViewerSettingsPanel,
  apiFlowGraph: ApiFlowGraphViewerSettingsPanel,
})

export function ViewerPluginSettingsPanels(props: ViewerPluginSettingsPanelProps) {
  const Panel = viewerPluginSettingsPanels[props.settingsKey as keyof typeof viewerPluginSettingsPanels]
  return Panel ? <Panel {...props} /> : null
}
