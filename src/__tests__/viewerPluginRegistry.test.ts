import { describe, expect, it } from 'vitest'
import {
  API_FLOW_GRAPH_VIEWER_SETTINGS_KEY,
  defaultViewerPluginSettings,
  isViewerPluginEnabled,
  settingsKeyForViewerExtension,
  validateViewerPluginSettings,
  viewerPluginDefinitions,
} from '../plugins/viewerPluginRegistry'

describe('viewer plugin registry', () => {
  it('exposes raw logs and graph viewer plugins', () => {
    expect(viewerPluginDefinitions.map((plugin) => plugin.settingsKey)).toEqual(['raw', API_FLOW_GRAPH_VIEWER_SETTINGS_KEY])
    expect(settingsKeyForViewerExtension('raw')).toBe('raw')
    expect(settingsKeyForViewerExtension('klogcat.api-flow-graph')).toBe(API_FLOW_GRAPH_VIEWER_SETTINGS_KEY)
    expect(settingsKeyForViewerExtension('third.party.viewer')).toBeUndefined()
  })

  it('keeps raw logs enabled and lets graph viewer follow settings', () => {
    expect(isViewerPluginEnabled(undefined, 'raw')).toBe(true)
    expect(isViewerPluginEnabled({ ...defaultViewerPluginSettings, raw: { enabled: false } }, 'raw')).toBe(true)
    expect(isViewerPluginEnabled({ ...defaultViewerPluginSettings, apiFlowGraph: { enabled: false } }, API_FLOW_GRAPH_VIEWER_SETTINGS_KEY)).toBe(false)
    expect(isViewerPluginEnabled(undefined, 'unknown')).toBe(true)
  })

  it('validates known viewer plugin setting shape and required raw viewer state', () => {
    const errors: Array<{ field: string; message: string }> = []
    validateViewerPluginSettings({ raw: { enabled: false, extra: true }, apiFlowGraph: { enabled: 'yes' }, unknown: {} }, errors)

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'plugins.viewers.raw.enabled' }),
      expect.objectContaining({ field: 'plugins.viewers.raw.extra' }),
      expect.objectContaining({ field: 'plugins.viewers.apiFlowGraph.enabled' }),
    ]))
    expect(errors).not.toContainEqual(expect.objectContaining({ field: 'plugins.viewers.unknown' }))
  })

  it('rejects non-object viewer plugin containers and entries', () => {
    const containerErrors: Array<{ field: string; message: string }> = []
    validateViewerPluginSettings([], containerErrors)
    expect(containerErrors).toContainEqual(expect.objectContaining({ field: 'plugins.viewers' }))

    const entryErrors: Array<{ field: string; message: string }> = []
    validateViewerPluginSettings({ raw: null, apiFlowGraph: [] }, entryErrors)
    expect(entryErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'plugins.viewers.raw' }),
      expect.objectContaining({ field: 'plugins.viewers.apiFlowGraph' }),
    ]))
  })
})
