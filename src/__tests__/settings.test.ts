import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../config/defaultSettings'
import { validateSettings } from '../config/validateSettings'

describe('settings validation', () => {
  it('accepts default settings', () => { expect(validateSettings(defaultSettings)).toEqual([]) })
  it('rejects uppercase source keys', () => { expect(validateSettings({ ...defaultSettings, logSources: { INFO: { container: 'app', filePath: '/x' } } })).toContainEqual(expect.objectContaining({ field: 'logSources' })) })
  it('rejects relative file paths', () => { expect(validateSettings({ ...defaultSettings, logSources: { ...defaultSettings.logSources, info: { container: 'app', filePath: 'relative.log' } } })).toContainEqual(expect.objectContaining({ field: 'logSources.info.filePath' })) })
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
    expect(validateSettings({ ...defaultSettings, logSources: { ...defaultSettings.logSources, info: { container: '', filePath: '/x' } } })).toContainEqual(expect.objectContaining({ field: 'logSources.info.container' }))
    expect(validateSettings({ ...defaultSettings, logSources: { ...defaultSettings.logSources, info: { container: 'app', filePath: '/x\0y' } } })).toContainEqual(expect.objectContaining({ field: 'logSources.info.filePath' }))
  })
  it('accepts a valid log policy and rejects malformed policy overrides', () => {
    expect(validateSettings({ ...defaultSettings, logPolicy: defaultSettings.logPolicy })).toEqual([])
    expect(validateSettings({ ...defaultSettings, logPolicy: { version: 1 } })).toContainEqual(expect.objectContaining({ field: 'logPolicy' }))
  })
})
