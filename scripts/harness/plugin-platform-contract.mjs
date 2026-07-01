import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname)

function read(file) {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8')
}

const checks = []

function check(name, pass, detail = '') {
  checks.push({ name, pass: Boolean(pass), detail })
}

function includes(file, needle) {
  return read(file).includes(needle)
}

function notIncludes(file, needle) {
  return !includes(file, needle)
}

check(
  'plugin model declares target and viewer kinds',
  includes('src/plugins/pluginModel.ts', "export type KlogcatPluginKind = 'target' | 'viewer'"),
)

check(
  'target plugin definition includes manifest contract',
  includes('src/plugins/pluginModel.ts', 'export type TargetPluginDefinition') &&
    includes('src/plugins/pluginModel.ts', "manifest: KlogcatPluginManifest & { kind: 'target' }") &&
    includes('src/plugins/pluginModel.ts', 'settingsKey: string') &&
    includes('src/plugins/pluginModel.ts', 'requiredCapabilities: readonly TargetPluginRuntimeCapability[]') &&
    includes('src/plugins/pluginModel.ts', 'validate(value: unknown, errors: SettingsValidationError[], sourceTypes?: SourceLogType[]): void'),
)

check(
  'viewer plugin definition exists',
  includes('src/plugins/pluginModel.ts', 'export type ViewerPluginDefinition') &&
    includes('src/plugins/pluginModel.ts', "manifest: KlogcatPluginManifest & { kind: 'viewer' }"),
)

check(
  'aws vm target plugin owns default settings',
  includes('src/plugins/awsVmTargetPlugin.ts', 'defaultAwsVmTargetPluginSettings') &&
    includes('src/plugins/awsVmTargetPlugin.ts', "id: AWS_VM_TARGET_PLUGIN_ID") &&
    includes('src/plugins/awsVmTargetPlugin.ts', "kind: 'target'") &&
    includes('src/plugins/awsVmTargetPlugin.ts', "settingsKey: AWS_VM_TARGET_SETTINGS_KEY"),
)

check(
  'target registry registers aws vm target plugin',
  includes('src/plugins/targetPluginRegistry.ts', 'awsVmTargetPlugin') &&
    includes('src/plugins/targetPluginRegistry.ts', 'targetPluginDefinitions') &&
    includes('src/plugins/targetPluginRegistry.ts', 'validateTargetPluginSettings') &&
    includes('src/plugins/targetPluginRegistry.ts', 'isTargetPluginEnabled') &&
    includes('src/plugins/targetPluginRegistry.ts', 'validateTargetPluginDefinitionCapabilities') &&
    includes('src/plugins/targetPluginRegistry.ts', 'createTargetPluginRegistry'),
)

check(
  'default settings consumes target plugin defaults',
  includes('src/config/defaultSettings.ts', 'defaultAwsVmTargetPluginSettings') &&
    includes('src/config/defaultSettings.ts', 'awsVm: defaultAwsVmTargetPluginSettings'),
)

check(
  'settings validation delegates target plugins to registry',
  includes('src/config/validateSettings.ts', 'validateTargetPluginSettings') &&
    includes('src/config/validateSettings.ts', 'validateTargetPluginSettings(value.targetPlugins, errors, sourceKeys(policy))') &&
    notIncludes('src/config/validateSettings.ts', 'function validateAwsVmPlugin'),
)

check(
  'settings store deep merge uses target plugin default',
  includes('src/stores/settingsStore.ts', 'defaultAwsVmTargetPluginSettings') &&
    includes('src/stores/settingsStore.ts', 'defaultAwsVmTargetPluginSettings.logPaths'),
)

for (const file of [
  'src/components/TopBar.tsx',
  'src/components/TargetPickerDialog.tsx',
  'src/components/LogToolbar.tsx',
  'src/components/LogViewer.tsx',
  'src/components/AppShell.tsx',
  'src/extensions/logViewerSdkAdapter.ts',
]) {
  check(
    `${file} uses target plugin enabled policy`,
    includes(file, 'isTargetPluginEnabled('),
    'Expected plugin enabled policy instead of direct targetPlugins.awsVm.enabled checks.',
  )
}

check(
  'target picker exposes kubernetes and aws vm tabs',
  includes('src/components/TargetPickerDialog.tsx', "useState<'kubernetes' | 'aws-vm'>") &&
    includes('src/components/TargetPickerDialog.tsx', "role=\"tablist\"") &&
    includes('src/components/TargetPickerDialog.tsx', "role=\"tab\"") &&
    includes('src/components/TargetPickerDialog.tsx', "'Kubernetes'") &&
    includes('src/components/TargetPickerDialog.tsx', "'AWS VM'"),
)

check(
  'settings nav reads target plugin definitions',
  includes('src/components/SettingsModalSections.tsx', 'targetPluginDefinitions.map') &&
    includes('src/components/SettingsModalSections.tsx', 'plugin.manifest.label'),
)

check(
  'target plugin settings panels are registered outside settings sections',
    includes('src/plugins/pluginSettingsPanels.tsx', 'pluginSettingsPanels') &&
    includes('src/plugins/pluginSettingsPanels.tsx', 'awsVm: AwsVmPluginSettingsPanel') &&
    includes('src/components/SettingsSectionContent.tsx', 'TargetPluginSettingsPanels') &&
    notIncludes('src/components/SettingsModalSections.tsx', 'AwsVmTargetPluginSettings') &&
    notIncludes('src/components/SettingsModalSections.tsx', 'AwsVmPluginSection'),
)

check(
  'target selection panels are registered outside target picker',
  includes('src/plugins/targetSelectionPanels.tsx', 'targetSelectionPanels') &&
    includes('src/plugins/targetSelectionPanels.tsx', 'awsVm: AwsVmTargetSelectionPanel') &&
    includes('src/components/TargetPickerDialog.tsx', 'targetSelectionPanels.awsVm') &&
    notIncludes('src/components/TargetPickerDialog.tsx', 'function VmTargetsPanel') &&
    notIncludes('src/components/TargetPickerDialog.tsx', "type { VmTargetInfo }"),
)

check(
  'viewer plugins are bridged into platform registry',
  includes('src/plugins/pluginRegistry.ts', 'viewerPluginDefinitionFromExtension') &&
    includes('src/plugins/pluginRegistry.ts', "kind: 'viewer'") &&
    includes('src/plugins/pluginRegistry.ts', 'getPluginManifests'),
)

check(
  'viewer sdk exposes target kind and vm identity',
  includes('src/sdk/log-viewer.ts', "kind?: 'kubernetes' | 'aws-vm'") &&
    includes('src/sdk/log-viewer.ts', 'vm?: {') &&
    includes('src/extensions/logViewerSdkAdapter.ts', "kind: row.targetKind ?? 'kubernetes'") &&
    includes('src/extensions/logViewerSdkAdapter.ts', "vm: row.targetKind === 'aws-vm' ? row.vm?.target : undefined"),
)

check(
  'noop target plugin fixture and registry test exist',
  fs.existsSync(path.join(repoRoot, 'src/plugins/examples/NoopTargetPlugin.ts')) &&
    includes('src/plugins/examples/NoopTargetPlugin.ts', 'noopTargetPlugin') &&
    includes('src/__tests__/targetPluginRegistry.test.ts', 'createTargetPluginRegistry') &&
    includes('src/__tests__/targetPluginRegistry.test.ts', 'unknown.runtime'),
)

check(
  'target runtime capability boundary exists',
  includes('src/plugins/pluginModel.ts', 'TARGET_PLUGIN_RUNTIME_CAPABILITIES') &&
    includes('src/plugins/pluginModel.ts', "'target.discovery'") &&
    includes('src/plugins/pluginModel.ts', "'process.spawn'") &&
    includes('src/plugins/pluginModel.ts', "'network.ssh'") &&
    includes('src/plugins/targetPluginRegistry.ts', 'requested unknown capability'),
)

check(
  'plugin inventory UI exists',
  fs.existsSync(path.join(repoRoot, 'src/components/PluginInventoryPanel.tsx')) &&
    includes('src/components/PluginInventoryPanel.tsx', 'getPluginManifests') &&
    includes('src/components/PluginInventoryPanel.tsx', 'Plugin id') &&
    includes('src/components/SettingsSectionContent.tsx', 'PluginInventoryPanel'),
)

check(
  'plugin platform todo document exists',
  fs.existsSync(path.join(repoRoot, 'docs/plugin-platform-todo.md')) &&
    includes('docs/plugin-platform-todo.md', 'PP-001') &&
    includes('docs/plugin-platform-todo.md', 'PP-008'),
)

const failed = checks.filter((item) => !item.pass)

for (const item of checks) {
  const status = item.pass ? 'PASS' : 'FAIL'
  console.log(`${status} ${item.name}${item.pass || !item.detail ? '' : ` - ${item.detail}`}`)
}

console.log(`plugin-platform-contract: ${checks.length - failed.length}/${checks.length} checks passed`)

if (failed.length > 0) process.exit(1)
