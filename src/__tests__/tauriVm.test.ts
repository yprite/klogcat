import { describe, expect, it, vi } from 'vitest'
import { listVmTargets } from '../commands/tauriVm'
import { defaultSettings } from '../config/defaultSettings'
import { invoke, isTauri } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}))

describe('tauriVm browser fallback', () => {
  it('reports a readable runtime error outside Tauri', async () => {
    vi.mocked(isTauri).mockReturnValue(false)

    await expect(listVmTargets(defaultSettings.targetPlugins)).rejects.toMatchObject({ code: 'vm_runtime_unavailable' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('invokes VM target discovery inside Tauri', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockResolvedValue({ targets: [] })

    await expect(listVmTargets(defaultSettings.targetPlugins)).resolves.toEqual({ targets: [] })
    expect(invoke).toHaveBeenCalledWith('list_vm_targets', { request: { plugin: defaultSettings.targetPlugins } })
  })
})
