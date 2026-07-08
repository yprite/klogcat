import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../config/defaultSettings'
import { targetPluginDefinitions, createTargetPluginRegistry, isTargetPluginEnabled, validateTargetPluginDefinitionCapabilities, validateTargetPluginSettings } from '../plugins/targetPluginRegistry'
import { noopTargetPlugin } from '../plugins/examples/NoopTargetPlugin'
import { csvTargetsFromText } from '../plugins/csvFileTargetPlugin'
import type { TargetPluginDefinition } from '../plugins/pluginModel'

describe('target plugin registry', () => {
  it('exposes the core AWS VM target plugin', () => {
    expect(targetPluginDefinitions.map((plugin) => plugin.manifest.id)).toContain('aws-vm')
    expect(targetPluginDefinitions.map((plugin) => plugin.manifest.id)).toContain('csv-file')
    expect(targetPluginDefinitions.find((plugin) => plugin.manifest.id === 'aws-vm')?.manifest.kind).toBe('target')
  })

  it('can create a registry with a second target plugin fixture', () => {
    const registry = createTargetPluginRegistry([...targetPluginDefinitions, noopTargetPlugin])
    expect(registry.map((plugin) => plugin.manifest.id)).toEqual(['aws-vm', 'csv-file', 'noop-target'])
  })

  it('allows unknown target plugin settings keys as extension-owned config', () => {
    const errors: Array<{ field: string; message: string }> = []
    validateTargetPluginSettings({ ...defaultSettings.plugins.targets, unknown: { enabled: true } }, errors)
    expect(errors).toEqual([])
  })

  it('reports disabled and enabled target plugin state through policy', () => {
    expect(isTargetPluginEnabled(defaultSettings.plugins.targets, 'awsVm')).toBe(false)
    expect(isTargetPluginEnabled(defaultSettings.plugins.targets, 'csvFile')).toBe(false)
    expect(isTargetPluginEnabled({ ...defaultSettings.plugins.targets, awsVm: { ...defaultSettings.plugins.targets.awsVm, enabled: true } }, 'awsVm')).toBe(true)
    expect(isTargetPluginEnabled({ ...defaultSettings.plugins.targets, csvFile: { enabled: true, csvText: 'name,address\napi,10.0.0.1' } }, 'csvFile')).toBe(true)
  })

  it('parses CSV file targets with optional metadata', () => {
    expect(csvTargetsFromText('id,name,address,service,datacenter,tags\napi-1,API,10.0.0.7,api,prod,blue|critical')).toEqual([expect.objectContaining({
      id: 'csv:api-1',
      name: 'API',
      address: '10.0.0.7',
      service: 'api',
      datacenter: 'prod',
      tags: ['blue', 'critical'],
    })])
  })

  it('rejects unknown target runtime capabilities with plugin id and capability', () => {
    const badPlugin = {
      ...noopTargetPlugin,
      requiredCapabilities: ['target.discovery', 'unknown.runtime'],
    } as unknown as TargetPluginDefinition
    expect(() => validateTargetPluginDefinitionCapabilities(badPlugin)).toThrow(/noop-target.*unknown.runtime/)
  })
})
