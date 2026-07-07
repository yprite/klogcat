import { describe, expect, it } from 'vitest'
import { getPluginManifests, getViewerPluginDefinitions, viewerPluginDefinitionFromExtension } from '../plugins/pluginRegistry'
import type { RegisteredLogViewerExtension } from '../sdk/log-viewer'

function viewerExtension(overrides: Partial<RegisteredLogViewerExtension> = {}): RegisteredLogViewerExtension {
  return {
    id: 'third-party.viewer-flow',
    ownerId: 'vendor',
    label: 'Vendor Flow',
    description: 'Third-party flow viewer',
    source: 'third-party',
    order: 30,
    requestedCapabilities: ['logs.read'],
    trustLevel: 'trusted-bundled',
    component: () => null,
    ...overrides,
  }
}

describe('plugin registry', () => {
  it('converts viewer extensions to viewer plugin definitions', () => {
    const plugin = viewerPluginDefinitionFromExtension(viewerExtension())

    expect(plugin.manifest).toEqual(expect.objectContaining({
      id: 'third-party.viewer-flow',
      kind: 'viewer',
      label: 'Vendor Flow',
    }))
    expect(plugin.settingsKey).toBe('thirdPartyViewerFlow')
    expect(plugin.extensionId).toBe('third-party.viewer-flow')
    expect(plugin.defaultSettings).toEqual({ enabled: true })
    expect(plugin.requestedCapabilities).toEqual(['logs.read'])
  })

  it('uses built-in viewer settings keys and enabled fallback rules', () => {
    const graphPlugin = viewerPluginDefinitionFromExtension(viewerExtension({ id: 'klogcat.api-flow-graph' }))
    const vendorPlugin = viewerPluginDefinitionFromExtension(viewerExtension())

    expect(graphPlugin.settingsKey).toBe('apiFlowGraph')
    expect(graphPlugin.isEnabled(undefined)).toBe(true)
    expect(graphPlugin.isEnabled({ apiFlowGraph: { enabled: false } })).toBe(false)
    expect(graphPlugin.isEnabled({ apiFlowGraph: { enabled: true } })).toBe(true)
    expect(vendorPlugin.isEnabled({ other: { enabled: false } })).toBe(true)
  })

  it('returns viewer plugin definitions for supplied extensions', () => {
    expect(getViewerPluginDefinitions([
      viewerExtension({ id: 'b.viewer', label: 'B Viewer', order: 2 }),
      viewerExtension({ id: 'a.viewer', label: 'A Viewer', order: 1 }),
    ]).map((plugin) => plugin.manifest.id)).toEqual(['b.viewer', 'a.viewer'])
  })

  it('combines target and viewer manifests in stable display order', () => {
    const manifests = getPluginManifests()
    const orders = manifests.map((manifest) => manifest.order)

    expect(orders).toEqual([...orders].sort((a, b) => a - b))
    expect(manifests.map((manifest) => manifest.kind)).toContain('target')
    expect(manifests.map((manifest) => manifest.kind)).toContain('viewer')
  })
})
