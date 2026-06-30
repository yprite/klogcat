# Plugin platform todo and verification gates

Goal: make klogcat a plugin platform with two first-class plugin kinds.

- `target` plugins own target discovery, target settings, enabled policy, validation, and stream target metadata.
- `viewer` plugins own log rendering, investigation views, viewer capabilities, and SDK access.

## Completion gates

All gates below are binary and machine-checkable unless marked `manual`.

| Gate | Required value |
| --- | --- |
| `npm run typecheck -- --pretty false` | exit code `0` |
| `npm run test:plugin-platform` | exit code `0` |
| `npx vitest run src/__tests__/settings.test.ts src/__tests__/logViewerExtensions.test.tsx src/__tests__/logViewerExtensionLoader.test.tsx src/__tests__/logViewerExtensionProtocol.test.ts src/__tests__/buttonActions.test.tsx` | exit code `0` |
| `npx vitest run src/__tests__/targetPluginRegistry.test.ts` | exit code `0` |
| `cargo test` in `src-tauri` | exit code `0` |
| Core plugin kinds | exactly `2`: `target`, `viewer` |
| Core target plugins | at least `1`: `aws-vm` |
| Core viewer plugins | at least `1`: `raw` |
| Target plugin default settings source | `defaultSettings.targetPlugins.awsVm` comes from `defaultAwsVmTargetPluginSettings` |
| Target plugin validation source | `validateSettings()` delegates `targetPlugins` validation to `validateTargetPluginSettings()` |
| Target picker plugin policy | target picker uses `isTargetPluginEnabled()` for VM availability |
| Top bar plugin policy | top bar uses `isTargetPluginEnabled()` for selected VM counts |
| Viewer SDK target identity | SDK rows expose `target.kind` and optional `target.vm` |

## Todo list

### PP-001: Stabilize the plugin manifest model

Files:

- `src/plugins/pluginModel.ts`
- `src/plugins/pluginRegistry.ts`

Acceptance:

- `KlogcatPluginKind` contains exactly `target` and `viewer`.
- Every plugin manifest has `id`, `ownerId`, `kind`, `label`, `description`, `source`, and `order`.
- `getPluginManifests()` returns target and viewer manifests in deterministic order.

Harness:

- `npm run test:plugin-platform`

### PP-002: Make target plugins own settings policy

Files:

- `src/plugins/targetPluginRegistry.ts`
- `src/plugins/awsVmTargetPlugin.ts`
- `src/config/defaultSettings.ts`
- `src/config/validateSettings.ts`
- `src/stores/settingsStore.ts`

Acceptance:

- Default AWS VM settings are exported from `awsVmTargetPlugin.ts`.
- `validateSettings()` calls `validateTargetPluginSettings()` for `targetPlugins`.
- No target plugin default or validation policy is implemented directly inside `validateSettings.ts`.
- Legacy AWS VM setting cleanup remains in `settingsStore.ts`.

Harness:

- `npm run test:plugin-platform`
- `npm run typecheck -- --pretty false`
- `npx vitest run src/__tests__/settings.test.ts`

### PP-003: Make target selection plugin-aware

Files:

- `src/components/TargetPickerDialog.tsx`
- `src/components/TopBar.tsx`
- `src/components/LogToolbar.tsx`
- `src/components/LogViewer.tsx`

Acceptance:

- Target picker uses `isTargetPluginEnabled()` for VM tab visibility.
- Top bar uses `isTargetPluginEnabled()` for selected target count.
- Log toolbar uses `isTargetPluginEnabled()` for start availability.
- Log viewer empty state uses `isTargetPluginEnabled()` for target copy.
- When AWS VM plugin is enabled, target picker exposes exactly two tabs: `Kubernetes`, `AWS VM`.
- When AWS VM plugin is disabled, target picker exposes no AWS VM tab.

Harness:

- `npm run test:plugin-platform`
- `npx vitest run src/__tests__/buttonActions.test.tsx`

Manual browser check:

- Start dev server.
- Disable AWS VM plugin.
- Open target picker and verify `AWS VM` tab count is `0`.
- Enable AWS VM plugin.
- Open target picker and verify `AWS VM` tab count is `1`.
- Click `AWS VM` tab and verify VM panel is visible.

### PP-004: Make viewer plugins visible through the same platform registry

Files:

- `src/extensions/logViewerExtensions.tsx`
- `src/plugins/pluginRegistry.ts`
- `src/sdk/log-viewer.ts`
- `src/extensions/logViewerSdkAdapter.ts`

Acceptance:

- Existing log viewer extensions are exposed as `viewer` plugin definitions.
- Raw Logs is exposed as core viewer plugin `raw`.
- SDK rows expose `target.kind`.
- SDK rows expose `target.vm` for AWS VM rows.

Harness:

- `npm run test:plugin-platform`
- `npx vitest run src/__tests__/logViewerExtensions.test.tsx src/__tests__/logViewerExtensionProtocol.test.ts`

### PP-005: Split plugin UI extension points

Files to create or update:

- `src/plugins/pluginSettingsPanels.tsx`
- `src/plugins/targetSelectionPanels.tsx`
- `src/components/SettingsModalSections.tsx`
- `src/components/TargetPickerDialog.tsx`

Acceptance:

- Target plugin settings panels are registered by plugin definition, not hardcoded in settings modal navigation.
- Target selection panels are registered by plugin definition, not hardcoded in target picker tab content.
- Adding a second target plugin requires editing no more than `3` files: plugin definition, optional settings panel, optional selection panel.

Harness to add:

- Static check that `SettingsModalSections.tsx` does not import AWS VM-specific types.
- Static check that `TargetPickerDialog.tsx` does not import AWS VM-specific types except shared target metadata.

### PP-006: Add a sample no-op target plugin fixture

Files to create:

- `src/plugins/examples/NoopTargetPlugin.ts`
- `src/__tests__/targetPluginRegistry.test.ts`

Acceptance:

- Registry can load at least `2` target plugin definitions in tests.
- Unknown target plugin settings keys are rejected.
- Disabled target plugin does not alter selected target counts.
- Enabled target plugin appears as a selectable target source.

Harness:

- `npm run test:plugin-platform`
- `npx vitest run src/__tests__/targetPluginRegistry.test.ts`

### PP-007: Add runtime capability boundaries

Files to update:

- `src/sdk/log-viewer.ts`
- `src/plugins/pluginModel.ts`
- `src/extensions/logViewerExtensionLoader.ts`

Acceptance:

- Viewer plugins declare capabilities from a finite set.
- Target plugins declare required runtime capabilities from a finite set.
- Unknown capabilities fail activation or settings validation.
- Capability error includes plugin id and unknown capability string.

Harness:

- `npm run test:plugin-platform`
- `npx vitest run src/__tests__/logViewerExtensionLoader.test.tsx`

### PP-008: Add plugin inventory UI

Files to create or update:

- `src/components/PluginInventoryPanel.tsx`
- `src/components/SettingsModalSections.tsx`

Acceptance:

- Settings shows a plugin inventory section.
- Inventory lists plugin id, kind, source, enabled state, and description.
- Core plugin inventory count is at least `2`.
- AWS VM enabled state in inventory changes when the checkbox changes.

Harness to add:

- Component test asserting inventory contains `aws-vm` as `target`.
- Component test asserting inventory contains `raw` as `viewer`.

## Current known intentional gaps

These gaps must stay empty before declaring the platform complete.

| Gap | Blocking gate |
| --- | --- |
| Target plugin settings panels are registered, but the AWS VM implementation still owns AWS-specific fields | PP-005 follow-up |
| Target selection panels are registered, but tab selection still assumes the single AWS VM target plugin id | PP-005 follow-up |
| No-op target plugin is a test fixture only, not a runtime install example | PP-006 follow-up |
| Target plugin runtime capabilities are modeled for target plugins only; no unified installer permission prompt exists | PP-007 follow-up |
| Plugin inventory UI exists, but inventory component tests are still pending | PP-008 follow-up |
