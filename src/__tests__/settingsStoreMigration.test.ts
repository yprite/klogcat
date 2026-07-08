import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '../config/defaultSettings'
import { defaultColorTheme } from '../utils/colorTheme'
import { defaultFontSize } from '../utils/fontScale'
import { useSettingsStore } from '../stores/settingsStore'
import { getSettings, saveSettings } from '../commands/tauriSettings'

vi.mock('../commands/tauriSettings', () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(async (settings) => settings),
  resetSettings: vi.fn(async () => defaultSettings),
}))

describe('settings store migration', () => {
  beforeEach(() => {
    vi.mocked(getSettings).mockReset()
    vi.mocked(saveSettings).mockReset()
    vi.mocked(saveSettings).mockImplementation(async (settings) => settings)
    useSettingsStore.setState({
      settings: defaultSettings,
      warning: undefined,
      loading: false,
      error: undefined,
    })
  })

  it('normalizes legacy targetPlugins and invalid appearance settings on load', async () => {
    vi.mocked(getSettings).mockResolvedValueOnce({
      settings: {
        ...defaultSettings,
        defaultNamespace: ' payments ',
        colorTheme: 'invalid-theme',
        menuFontSize: 'huge',
        logViewerFontSize: 42,
        shortcuts: undefined,
        logPolicyId: undefined,
        logPolicy: undefined,
        plugins: undefined,
        targetPlugins: {
          awsVm: {
            enabled: true,
            bastionHost: 'bastion.example.com',
            bastionUsername: 'ops',
            bastionPassword: 'secret',
            vmUsername: 'operator@example.com',
            vmPassword: 'vm-secret',
            bastionTotpProfile: 'legacy-profile',
            streamCommandTemplate: 'legacy-stream',
            logPaths: { info: '/legacy/info.log' },
          },
        },
      } as never,
    })

    await useSettingsStore.getState().loadSettings()

    const settings = useSettingsStore.getState().settings
    expect(settings?.defaultNamespace).toBe('payments')
    expect(settings?.colorTheme).toBe(defaultColorTheme)
    expect(settings?.menuFontSize).toBe(defaultFontSize)
    expect(settings?.logViewerFontSize).toBe(defaultFontSize)
    expect(settings?.shortcuts).toBe(defaultSettings.shortcuts)
    expect(settings?.logPolicyId).toBe('scloud')
    expect(settings?.logPolicy).toBeDefined()
    expect(settings?.plugins.targets.awsVm.enabled).toBe(true)
    expect(settings?.plugins.targets.awsVm.logPaths.info).toBe('/legacy/info.log')
    expect(settings?.plugins.targets.awsVm.targetGroups).toEqual(defaultSettings.plugins.targets.awsVm.targetGroups)
  })

  it('keeps modern plugin viewer overrides and clears blank namespaces', async () => {
    vi.mocked(getSettings).mockResolvedValueOnce({
      settings: {
        ...defaultSettings,
        defaultNamespace: '   ',
        plugins: {
          ...defaultSettings.plugins,
          targets: {
            ...defaultSettings.plugins.targets,
            csvFile: { enabled: true, csvText: 'name,address\napi,10.0.0.7' },
          },
          viewers: {
            ...defaultSettings.plugins.viewers,
            raw: { enabled: false },
            apiFlowGraph: { enabled: false },
          },
        },
      },
    })

    await useSettingsStore.getState().loadSettings()

    const settings = useSettingsStore.getState().settings
    expect(settings?.defaultNamespace).toBeUndefined()
    expect(settings?.plugins.targets.csvFile.enabled).toBe(true)
    expect(settings?.plugins.viewers.raw.enabled).toBe(true)
    expect(settings?.plugins.viewers.apiFlowGraph.enabled).toBe(false)
  })

  it('saves language-only changes when plugin extension config is present', async () => {
    const dirtySettings = {
      ...defaultSettings,
      plugins: {
        ...defaultSettings.plugins,
        extensionRoot: { schema: 1, enabled: true },
        targets: {
          ...defaultSettings.plugins.targets,
          thirdPartyTarget: { enabled: true, endpoint: 'https://example.invalid/targets' },
        },
        viewers: {
          ...defaultSettings.plugins.viewers,
          raw: { enabled: false },
          thirdPartyViewer: { enabled: false, layout: 'timeline' },
        },
      },
    } as unknown as typeof defaultSettings
    useSettingsStore.setState({ settings: dirtySettings })

    await expect(useSettingsStore.getState().saveSettings({ ...dirtySettings, language: 'ko' })).resolves.toBe(true)

    const saved = vi.mocked(saveSettings).mock.calls[0]?.[0] as typeof defaultSettings & {
      plugins: typeof defaultSettings.plugins & {
        extensionRoot: { schema: number; enabled: boolean }
        targets: typeof defaultSettings.plugins.targets & { thirdPartyTarget: { enabled: boolean; endpoint: string } }
        viewers: typeof defaultSettings.plugins.viewers & { thirdPartyViewer: { enabled: boolean; layout: string } }
      }
    }
    expect(saved.language).toBe('ko')
    expect(saved.plugins.extensionRoot).toEqual({ schema: 1, enabled: true })
    expect(saved.plugins.targets.thirdPartyTarget).toEqual({ enabled: true, endpoint: 'https://example.invalid/targets' })
    expect(saved.plugins.viewers.raw.enabled).toBe(true)
    expect(saved.plugins.viewers.thirdPartyViewer).toEqual({ enabled: false, layout: 'timeline' })
  })
})
