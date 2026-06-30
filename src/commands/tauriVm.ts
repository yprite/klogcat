import { invoke, isTauri } from '@tauri-apps/api/core'
import type { ListVmTargetsResponse, TargetPluginSettings } from '../types/vm'

export type ListVmTargetsRequest = { plugin: TargetPluginSettings }

export const listVmTargets = (plugin: TargetPluginSettings) => isTauri()
  ? invoke<ListVmTargetsResponse>('list_vm_targets', { request: { plugin } satisfies ListVmTargetsRequest })
  : Promise.reject({ code: 'vm_runtime_unavailable', message: 'AWS VM discovery requires the desktop app runtime' })
