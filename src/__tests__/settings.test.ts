import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../config/defaultSettings'
import { validateSettings } from '../config/validateSettings'
import { awsVmPluginForTarget, getAwsVmConnectionReadiness } from '../plugins/awsVmTargetPlugin'

describe('settings validation', () => {
  const withTargetPlugins = (targets: typeof defaultSettings.plugins.targets) => ({ ...defaultSettings, plugins: { ...defaultSettings.plugins, targets } })

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
    const enabled = { ...defaultSettings.plugins.targets.awsVm, enabled: true, targetGroups: [] }
    const validEnabled = { ...enabled, bastionHost: 'bastion.example.com', bastionUsername: 'ops', bastionPassword: 'secret', vmUsername: 'app', vmPassword: 'vm-secret', targetGroups: [] }
    expect(validateSettings(withTargetPlugins({ ...defaultSettings.plugins.targets, awsVm: { ...enabled, bastionHost: '' } }))).toEqual([])
    expect(getAwsVmConnectionReadiness({ ...enabled, bastionHost: '' }).missing).toContain('plugins.targets.awsVm.bastionHost')
    expect(validateSettings(withTargetPlugins({ ...defaultSettings.plugins.targets, awsVm: { ...enabled, bastionPort: 0 } }))).toContainEqual(expect.objectContaining({ field: 'plugins.targets.awsVm.bastionPort' }))
    expect(validateSettings(withTargetPlugins({ ...defaultSettings.plugins.targets, awsVm: { ...enabled, bastionPassword: 'bad\0secret' } }))).toContainEqual(expect.objectContaining({ field: 'plugins.targets.awsVm.bastionPassword' }))
    expect(validateSettings(withTargetPlugins({ ...defaultSettings.plugins.targets, awsVm: { ...enabled, bastionUsername: '-bad' } }))).toContainEqual(expect.objectContaining({ field: 'plugins.targets.awsVm.bastionUsername' }))
    expect(validateSettings(withTargetPlugins({ ...defaultSettings.plugins.targets, awsVm: { ...enabled, bastionPasswordMode: 'password-plus-totp', bastionTotpSecret: '' } }))).toContainEqual(expect.objectContaining({ field: 'plugins.targets.awsVm.bastionTotpSecret' }))
    expect(validateSettings(withTargetPlugins({ ...defaultSettings.plugins.targets, awsVm: { ...enabled, logPaths: { info: '/x' } } }))).toContainEqual(expect.objectContaining({ field: 'plugins.targets.awsVm.logPaths' }))
    expect(validateSettings(withTargetPlugins({ ...defaultSettings.plugins.targets, awsVm: { ...validEnabled, vmUsername: 'operator@example.com' } }))).toEqual([])
    expect(validateSettings(withTargetPlugins({ ...defaultSettings.plugins.targets, awsVm: { ...validEnabled, bastionUsername: 'operator@example.com' } }))).toContainEqual(expect.objectContaining({ field: 'plugins.targets.awsVm.bastionUsername' }))
    expect(validateSettings(withTargetPlugins({ ...defaultSettings.plugins.targets, csvFile: { enabled: true, csvText: '' } }))).toContainEqual(expect.objectContaining({ field: 'plugins.targets.csvFile.csvText' }))
    expect(validateSettings(withTargetPlugins({ ...defaultSettings.plugins.targets, csvFile: { enabled: true, csvText: 'name,address\napi,10.0.0.7' } }))).toEqual([])
  })

  it('does not block saving incomplete AWS VM settings while the plugin is disabled', () => {
    expect(validateSettings(withTargetPlugins({
      ...defaultSettings.plugins.targets,
      awsVm: {
        ...defaultSettings.plugins.targets.awsVm,
        enabled: false,
        bastionPort: 0,
        bastionPasswordMode: 'invalid' as never,
        targetGroups: [{
          id: 'prod',
          name: 'Prod',
          enabled: true,
          modules: [],
        }],
      },
    }))).toEqual([])
  })

  it('accepts AWS VM bastion groups and module overrides', () => {
    const settings = {
      ...defaultSettings,
      plugins: {
        ...defaultSettings.plugins,
        targets: {
          ...defaultSettings.plugins.targets,
          awsVm: {
            ...defaultSettings.plugins.targets.awsVm,
            enabled: true,
            bastionUsername: 'ops',
            bastionPassword: 'bastion-secret',
            vmUsername: 'operator@example.com',
            vmPassword: 'vm-secret',
            targetGroups: [{
              id: 'prod',
              name: 'Prod',
              enabled: true,
              bastionHost: 'bastion-prod.example.com',
              modules: [{ id: 'api', name: 'API', consulCatalogCommand: 'consul catalog nodes -service api -format=json' }],
            }],
          },
        },
      },
    }

    expect(validateSettings(settings)).toEqual([])
    const plugin = awsVmPluginForTarget(settings.plugins.targets.awsVm, {
      id: 'prod:api:api-1',
      name: 'api-1',
      address: '10.0.0.7',
      bastionId: 'prod',
      bastionName: 'Prod',
      moduleId: 'api',
      moduleName: 'API',
    })
    expect(plugin.bastionHost).toBe('bastion-prod.example.com')
    expect(plugin.consulCatalogCommand).toBe('consul catalog nodes -service api -format=json')
    expect(plugin.targetGroups).toEqual([])
  })
})
