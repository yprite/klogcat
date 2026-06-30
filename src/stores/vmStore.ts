import { create } from 'zustand'
import { listVmTargets } from '../commands/tauriVm'
import type { CommandError } from '../commands/types'
import type { TargetPluginSettings, VmTargetInfo } from '../types/vm'

type VmState = {
  targets: VmTargetInfo[]
  selectedTargetIds: string[]
  loading: boolean
  error?: CommandError
  loadTargets(plugin: TargetPluginSettings): Promise<void>
  selectTargets(targetIds: string[]): void
  clearTargets(): void
  getSelectedVmTargets(): VmTargetInfo[]
}

export const vmTargetValue = (target: VmTargetInfo) => target.id

export const useVmStore = create<VmState>((set, get) => ({
  targets: [],
  selectedTargetIds: [],
  loading: false,
  async loadTargets(plugin) {
    if (!plugin.awsVm.enabled) {
      set({ targets: [], selectedTargetIds: [], error: undefined, loading: false })
      return
    }
    set({ loading: true, error: undefined })
    try {
      const res = await listVmTargets(plugin)
      const ids = new Set(res.targets.map(vmTargetValue))
      set((state) => ({
        targets: res.targets,
        selectedTargetIds: state.selectedTargetIds.filter((id) => ids.has(id)),
        loading: false,
        error: undefined,
      }))
    } catch (error) {
      set({ error: error as CommandError, loading: false })
    }
  },
  selectTargets(targetIds) {
    set({ selectedTargetIds: targetIds })
  },
  clearTargets() {
    set({ targets: [], selectedTargetIds: [], error: undefined, loading: false })
  },
  getSelectedVmTargets() {
    const selected = new Set(get().selectedTargetIds)
    return get().targets.filter((target) => selected.has(vmTargetValue(target)))
  },
}))
