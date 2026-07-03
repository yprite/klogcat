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

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

function AwsVmTargetSelectionPanel({ language, normalizedQuery, onVmTargetChange, runSelectionChange, selectedVmTargets, selectionPending, setDraftSelectedVmTargets }: TargetSelectionPanelProps) {
  const settings = useSettingsStore((state) => state.settings)
  const vm = useVmStore()
  const plugin = settings?.plugins.targets.awsVm
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
  const visibleTargets = vm.targets.filter((target) => !isCsvTargetId(target.id)).filter((target) => {
    if (!normalizedQuery) return true
    return [target.id, target.name, target.address, target.service, target.datacenter, target.bastionName, target.moduleName, ...(target.tags ?? [])].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery)
  })
  return <div className="border-b border-slate-800 p-3">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold text-white">{t(language, 'AWS VM')}</h3>
        <p className="text-xs text-slate-400">{t(language, 'Consul catalog targets through bastion')}</p>
      </div>
      <button className="rounded border border-sky-500 px-3 py-1 text-xs text-sky-100 hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-60" disabled={vm.loading} onClick={refresh}>{t(language, vm.loading ? 'Loading VM targets...' : 'Refresh VM targets')}</button>
    </div>
    {vm.error && <div className="mb-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-200">
      <p>{vm.error.message}</p>
      {vm.error.details && <p className="mt-1 whitespace-pre-wrap text-red-200/80">{vm.error.details}</p>}
      <p className="mt-1 text-red-200/60">{vm.error.code}</p>
    </div>}
    {visibleTargets.length === 0 && !vm.loading && <p className="rounded border border-dashed border-slate-700 bg-slate-900/60 p-2 text-xs text-slate-400">{t(language, vm.targets.length === 0 ? 'No VM targets loaded.' : 'No VM targets match the current search.')}</p>}
    <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
      {visibleTargets.map((target) => {
        const value = vmTargetValue(target)
        const checked = selectedVmTargets.includes(value)
        const metadata = [target.bastionName, target.moduleName, target.id, target.service, target.datacenter, ...(target.tags ?? [])].filter(Boolean)
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
