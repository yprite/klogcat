import { useMemo, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useVmStore, vmTargetValue } from '../stores/vmStore'
import { t, type Language } from '../utils/i18n'
import type { VmTargetInfo } from '../types/vm'
import { isCsvTargetId } from './csvFileTargetPlugin'

type TargetSelectionPanelProps = {
  language?: Language
  normalizedQuery: string
  onVmTargetChange: (targets: string[]) => void | Promise<void>
  runSelectionChange: (change: () => void | Promise<void>) => void
  selectedVmTargets: string[]
  selectionPending: boolean
  setDraftSelectedVmTargets: (values: string[]) => void
}

type VisibleVmModule = { id: string; name: string; targets: VmTargetInfo[] }
type VisibleVmRegion = { id: string; name: string; modules: VisibleVmModule[] }

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

function AwsVmTargetSelectionPanel({ language, normalizedQuery, onVmTargetChange, runSelectionChange, selectedVmTargets, selectionPending, setDraftSelectedVmTargets }: TargetSelectionPanelProps) {
  const settings = useSettingsStore((state) => state.settings)
  const vm = useVmStore()
  const plugin = settings?.plugins.targets.awsVm
  const [collapsedRegions, setCollapsedRegions] = useState<Record<string, boolean>>({})
  const visibleTargets = vm.targets.filter((target) => !isCsvTargetId(target.id)).filter((target) => {
    if (!normalizedQuery) return true
    return [target.id, target.name, target.address, target.service, target.datacenter, target.bastionName, target.moduleName, ...(target.tags ?? [])].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery)
  })
  const visibleTree = useMemo(() => buildVmTargetTree(visibleTargets), [visibleTargets])
  if (!settings || !plugin?.enabled) return null
  const refresh = () => {
    void useVmStore.getState().loadTargets(settings.plugins.targets)
  }
  const toggleVm = (target: VmTargetInfo) => {
    const value = vmTargetValue(target)
    const next = toggleValue(selectedVmTargets, value)
    setDraftSelectedVmTargets(next)
    runSelectionChange(() => onVmTargetChange(next))
  }
  const toggleRegion = (regionId: string) => setCollapsedRegions((current) => ({ ...current, [regionId]: !current[regionId] }))
  return <div className="border-b border-slate-800 p-3">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold text-white">{t(language, 'AWS VM')}</h3>
        <p className="text-xs text-slate-400">{t(language, 'Region/Bastion → Module → VM. VM instances map to Kubernetes pods.')}</p>
      </div>
      <button className="rounded border border-sky-500 px-3 py-1 text-xs text-sky-100 hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-60" disabled={vm.loading} onClick={refresh}>{t(language, vm.loading ? 'Loading VM targets...' : 'Refresh VM targets')}</button>
    </div>
    {vm.error && <div className="mb-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-200">
      <p>{vm.error.message}</p>
      {vm.error.details && <p className="mt-1 whitespace-pre-wrap text-red-200/80">{vm.error.details}</p>}
      <p className="mt-1 text-red-200/60">{vm.error.code}</p>
    </div>}
    {visibleTargets.length === 0 && !vm.loading && <p className="rounded border border-dashed border-slate-700 bg-slate-900/60 p-2 text-xs text-slate-400">{t(language, vm.targets.length === 0 ? 'No VM targets loaded.' : 'No VM targets match the current search.')}</p>}
    <div className="max-h-96 space-y-3 overflow-y-auto">
      {visibleTree.map((region) => {
        const collapsed = Boolean(collapsedRegions[region.id])
        const vmCount = region.modules.reduce((count, module) => count + module.targets.length, 0)
        return <div className="rounded border border-slate-800 bg-slate-900/40" key={region.id}>
          <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2 font-semibold text-white">
            <button type="button" aria-expanded={!collapsed} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-700 bg-slate-950 text-xs text-slate-200 hover:border-yellow-400 hover:text-yellow-300" onClick={() => toggleRegion(region.id)}>
              <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
            </button>
            <span className="min-w-0 flex-1 truncate">{region.name}</span>
            <span className="shrink-0 text-xs font-normal text-slate-500">{region.modules.length} {t(language, region.modules.length === 1 ? 'module' : 'modules')} · {vmCount} {t(language, vmCount === 1 ? 'VM' : 'VMs')}</span>
          </div>
          {!collapsed && <div className="space-y-2 p-2">
            {region.modules.map((module) => <div className="rounded border border-slate-800 bg-slate-950/70" key={`${region.id}:${module.id}`}>
              <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-100">
                <span className="min-w-0 flex-1 truncate">{module.name}</span>
                <span className="text-xs font-normal text-slate-500">{module.targets.length} {t(language, module.targets.length === 1 ? 'VM' : 'VMs')}</span>
              </div>
              <div className="space-y-1 pb-2 pl-7 pr-2">
                {module.targets.map((target) => <VmTargetRow key={vmTargetValue(target)} language={language} selectionPending={selectionPending} selectedVmTargets={selectedVmTargets} target={target} toggleVm={toggleVm} />)}
              </div>
            </div>)}
          </div>}
        </div>
      })}
    </div>
    <p className="sr-only">{t(language, 'Target tree')}</p>
  </div>
}

function buildVmTargetTree(targets: VmTargetInfo[]): VisibleVmRegion[] {
  const regions = new Map<string, VisibleVmRegion>()
  for (const target of targets) {
    const regionId = target.bastionId ?? 'default-bastion'
    const moduleId = target.moduleId ?? 'default-module'
    let region = regions.get(regionId)
    if (!region) {
      region = { id: regionId, name: target.bastionName ?? 'Default Bastion', modules: [] }
      regions.set(regionId, region)
    }
    let module = region.modules.find((item) => item.id === moduleId)
    if (!module) {
      module = { id: moduleId, name: target.moduleName ?? 'Default Module', targets: [] }
      region.modules.push(module)
    }
    module.targets.push(target)
  }
  return [...regions.values()]
}

function VmTargetRow({ language, selectionPending, selectedVmTargets, target, toggleVm }: { language?: Language; selectionPending: boolean; selectedVmTargets: string[]; target: VmTargetInfo; toggleVm: (target: VmTargetInfo) => void }) {
  const value = vmTargetValue(target)
  const checked = selectedVmTargets.includes(value)
  const metadata = [target.id, target.service, target.datacenter, ...(target.tags ?? [])].filter(Boolean)
  return <label className={`flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-800 ${checked ? 'border border-yellow-400/40 bg-yellow-400/10 text-yellow-100 shadow-[0_0_0_1px_rgba(250,204,21,0.10)]' : 'text-slate-200'}`}>
    <input aria-label={`${target.bastionName ?? 'Bastion'} / ${target.moduleName ?? 'Module'} / ${target.name}`} type="checkbox" checked={checked} disabled={selectionPending} onChange={() => toggleVm(target)} />
    <span className="min-w-0 flex-1">
      <span className="block truncate">{target.name}</span>
      {metadata.length > 0 && <span className="mt-0.5 block truncate text-xs text-slate-500">{metadata.join(' · ')}</span>}
    </span>
    {checked && <span className="rounded bg-yellow-400 px-1.5 py-0.5 text-[10px] font-semibold text-slate-950">{t(language, 'Selected')}</span>}
    <span className="shrink-0 font-mono text-xs text-slate-500">{target.address}</span>
  </label>
}

function CsvFileTargetSelectionPanel({ language, normalizedQuery, onVmTargetChange, runSelectionChange, selectedVmTargets, selectionPending, setDraftSelectedVmTargets }: TargetSelectionPanelProps) {
  const settings = useSettingsStore((state) => state.settings)
  const vm = useVmStore()
  const plugin = settings?.plugins.targets.csvFile
  if (!settings || !plugin?.enabled) return null
  const refresh = () => {
    void useVmStore.getState().loadTargets(settings.plugins.targets)
  }
  const toggleVm = (target: VmTargetInfo) => {
    const value = vmTargetValue(target)
    const next = toggleValue(selectedVmTargets, value)
    setDraftSelectedVmTargets(next)
    runSelectionChange(() => onVmTargetChange(next))
  }
  const visibleTargets = vm.targets.filter((target) => isCsvTargetId(target.id)).filter((target) => {
    if (!normalizedQuery) return true
    return [target.id, target.name, target.address, target.service, target.datacenter, ...(target.tags ?? [])].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery)
  })
  return <div className="border-b border-slate-800 p-3">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold text-white">{t(language, 'CSV File')}</h3>
        <p className="text-xs text-slate-400">{t(language, 'Targets loaded from CSV settings')}</p>
      </div>
      <button className="rounded border border-sky-500 px-3 py-1 text-xs text-sky-100 hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-60" disabled={vm.loading} onClick={refresh}>{t(language, vm.loading ? 'Loading CSV targets...' : 'Reload CSV targets')}</button>
    </div>
    {visibleTargets.length === 0 && <p className="rounded border border-dashed border-slate-700 bg-slate-900/60 p-2 text-xs text-slate-400">{t(language, plugin.csvText.trim() ? 'No CSV targets match the current search.' : 'No CSV content configured.')}</p>}
    <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
      {visibleTargets.map((target) => {
        const value = vmTargetValue(target)
        const checked = selectedVmTargets.includes(value)
        const metadata = [target.service, target.datacenter, ...(target.tags ?? [])].filter(Boolean)
        return <label className={`flex min-w-0 items-start gap-2 rounded border px-2 py-1 text-sm ${checked ? 'border-yellow-400/40 bg-yellow-400/10 text-yellow-100' : 'border-slate-800 bg-slate-950 text-slate-200'}`} key={value}>
          <input type="checkbox" checked={checked} disabled={selectionPending} onChange={() => toggleVm(target)} />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{target.name}</span>
            {metadata.length > 0 && <span className="mt-0.5 block truncate text-xs text-slate-500">{metadata.join(' · ')}</span>}
          </span>
          <span className="shrink-0 font-mono text-xs text-slate-500">{target.address}</span>
        </label>
      })}
    </div>
    <p className="sr-only">{t(language, 'Target tree')}</p>
  </div>
}

export const targetSelectionPanels = Object.freeze({
  awsVm: AwsVmTargetSelectionPanel,
  csvFile: CsvFileTargetSelectionPanel,
})
