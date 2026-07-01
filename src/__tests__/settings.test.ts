import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../config/defaultSettings'
import { validateSettings } from '../config/validateSettings'

describe('settings validation', () => {
  it('accepts default settings', () => { expect(validateSettings(defaultSettings)).toEqual([]) })
  it('rejects uppercase source keys', () => { expect(validateSettings({ ...defaultSettings, logSources: { INFO: { container: 'app', filePath: '/x' } } })).toContainEqual(expect.objectContaining({ field: 'logSources' })) })
  it('rejects relative file paths', () => { expect(validateSettings({ ...defaultSettings, logSources: { ...defaultSettings.logSources, info: { container: 'app', filePath: 'relative.log' } } })).toContainEqual(expect.objectContaining({ field: 'logSources.info.filePath' })) })
  it('rejects non-object log source maps', () => { expect(validateSettings({ ...defaultSettings, logSources: null })).toContainEqual(expect.objectContaining({ field: 'logSources' })) })
  it('enforces numeric boundaries', () => {
    expect(validateSettings({ ...defaultSettings, initialTailLines: -1 })).toContainEqual(expect.objectContaining({ field: 'initialTailLines' }))
    expect(validateSettings({ ...defaultSettings, initialTailLines: 100001 })).toContainEqual(expect.objectContaining({ field: 'initialTailLines' }))
    expect(validateSettings({ ...defaultSettings, bufferLimit: 999 })).toContainEqual(expect.objectContaining({ field: 'bufferLimit' }))
    expect(validateSettings({ ...defaultSettings, bufferLimit: 200001 })).toContainEqual(expect.objectContaining({ field: 'bufferLimit' }))
  })
  it('rejects strict-schema violations', () => {
    expect(validateSettings({ ...defaultSettings, extra: true })).toContainEqual(expect.objectContaining({ field: 'settings.extra' }))
    expect(validateSettings({ ...defaultSettings, logSources: { ...defaultSettings.logSources, info: { ...defaultSettings.logSources.info, label: 'INFO' } } })).toContainEqual(expect.objectContaining({ field: 'logSources.info.label' }))
    expect(validateSettings({ ...defaultSettings, schemaVersion: 2 })).toContainEqual(expect.objectContaining({ field: 'schemaVersion' }))
    expect(validateSettings({ ...defaultSettings, defaultNamespace: 123 })).toContainEqual(expect.objectContaining({ field: 'defaultNamespace' }))
    expect(validateSettings({ ...defaultSettings, shortcuts: 'Meta+K' })).toContainEqual(expect.objectContaining({ field: 'shortcuts' }))
    expect(validateSettings({ ...defaultSettings, shortcuts: { openSettings: 42 } })).toContainEqual(expect.objectContaining({ field: 'shortcuts.openSettings' }))
    expect(validateSettings({ ...defaultSettings, logSources: { ...defaultSettings.logSources, info: { container: '', filePath: '/x' } } })).toContainEqual(expect.objectContaining({ field: 'logSources.info.container' }))
    expect(validateSettings({ ...defaultSettings, logSources: { ...defaultSettings.logSources, info: { container: 'app', filePath: '/x\0y' } } })).toContainEqual(expect.objectContaining({ field: 'logSources.info.filePath' }))
  })
  it('accepts a valid log policy selection and rejects malformed policy overrides', () => {
    expect(validateSettings({ ...defaultSettings, logPolicyId: 'scloud', logPolicy: defaultSettings.logPolicy })).toEqual([])
    expect(validateSettings({ ...defaultSettings, logPolicyId: 'custom', logPolicy: defaultSettings.logPolicy })).toEqual([])
    expect(validateSettings({ ...defaultSettings, logPolicyId: 'unknown' })).toContainEqual(expect.objectContaining({ field: 'logPolicyId' }))
    expect(validateSettings({ ...defaultSettings, logPolicy: { version: 1 } })).toContainEqual(expect.objectContaining({ field: 'logPolicy' }))
  })
  it('validates AWS VM target plugin settings', () => {
    const enabled = { ...defaultSettings.targetPlugins.awsVm, enabled: true }
    expect(validateSettings({ ...defaultSettings, targetPlugins: { ...defaultSettings.targetPlugins, awsVm: { ...enabled, bastionHost: '' } } })).toContainEqual(expect.objectContaining({ field: 'targetPlugins.awsVm.bastionHost' }))
    expect(validateSettings({ ...defaultSettings, targetPlugins: { ...defaultSettings.targetPlugins, awsVm: { ...enabled, bastionPort: 0 } } })).toContainEqual(expect.objectContaining({ field: 'targetPlugins.awsVm.bastionPort' }))
    expect(validateSettings({ ...defaultSettings, targetPlugins: { ...defaultSettings.targetPlugins, awsVm: { ...enabled, bastionPasswordEnv: 'bad-name' } } })).toContainEqual(expect.objectContaining({ field: 'targetPlugins.awsVm.bastionPasswordEnv' }))
    expect(validateSettings({ ...defaultSettings, targetPlugins: { ...defaultSettings.targetPlugins, awsVm: { ...enabled, bastionUsername: '-bad' } } })).toContainEqual(expect.objectContaining({ field: 'targetPlugins.awsVm.bastionUsername' }))
    expect(validateSettings({ ...defaultSettings, targetPlugins: { ...defaultSettings.targetPlugins, awsVm: { ...enabled, bastionPasswordMode: 'password-plus-totp', bastionTotpSecretEnv: '' } } })).toContainEqual(expect.objectContaining({ field: 'targetPlugins.awsVm.bastionTotpSecretEnv' }))
    expect(validateSettings({ ...defaultSettings, targetPlugins: { ...defaultSettings.targetPlugins, awsVm: { ...enabled, logPaths: { info: '/x' } } } })).toContainEqual(expect.objectContaining({ field: 'targetPlugins.awsVm.logPaths' }))
    expect(validateSettings({ ...defaultSettings, targetPlugins: { ...defaultSettings.targetPlugins, csvFile: { enabled: true, csvText: '' } } })).toContainEqual(expect.objectContaining({ field: 'targetPlugins.csvFile.csvText' }))
    expect(validateSettings({ ...defaultSettings, targetPlugins: { ...defaultSettings.targetPlugins, csvFile: { enabled: true, csvText: 'name,address\napi,10.0.0.7' } } })).toEqual([])
  })
})
