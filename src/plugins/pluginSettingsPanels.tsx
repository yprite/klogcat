import type { SourceLogType } from '../types/log'
import type { PersistedSettings } from '../types/settings'
import { t, type Language } from '../utils/i18n'

type PluginSettingsPanelProps = {
  draft: PersistedSettings
  language?: Language
  sourceTypes: SourceLogType[]
  updateAwsVmLogPath: (sourceType: SourceLogType, path: string) => void
  updateAwsVmPlugin: (patch: Partial<PersistedSettings['targetPlugins']['awsVm']>) => void
}

function AwsVmPluginSettingsPanel({ draft, language, sourceTypes, updateAwsVmLogPath, updateAwsVmPlugin }: PluginSettingsPanelProps) {
  const plugin = draft.targetPlugins.awsVm
  return <section id="settings-aws-vm-plugin" className="rounded border border-slate-700 bg-slate-950/60 p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold text-white">{t(language, 'AWS VM Target Plugin')}</h3>
        <p className="mt-1 text-xs text-slate-400">{t(language, 'Enable VM log targets discovered from Consul through a bastion host. Passwords and TOTP secrets are read from environment variables. Password auth needs sshpass and TOTP mode needs oathtool; if those tools or env values are unavailable, klogcat falls back to SSH key or agent auth.')}</p>
      </div>
      <label className="inline-flex items-center gap-2 rounded border border-slate-700 px-3 py-1 text-sm text-slate-100">
        <input type="checkbox" checked={plugin.enabled} onChange={(event) => updateAwsVmPlugin({ enabled: event.target.checked })} />
        {t(language, 'Enabled')}
      </label>
    </div>

    <div className="mt-3 grid gap-2 sm:grid-cols-3">
      <label className="block text-sm">{t(language, 'Bastion host')}<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" value={plugin.bastionHost} onChange={(event) => updateAwsVmPlugin({ bastionHost: event.target.value })} /></label>
      <label className="block text-sm">{t(language, 'Bastion port')}<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" type="number" value={plugin.bastionPort} onChange={(event) => updateAwsVmPlugin({ bastionPort: Number(event.target.value) })} /></label>
      <label className="block text-sm">{t(language, 'Bastion username')}<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" value={plugin.bastionUsername} onChange={(event) => updateAwsVmPlugin({ bastionUsername: event.target.value })} /></label>
      <label className="block text-sm">{t(language, 'Bastion password env')}<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-white" value={plugin.bastionPasswordEnv} onChange={(event) => updateAwsVmPlugin({ bastionPasswordEnv: event.target.value })} /></label>
      <label className="block text-sm">{t(language, 'Bastion TOTP secret env')}<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-white" value={plugin.bastionTotpSecretEnv ?? ''} onChange={(event) => updateAwsVmPlugin({ bastionTotpSecretEnv: event.target.value })} /></label>
      <label className="block text-sm">{t(language, 'Bastion password mode')}<select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" value={plugin.bastionPasswordMode} onChange={(event) => updateAwsVmPlugin({ bastionPasswordMode: event.target.value as PersistedSettings['targetPlugins']['awsVm']['bastionPasswordMode'] })}>
        <option value="password">{t(language, 'Password only')}</option>
        <option value="password-plus-totp">{t(language, 'Password + current TOTP')}</option>
      </select></label>
      <label className="block text-sm">{t(language, 'VM username')}<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" value={plugin.vmUsername} onChange={(event) => updateAwsVmPlugin({ vmUsername: event.target.value })} /></label>
      <label className="block text-sm">{t(language, 'VM password env')}<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-white" value={plugin.vmPasswordEnv} onChange={(event) => updateAwsVmPlugin({ vmPasswordEnv: event.target.value })} /></label>
    </div>

    <label className="mt-3 block text-sm">{t(language, 'Consul catalog command')}
      <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-white" value={plugin.consulCatalogCommand} onChange={(event) => updateAwsVmPlugin({ consulCatalogCommand: event.target.value })} />
    </label>
    <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-200">
      <input type="checkbox" checked={plugin.strictHostKeyChecking} onChange={(event) => updateAwsVmPlugin({ strictHostKeyChecking: event.target.checked })} />
      {t(language, 'Strict host key checking')}
    </label>

    <div className="mt-3 grid gap-2 sm:grid-cols-3">
      {sourceTypes.map((sourceType) => <label className="block rounded border border-slate-700 p-2 text-sm" key={sourceType}>
        <span className="text-xs font-semibold uppercase text-slate-300">{t(language, '{sourceType} VM log path', { sourceType })}</span>
        <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-white" value={plugin.logPaths[sourceType] ?? ''} onChange={(event) => updateAwsVmLogPath(sourceType, event.target.value)} />
      </label>)}
    </div>

    <p className="mt-2 text-xs text-slate-500">{t(language, 'After saving, open the VM tab in target selection to load Consul catalog results.')}</p>
  </section>
}

export const pluginSettingsPanels = Object.freeze({
  awsVm: AwsVmPluginSettingsPanel,
})

export function TargetPluginSettingsPanels(props: PluginSettingsPanelProps) {
  return <>
    {Object.entries(pluginSettingsPanels).map(([key, Panel]) => <Panel key={key} {...props} />)}
  </>
}
