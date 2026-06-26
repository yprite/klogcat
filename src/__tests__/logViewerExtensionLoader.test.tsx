import { beforeEach, describe, expect, it, vi } from 'vitest'
import { activateConfiguredKlogcatExtensions, activateKlogcatExtensionModule } from '../extensions/logViewerExtensionLoader'
import { klogcatExtension as externalFixtureExtension } from './fixtures/external-extensions/latencyPackage'
import type { KlogcatExtensionHost, KlogcatExtensionModule, LogViewerExtensionProps } from '../sdk/log-viewer'

function TestViewer({ snapshot }: LogViewerExtensionProps) {
  return <div>{snapshot.visibleRowCount}</div>
}

const host: KlogcatExtensionHost = {
  registerLogViewer: vi.fn(() => () => true),
}

function module(overrides: Partial<KlogcatExtensionModule['manifest']> = {}): KlogcatExtensionModule {
  return {
    manifest: {
      id: 'vendor.latency',
      ownerId: 'vendor',
      protocol: { name: 'klogcat.logViewer', version: 1 },
      label: 'Latency',
      description: 'Latency view',
      requestedCapabilities: ['logs.read'],
      trustLevel: 'trusted-bundled',
      ...overrides,
    },
    activate(extensionHost) {
      extensionHost.registerLogViewer({
        id: 'vendor.latency',
        ownerId: 'vendor',
        label: 'Latency',
        description: 'Latency view',
        component: TestViewer,
        requestedCapabilities: ['logs.read'],
        trustLevel: 'trusted-bundled',
      })
    },
  }
}

describe('log viewer extension loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('activates a build-time imported extension module after manifest validation', () => {
    activateKlogcatExtensionModule(module(), host)

    expect(host.registerLogViewer).toHaveBeenCalledWith(expect.objectContaining({
      id: 'vendor.latency',
      requestedCapabilities: ['logs.read'],
    }))
  })

  it('activates an external package fixture through the configured module path', () => {
    const result = activateConfiguredKlogcatExtensions([{ module: externalFixtureExtension }], host)

    expect(result.activatedIds).toEqual(['fixture.latency'])
    expect(result.errors).toEqual([])
    expect(host.registerLogViewer).toHaveBeenCalledWith(expect.objectContaining({
      id: 'fixture.latency',
      requestedCapabilities: ['logs.read'],
    }))
  })

  it('rejects unsupported protocol versions and unknown capabilities before activation', () => {
    expect(() => activateKlogcatExtensionModule(module({ protocol: { name: 'klogcat.logViewer', version: 2 as never } }), host)).toThrow(/protocol version/)
    expect(() => activateKlogcatExtensionModule(module({ requestedCapabilities: ['logs.read', 'network' as never] }), host)).toThrow(/Unknown extension capability/)
  })

  it('activates configured build-time modules in deterministic order and recovers from failures', () => {
    const cleanupOrder: string[] = []
    const cleanupSlow = vi.fn(() => cleanupOrder.push('vendor.slow'))
    const cleanupFast = vi.fn(() => cleanupOrder.push('vendor.fast'))
    const activated: string[] = []
    const fast = module({ id: 'vendor.fast', label: 'Fast' })
    fast.activate = () => {
      activated.push('vendor.fast')
      return cleanupFast
    }
    const broken = module({ id: 'vendor.broken', label: 'Broken', protocol: { name: 'klogcat.logViewer', version: 2 as never } })
    const slow = module({ id: 'vendor.slow', label: 'Slow' })
    slow.activate = () => {
      activated.push('vendor.slow')
      return cleanupSlow
    }

    const result = activateConfiguredKlogcatExtensions([
      { module: slow, order: 50 },
      { module: broken, order: 20 },
      { module: fast, order: 10 },
    ], host)

    expect(activated).toEqual(['vendor.fast', 'vendor.slow'])
    expect(result.activatedIds).toEqual(['vendor.fast', 'vendor.slow'])
    expect(result.errors).toEqual([{ id: 'vendor.broken', message: 'Unsupported extension protocol version: 2' }])

    result.cleanup()
    expect(cleanupOrder).toEqual(['vendor.slow', 'vendor.fast'])
  })
})
