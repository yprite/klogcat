import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_LOG_VIEWER_EXTENSION_ID,
  findLogViewerExtension,
  getLogViewerExtensions,
  registerLogViewerExtension,
  resetLogViewerExtensionsForTests,
  unregisterLogViewerExtension,
} from '../extensions/logViewerExtensions'
import type { LogViewerExtension, LogViewerExtensionProps } from '../sdk/log-viewer'

function TestViewer({ snapshot }: LogViewerExtensionProps) {
  return <div>Rows: {snapshot.visibleRows.length}</div>
}

function extension(overrides: Partial<LogViewerExtension> & Pick<LogViewerExtension, 'id' | 'label' | 'description'>): LogViewerExtension {
  return {
    ownerId: 'vendor',
    component: TestViewer,
    requestedCapabilities: ['logs.read'],
    trustLevel: 'trusted-bundled',
    ...overrides,
  }
}

describe('log viewer extension registry', () => {
  afterEach(() => resetLogViewerExtensionsForTests())

  it('exposes only the raw log viewer as the core tab', () => {
    expect(getLogViewerExtensions().map((extension) => extension.id)).toEqual([DEFAULT_LOG_VIEWER_EXTENSION_ID])
    expect(findLogViewerExtension('raw')?.label).toBe('Raw Logs')
  })

  it('registers third-party log viewers after the core viewer by default', () => {
    const unregister = registerLogViewerExtension(extension({
      id: 'vendor.latency',
      label: 'Latency Map',
      description: 'Vendor latency breakdown',
    }))

    expect(getLogViewerExtensions().map((extension) => extension.id)).toEqual(['raw', 'vendor.latency'])
    expect(findLogViewerExtension('vendor.latency')?.source).toBe('third-party')

    expect(unregister()).toBe(true)
    expect(findLogViewerExtension('vendor.latency')).toBeUndefined()
  })

  it('sorts third-party viewers by order and rejects unsafe ids', () => {
    registerLogViewerExtension(extension({ id: 'vendor.slow', label: 'Slow Calls', description: 'Slow call list', order: 110 }))
    registerLogViewerExtension(extension({ id: 'vendor.fast', label: 'Fast Calls', description: 'Fast call list', order: 90 }))

    expect(getLogViewerExtensions().map((extension) => extension.id)).toEqual(['raw', 'vendor.fast', 'vendor.slow'])
    expect(() => registerLogViewerExtension(extension({ id: 'Vendor Fast', label: 'Bad', description: 'Bad id' }))).toThrow(/Invalid log viewer extension id/)
  })

  it('protects existing ids unless replacement uses the same owner', () => {
    registerLogViewerExtension(extension({ id: 'vendor.latency', label: 'Latency Map', description: 'Vendor latency breakdown' }))

    expect(() => registerLogViewerExtension(extension({ id: 'raw', label: 'Raw Override', description: 'Reserved id' }))).toThrow(/reserved/)
    expect(() => registerLogViewerExtension(extension({ id: 'vendor.latency', label: 'Latency Map 2', description: 'Duplicate id' }))).toThrow(/already registered/)
    expect(() => registerLogViewerExtension(extension({ id: 'vendor.latency', ownerId: 'other-vendor', label: 'Latency Map 2', description: 'Replacement' }), { replace: true })).toThrow(/same ownerId/)

    registerLogViewerExtension(extension({ id: 'vendor.latency', label: 'Latency Map 2', description: 'Replacement' }), { replace: true })
    expect(findLogViewerExtension('vendor.latency')?.label).toBe('Latency Map 2')
  })

  it('requires logs.read and rejects unknown capabilities', () => {
    expect(() => registerLogViewerExtension(extension({ id: 'vendor.no-read', label: 'No Read', description: 'Missing read', requestedCapabilities: [] }))).toThrow(/logs.read/)
    expect(() => registerLogViewerExtension(extension({ id: 'vendor.unknown-cap', label: 'Unknown', description: 'Unknown cap', requestedCapabilities: ['logs.read', 'network' as never] }))).toThrow(/unknown capability/)
  })

  it('returns false when unregistering an unknown extension', () => {
    expect(unregisterLogViewerExtension('vendor.missing')).toBe(false)
  })
})
