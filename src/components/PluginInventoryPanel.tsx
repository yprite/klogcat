import type { PersistedSettings } from '../types/settings'
import { getPluginManifests } from '../plugins/pluginRegistry'
import { targetPluginDefinitions } from '../plugins/targetPluginRegistry'
import { t, type Language } from '../utils/i18n'

function pluginEnabledState(pluginId: string, settings: PersistedSettings) {
  const targetPlugin = targetPluginDefinitions.find((plugin) => plugin.manifest.id === pluginId)
  if (!targetPlugin) return 'active'
  return targetPlugin.isEnabled(settings.plugins.targets) ? 'enabled' : 'disabled'
}

export function PluginInventoryPanel({ language, onOpenTargetPlugin, settings }: { language?: Language; onOpenTargetPlugin?: (settingsKey: string) => void; settings: PersistedSettings }) {
  const plugins = getPluginManifests()
  return <section id="settings-plugin-inventory" className="rounded border border-slate-700 bg-slate-950/60 p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold text-white">{t(language, 'Plugin inventory')}</h3>
        <p className="mt-1 text-xs text-slate-400">{t(language, 'Installed target and viewer plugins exposed through the platform registry.')}</p>
      </div>
      <span className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300">{plugins.length} {t(language, 'plugins')}</span>
    </div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {targetPluginDefinitions.map((plugin) => <button key={plugin.manifest.id} type="button" className="rounded border border-slate-800 bg-slate-900/70 p-3 text-left hover:border-yellow-400/70" onClick={() => onOpenTargetPlugin?.(plugin.settingsKey)}>
        <div className="flex items-start justify-between gap-2">
          <span className="font-semibold text-slate-100">{t(language, plugin.manifest.label)}</span>
          <span className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">{pluginEnabledState(plugin.manifest.id, settings)}</span>
        </div>
        <p className="mt-1 text-xs text-slate-400">{plugin.manifest.description}</p>
        <p className="mt-2 text-xs text-yellow-200">{t(language, 'Open plugin settings')}</p>
      </button>)}
    </div>
    <div className="mt-3 overflow-x-auto rounded border border-slate-800">
      <table className="min-w-[720px] w-full text-left text-xs">
        <thead className="bg-slate-900 text-slate-400">
          <tr>
            <th className="px-2 py-1">{t(language, 'Plugin id')}</th>
            <th className="px-2 py-1">{t(language, 'Kind')}</th>
            <th className="px-2 py-1">{t(language, 'Source')}</th>
            <th className="px-2 py-1">{t(language, 'State')}</th>
            <th className="px-2 py-1">{t(language, 'Description')}</th>
          </tr>
        </thead>
        <tbody>
          {plugins.map((plugin) => <tr className="border-t border-slate-800" key={`${plugin.kind}:${plugin.id}`}>
            <td className="px-2 py-1 font-mono text-slate-100">{plugin.id}</td>
            <td className="px-2 py-1 text-slate-200">{plugin.kind}</td>
            <td className="px-2 py-1 text-slate-300">{plugin.source}</td>
            <td className="px-2 py-1 text-slate-300">{pluginEnabledState(plugin.id, settings)}</td>
            <td className="px-2 py-1 text-slate-400">{plugin.description}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>
}
