import { describe, expect, it, vi } from 'vitest'
import { getCurrentContext, listContexts, listNamespaces, listPods } from '../commands/tauriKube'

describe('tauriKube browser fallback', () => {
  it('returns empty Kubernetes discovery data outside the Tauri runtime', async () => {
    vi.stubGlobal('isTauri', false)

    await expect(getCurrentContext()).resolves.toBe('')
    await expect(listContexts()).resolves.toEqual({ contexts: [] })
    await expect(listNamespaces('ctx')).resolves.toEqual({ context: 'ctx', namespaces: [] })
    await expect(listPods('ns', 'ctx')).resolves.toEqual({ context: 'ctx', namespace: 'ns', pods: [] })

    vi.unstubAllGlobals()
  })
})
