import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../config/defaultSettings'
import { resolveWorkbenchFeatureFlags, workbenchFeatureFlagNames } from '../config/workbenchFeatureFlags'
import { validateSettings } from '../config/validateSettings'

describe('workbench feature flags', () => {
  it('defaults every workbench MVP flag off', () => {
    expect(resolveWorkbenchFeatureFlags(undefined)).toEqual({
      'workbench.workloadFollow.enabled': false,
      'workbench.kubernetesContext.enabled': false,
      'workbench.incidentTriage.enabled': false,
    })
  })

  it('keeps the flag vocabulary explicit and roadmap-aligned', () => {
    expect(workbenchFeatureFlagNames).toEqual([
      'workbench.workloadFollow.enabled',
      'workbench.kubernetesContext.enabled',
      'workbench.incidentTriage.enabled',
    ])
  })

  it('allows explicit opt-in flags', () => {
    expect(resolveWorkbenchFeatureFlags({ 'workbench.workloadFollow.enabled': true })).toMatchObject({
      'workbench.workloadFollow.enabled': true,
      'workbench.kubernetesContext.enabled': false,
      'workbench.incidentTriage.enabled': false,
    })
  })

  it('accepts default settings and rejects unknown or non-boolean workbench flags', () => {
    expect(validateSettings(defaultSettings)).toEqual([])
    expect(validateSettings({ ...defaultSettings, workbench: { featureFlags: { 'workbench.workloadFollow.enabled': 'yes' } } })).toContainEqual(expect.objectContaining({ field: 'workbench.featureFlags.workbench.workloadFollow.enabled' }))
    expect(validateSettings({ ...defaultSettings, workbench: { featureFlags: { 'workbench.unknown.enabled': true } } })).toContainEqual(expect.objectContaining({ field: 'workbench.featureFlags.workbench.unknown.enabled' }))
  })
})
