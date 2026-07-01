import { useState } from 'react'
import type { SourceLogType } from '../types/log'
import type { PersistedSettings } from '../types/settings'
import type { AwsVmTargetGroupSettings } from '../types/vm'
import { t, type Language } from '../utils/i18n'

type PluginSettingsPanelProps = {
  draft: PersistedSettings
  language?: Language
  sourceTypes: SourceLogType[]
  updateCsvFilePlugin: (patch: Partial<PersistedSettings['targetPlugins']['csvFile']>) => void
  updateAwsVmLogPath: (sourceType: SourceLogType, path: string) => void
  updateAwsVmPlugin: (patch: Partial<PersistedSettings['targetPlugins']['awsVm']>) => void
}

function SecretInput({ label, language, value, onChange }: { label: string; language?: Language; value: string; onChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false)
  return <label className="block text-sm">{t(language, label)}
    <input
      autoComplete="new-password"
      className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white"
      type={editing ? 'text' : 'password'}
      value={value}
      onBlur={() => setEditing(false)}
      onChange={(event) => onChange(event.target.value)}
      onFocus={() => setEditing(true)}
    />
  </label>
}

function newTargetConfigId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const awsVmTargetGroupJsonTemplate = JSON.stringify({
  targetGroups: [{
    id: 'prod-bastion',
    name: 'Prod Bastion',
    enabled: true,
    bastionHost: 'bastion-prod.example.com',
    bastionPort: 22,
    modules: [
      {
        id: 'api',
        name: 'API',
        consulCatalogCommand: 'consul catalog nodes -service api -format=json',
      },
      {
        id: 'worker',
        name: 'Worker',
        consulCatalogCommand: 'consul catalog nodes -service worker -format=json',
      },
    ],
  }],
}, null, 2)

function AwsVmTargetGroupPanel({ collapsed, group, index, language, toggleCollapsed, updateGroup, removeGroup }: { collapsed: boolean; group: AwsVmTargetGroupSettings; index: number; language?: Language; toggleCollapsed: () => void; updateGroup: (group: AwsVmTargetGroupSettings) => void; removeGroup: () => void }) {
  const modules = group.modules ?? []
  const groupLabel = group.name || `${t(language, 'Bastion group')} ${index + 1}`
  const updateModule = (moduleIndex: number, patch: Partial<AwsVmTargetGroupSettings['modules'][number]>) => {
    updateGroup({ ...group, modules: modules.map((module, itemIndex) => itemIndex === moduleIndex ? { ...module, ...patch } : module) })
  }
  const addModule = () => {
    updateGroup({ ...group, modules: [...modules, { id: newTargetConfigId('module'), name: `${t(language, 'Module')} ${modules.length + 1}` }] })
  }
  const removeModule = (moduleIndex: number) => {
    updateGroup({ ...group, modules: modules.filter((_, itemIndex) => itemIndex !== moduleIndex) })
  }
  return <div className="rounded border border-slate-800 bg-slate-950 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label className="inline-flex items-center gap-2 text-sm text-slate-200">
        <input type="checkbox" checked={group.enabled} onChange={(event) => updateGroup({ ...group, enabled: event.target.checked })} />
        <span>{groupLabel}</span>
        <span className="text-xs text-slate-500">({modules.length} {t(language, modules.length === 1 ? 'module' : 'modules')})</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-100 hover:bg-slate-800" type="button" onClick={toggleCollapsed}>{t(language, collapsed ? 'Expand' : 'Collapse')}</button>
        <button className="rounded border border-red-500/60 px-2 py-1 text-xs text-red-100 hover:bg-red-500/10" type="button" onClick={removeGroup}>{t(language, 'Remove')}</button>
      </div>
    </div>
    {collapsed && <p className="mt-2 truncate text-xs text-slate-500">{[group.bastionHost, group.bastionUsername, group.vmUsername].filter(Boolean).join(' · ') || t(language, 'Using shared defaults')}</p>}
    {!collapsed && <AwsVmTargetGroupDetails addModule={addModule} group={group} language={language} modules={modules} removeModule={removeModule} updateGroup={updateGroup} updateModule={updateModule} />}
  </div>
}

function AwsVmTargetGroupDetails({ addModule, group, language, modules, removeModule, updateGroup, updateModule }: { addModule: () => void; group: AwsVmTargetGroupSettings; language?: Language; modules: AwsVmTargetGroupSettings['modules']; removeModule: (moduleIndex: number) => void; updateGroup: (group: AwsVmTargetGroupSettings) => void; updateModule: (moduleIndex: number, patch: Partial<AwsVmTargetGroupSettings['modules'][number]>) => void }) {
  return <>
    <div className="mt-2 grid gap-2 sm:grid-cols-3">
      <label className="block text-sm">{t(language, 'Group name')}<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" value={group.name} onChange={(event) => updateGroup({ ...group, name: event.target.value })} /></label>
      <label className="block text-sm">{t(language, 'Bastion host override')}<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" value={group.bastionHost ?? ''} onChange={(event) => updateGroup({ ...group, bastionHost: event.target.value })} /></label>
      <label className="block text-sm">{t(language, 'Bastion port override')}<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" type="number" value={group.bastionPort ?? ''} onChange={(event) => updateGroup({ ...group, bastionPort: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
      <label className="block text-sm">{t(language, 'Bastion username override')}<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" value={group.bastionUsername ?? ''} onChange={(event) => updateGroup({ ...group, bastionUsername: event.target.value })} /></label>
      <SecretInput label="Bastion password override" language={language} value={group.bastionPassword ?? ''} onChange={(value) => updateGroup({ ...group, bastionPassword: value })} />
      <SecretInput label="Bastion TOTP override" language={language} value={group.bastionTotpSecret ?? ''} onChange={(value) => updateGroup({ ...group, bastionTotpSecret: value })} />
      <label className="block text-sm">{t(language, 'VM username override')}<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" value={group.vmUsername ?? ''} onChange={(event) => updateGroup({ ...group, vmUsername: event.target.value })} /></label>
      <SecretInput label="VM password override" language={language} value={group.vmPassword ?? ''} onChange={(value) => updateGroup({ ...group, vmPassword: value })} />
    </div>
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase text-slate-400">{t(language, 'Modules')}</h4>
        <button className="rounded border border-sky-500 px-2 py-1 text-xs text-sky-100 hover:bg-sky-500/10" type="button" onClick={addModule}>{t(language, 'Add module')}</button>
      </div>
      {modules.length === 0 && <p className="rounded border border-dashed border-slate-700 p-2 text-xs text-slate-500">{t(language, 'No modules configured. This group uses the inherited Consul command.')}</p>}
      {modules.map((module, moduleIndex) => <div className="grid gap-2 rounded border border-slate-800 p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]" key={module.id}>
        <label className="block text-sm">{t(language, 'Module name')}<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" value={module.name} onChange={(event) => updateModule(moduleIndex, { name: event.target.value })} /></label>
        <label className="block text-sm">{t(language, 'Consul command override')}<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-white" value={module.consulCatalogCommand ?? ''} onChange={(event) => updateModule(moduleIndex, { consulCatalogCommand: event.target.value })} /></label>
        <button className="self-end rounded border border-red-500/60 px-2 py-2 text-xs text-red-100 hover:bg-red-500/10" type="button" onClick={() => removeModule(moduleIndex)}>{t(language, 'Remove')}</button>
      </div>)}
    </div>
  </>
}

function parseTargetGroupsJson(input: string): AwsVmTargetGroupSettings[] {
  const parsed = JSON.parse(input) as unknown
  const groups = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.targetGroups)
      ? parsed.targetGroups
      : undefined
  if (!groups) throw new Error('JSON must be an array or an object with targetGroups')
  return groups.map((group, index) => normalizeImportedGroup(group, index))
}

function normalizeImportedGroup(value: unknown, index: number): AwsVmTargetGroupSettings {
  if (!isRecord(value)) throw new Error(`targetGroups[${index}] must be an object`)
  return {
    id: stringValue(value.id) || newTargetConfigId('bastion'),
    name: stringValue(value.name) || `${'Bastion'} ${index + 1}`,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    bastionHost: optionalString(value.bastionHost),
    bastionPort: typeof value.bastionPort === 'number' ? value.bastionPort : undefined,
    bastionUsername: optionalString(value.bastionUsername),
    bastionPassword: optionalString(value.bastionPassword),
    bastionTotpSecret: optionalString(value.bastionTotpSecret),
    bastionPasswordMode: value.bastionPasswordMode === 'password-plus-totp' ? 'password-plus-totp' : value.bastionPasswordMode === 'password' ? 'password' : undefined,
    vmUsername: optionalString(value.vmUsername),
    vmPassword: optionalString(value.vmPassword),
    consulCatalogCommand: optionalString(value.consulCatalogCommand),
    strictHostKeyChecking: typeof value.strictHostKeyChecking === 'boolean' ? value.strictHostKeyChecking : undefined,
    modules: Array.isArray(value.modules) ? value.modules.map((module, moduleIndex) => normalizeImportedModule(module, moduleIndex)) : [],
  }
}

function normalizeImportedModule(value: unknown, index: number): AwsVmTargetGroupSettings['modules'][number] {
  if (!isRecord(value)) throw new Error(`modules[${index}] must be an object`)
  return {
    id: stringValue(value.id) || newTargetConfigId('module'),
    name: stringValue(value.name) || `${'Module'} ${index + 1}`,
    consulCatalogCommand: optionalString(value.consulCatalogCommand),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function optionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function AwsVmPluginSettingsPanel({ draft, language, sourceTypes, updateAwsVmLogPath, updateAwsVmPlugin }: PluginSettingsPanelProps) {
  const plugin = draft.targetPlugins.awsVm
  const targetGroups = plugin.targetGroups ?? []
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set())
  const [showJsonImport, setShowJsonImport] = useState(false)
  const [jsonImportText, setJsonImportText] = useState(awsVmTargetGroupJsonTemplate)
  const [jsonImportError, setJsonImportError] = useState<string>()
  const updateTargetGroup = (index: number, group: AwsVmTargetGroupSettings) => {
    updateAwsVmPlugin({ targetGroups: targetGroups.map((item, itemIndex) => itemIndex === index ? group : item) })
  }
  const addTargetGroup = () => {
    updateAwsVmPlugin({
      targetGroups: [...targetGroups, {
        id: newTargetConfigId('bastion'),
        name: `${t(language, 'Bastion')} ${targetGroups.length + 1}`,
        enabled: true,
        bastionHost: plugin.bastionHost,
        bastionPort: plugin.bastionPort,
        bastionUsername: plugin.bastionUsername,
        vmUsername: plugin.vmUsername,
        modules: [{ id: newTargetConfigId('module'), name: `${t(language, 'Module')} 1`, consulCatalogCommand: plugin.consulCatalogCommand }],
      }],
    })
  }
  const removeTargetGroup = (index: number) => {
    updateAwsVmPlugin({ targetGroups: targetGroups.filter((_, itemIndex) => itemIndex !== index) })
  }
  const toggleCollapsedGroup = (groupId: string) => {
    setCollapsedGroupIds((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }
  const importTargetGroups = () => {
    try {
      const importedGroups = parseTargetGroupsJson(jsonImportText)
      updateAwsVmPlugin({ targetGroups: importedGroups })
      setCollapsedGroupIds(new Set())
      setJsonImportError(undefined)
      setShowJsonImport(false)
    } catch (error) {
      setJsonImportError(error instanceof Error ? error.message : String(error))
    }
  }
  return <section id="settings-aws-vm-plugin" className="rounded border border-slate-700 bg-slate-950/60 p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold text-white">{t(language, 'AWS VM Target Plugin')}</h3>
        <p className="mt-1 text-xs text-slate-400">{t(language, 'Enable VM log targets discovered from Consul through a bastion host. Saved passwords and TOTP secrets are encrypted locally. Password auth needs sshpass and TOTP mode needs oathtool; if those tools or saved values are unavailable, klogcat falls back to SSH key or agent auth.')}</p>
      </div>
      <label className="inline-flex items-center gap-2 rounded border border-slate-700 px-3 py-1 text-sm text-slate-100">
        <input type="checkbox" checked={plugin.enabled} onChange={(event) => updateAwsVmPlugin({ enabled: event.target.checked })} />
        {t(language, 'Enabled')}
      </label>
    </div>

    <div className="mt-4 space-y-3 rounded border border-slate-800 bg-slate-900/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-white">{t(language, 'Bastion groups and modules')}</h4>
          <p className="mt-1 text-xs text-slate-400">{t(language, 'Add each bastion once, then add modules under that bastion. Values below inherit from shared defaults unless overridden.')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-100 hover:bg-slate-800" type="button" onClick={() => setShowJsonImport((value) => !value)}>{t(language, 'Import JSON template')}</button>
          <button className="rounded border border-sky-500 px-3 py-1 text-xs text-sky-100 hover:bg-sky-500/10" type="button" onClick={addTargetGroup}>{t(language, 'Add bastion group')}</button>
        </div>
      </div>
      {showJsonImport && <div className="rounded border border-slate-800 bg-slate-950 p-2">
        <label className="block text-xs font-semibold uppercase text-slate-400">{t(language, 'Target groups JSON')}</label>
        <textarea className="mt-2 h-56 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-slate-100" spellCheck={false} value={jsonImportText} onChange={(event) => { setJsonImportText(event.target.value); setJsonImportError(undefined) }} />
        {jsonImportError && <p className="mt-2 text-xs text-red-300">{jsonImportError}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="rounded border border-sky-500 px-3 py-1 text-xs text-sky-100 hover:bg-sky-500/10" type="button" onClick={importTargetGroups}>{t(language, 'Import target groups')}</button>
          <button className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-100 hover:bg-slate-800" type="button" onClick={() => setJsonImportText(awsVmTargetGroupJsonTemplate)}>{t(language, 'Reset template')}</button>
        </div>
      </div>}
      {targetGroups.length === 0 && <p className="rounded border border-dashed border-slate-700 bg-slate-950 p-2 text-xs text-slate-500">{t(language, 'No bastion groups configured yet.')}</p>}
      {targetGroups.map((group, index) => <AwsVmTargetGroupPanel
        collapsed={collapsedGroupIds.has(group.id)}
        group={group}
        index={index}
        key={group.id}
        language={language}
        removeGroup={() => removeTargetGroup(index)}
        toggleCollapsed={() => toggleCollapsedGroup(group.id)}
        updateGroup={(nextGroup) => updateTargetGroup(index, nextGroup)}
      />)}
    </div>

    <div className="mt-4 rounded border border-slate-800 bg-slate-900/60 p-3">
      <h4 className="text-sm font-semibold text-white">{t(language, 'Shared defaults')}</h4>
      <p className="mt-1 text-xs text-slate-400">{t(language, 'Used by every bastion group and module unless that item overrides the field.')}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <label className="block text-sm">{t(language, 'Bastion host')}<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" value={plugin.bastionHost} onChange={(event) => updateAwsVmPlugin({ bastionHost: event.target.value })} /></label>
        <label className="block text-sm">{t(language, 'Bastion port')}<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" type="number" value={plugin.bastionPort} onChange={(event) => updateAwsVmPlugin({ bastionPort: Number(event.target.value) })} /></label>
        <label className="block text-sm">{t(language, 'Bastion username')}<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" value={plugin.bastionUsername} onChange={(event) => updateAwsVmPlugin({ bastionUsername: event.target.value })} /></label>
        <SecretInput label="Bastion password" language={language} value={plugin.bastionPassword} onChange={(value) => updateAwsVmPlugin({ bastionPassword: value })} />
        <SecretInput label="Bastion TOTP secret" language={language} value={plugin.bastionTotpSecret ?? ''} onChange={(value) => updateAwsVmPlugin({ bastionTotpSecret: value })} />
        <label className="block text-sm">{t(language, 'Bastion password mode')}<select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" value={plugin.bastionPasswordMode} onChange={(event) => updateAwsVmPlugin({ bastionPasswordMode: event.target.value as PersistedSettings['targetPlugins']['awsVm']['bastionPasswordMode'] })}>
          <option value="password">{t(language, 'Password only')}</option>
          <option value="password-plus-totp">{t(language, 'Password + current TOTP')}</option>
        </select></label>
        <label className="block text-sm">{t(language, 'VM username')}<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white" value={plugin.vmUsername} onChange={(event) => updateAwsVmPlugin({ vmUsername: event.target.value })} /></label>
        <SecretInput label="VM password" language={language} value={plugin.vmPassword} onChange={(value) => updateAwsVmPlugin({ vmPassword: value })} />
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
    </div>

    <p className="mt-2 text-xs text-slate-500">{t(language, 'After saving, open the VM tab in target selection to load Consul catalog results.')}</p>
  </section>
}

function CsvFileTargetPluginSettingsPanel({ draft, language, updateCsvFilePlugin }: PluginSettingsPanelProps) {
  const plugin = draft.targetPlugins.csvFile
  const loadFile = (file: File | undefined) => {
    if (!file) return
    void file.text().then((csvText) => updateCsvFilePlugin({ csvText }))
  }
  return <section id="settings-csv-file-plugin" className="rounded border border-slate-700 bg-slate-950/60 p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold text-white">{t(language, 'CSV File Target Plugin')}</h3>
        <p className="mt-1 text-xs text-slate-400">{t(language, 'Load VM log targets from a CSV file. Required header: address or ip or host. Optional headers: id, name, service, datacenter, tags.')}</p>
      </div>
      <label className="inline-flex items-center gap-2 rounded border border-slate-700 px-3 py-1 text-sm text-slate-100">
        <input type="checkbox" checked={plugin.enabled} onChange={(event) => updateCsvFilePlugin({ enabled: event.target.checked })} />
        {t(language, 'Enabled')}
      </label>
    </div>
    <label className="mt-3 block text-sm">{t(language, 'CSV file')}
      <input accept=".csv,text/csv" className="mt-1 block w-full text-xs text-slate-300 file:mr-3 file:rounded file:border-0 file:bg-sky-500 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white" type="file" onChange={(event) => loadFile(event.currentTarget.files?.[0])} />
    </label>
    <label className="mt-3 block text-sm">{t(language, 'CSV content')}
      <textarea className="mt-1 h-40 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-white" value={plugin.csvText} onChange={(event) => updateCsvFilePlugin({ csvText: event.target.value })} placeholder="id,name,address,service,datacenter,tags&#10;api-1,api-1,10.0.0.7,api,prod,blue|critical" />
    </label>
    <p className="mt-2 text-xs text-slate-500">{t(language, 'CSV targets use the VM SSH/log path settings when streams are started.')}</p>
  </section>
}

export const pluginSettingsPanels = Object.freeze({
  awsVm: AwsVmPluginSettingsPanel,
  csvFile: CsvFileTargetPluginSettingsPanel,
})

export function TargetPluginSettingsPanels(props: PluginSettingsPanelProps) {
  return <>
    {Object.entries(pluginSettingsPanels).map(([key, Panel]) => <Panel key={key} {...props} />)}
  </>
}
