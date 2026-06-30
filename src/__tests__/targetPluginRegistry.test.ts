import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../config/defaultSettings'
import { targetPluginDefinitions, createTargetPluginRegistry, isTargetPluginEnabled, validateTargetPluginDefinitionCapabilities, validateTargetPluginSettings } from '../plugins/targetPluginRegistry'
import { noopTargetPlugin } from '../plugins/examples/NoopTargetPlugin'
import type { TargetPluginDefinition } from '../plugins/pluginModel'

describe('target plugin registry', () => {
  it('exposes the core AWS VM target plugin', () => {
    expect(targetPluginDefinitions.map((plugin) => plugin.manifest.id)).toContain('aws-vm')
    expect(targetPluginDefinitions.find((plugin) => plugin.manifest.id === 'aws-vm')?.manifest.kind).toBe('target')
  })

  it('can create a registry with a second target plugin fixture', () => {
    const registry = createTargetPluginRegistry([...targetPluginDefinitions, noopTargetPlugin])
    expect(registry.map((plugin) => plugin.manifest.id)).toEqual(['aws-vm', 'noop-target'])
  })

  it('rejects unknown target plugin settings keys', () => {
    const errors: Array<{ field: string; message: string }> = []
    validateTargetPluginSettings({ ...defaultSettings.targetPlugins, unknown: { enabled: true } }, errors)
    expect(errors).toContainEqual(expect.objectContaining({ field: 'targetPlugins.unknown' }))
  })

  it('reports disabled and enabled target plugin state through policy', () => {
    expect(isTargetPluginEnabled(defaultSettings.targetPlugins, 'awsVm')).toBe(false)
    expect(isTargetPluginEnabled({ ...defaultSettings.targetPlugins, awsVm: { ...defaultSettings.targetPlugins.awsVm, enabled: true } }, 'awsVm')).toBe(true)
  })

  it('rejects unknown target runtime capabilities with plugin id and capability', () => {
    const badPlugin = {
      ...noopTargetPlugin,
      requiredCapabilities: ['target.discovery', 'unknown.runtime'],
    } as unknown as TargetPluginDefinition
    expect(() => validateTargetPluginDefinitionCapabilities(badPlugin)).toThrow(/noop-target.*unknown.runtime/)
  })
})
