# Log Viewer Extension SDK Plan

**Goal:** klogcat core ships only the `Raw Logs` viewer. Every additional log viewer tab is developed, registered, and maintained as an extension that targets a stable klogcat log-viewer SDK protocol.

**End image:** A third-party developer can build a log viewer without importing klogcat internals, register it with a manifest-like API, receive a versioned host SDK, and appear as a selectable tab beside `Raw Logs`.

**Current starting point:** `klogcat.logViewer@1` exists with a public SDK boundary at `klogcat/sdk/log-viewer`, a host-side registry, `sdk`, and `snapshot`. This plan turns that first contract into a product-ready extension system.

---

## 1. Non-negotiable decisions

```text
- Core viewer surface is Raw Logs only.
- Extension authors must not import Zustand stores, app shell components, or log parsing internals directly.
- The public boundary is a versioned SDK protocol. React is part of the v1 render contract, but klogcat host stores/components/utils are not.
- Extension tabs must preserve Raw Logs as the source of truth.
- Host-owned stream lifecycle remains in klogcat core.
- Extensions may read visible/raw rows and operate approved viewer/query actions through SDK calls.
- Unsupported protocol versions fail explicitly before the tab is shown.
```

---

## 2. Protocol v1 contract

The protocol name is fixed:

```text
klogcat.logViewer@1
```

The host must expose these calls:

```ts
type LogViewerExtensionHostApi = {
  protocol: { name: 'klogcat.logViewer'; version: 1 }
  getSnapshot(): LogViewerExtensionSnapshot
  subscribe(listener: (event: LogViewerExtensionChangeEvent) => void): () => void
  grep: {
    setQuery(query: string): void
    setMode(mode: GrepMode): void
  }
  viewer: {
    pause(): void
    resume(): void
    clear(): void
    setAutoScrollEnabled(enabled: boolean): void
  }
  export: {
    rowsAsJsonl(rows?: readonly SdkLogRow[]): string
  }
}
```

The snapshot must remain read-only from the extension author's perspective:

```ts
type LogViewerExtensionSnapshot = {
  rows: readonly SdkLogRow[]
  visibleRows: readonly SdkLogRow[]
  totalRowCount: number
  visibleRowCount: number
  rowLimit: number
  grepQuery: string
  grepMode: GrepMode
  viewerPaused: boolean
  autoScrollEnabled: boolean
  streamStatus: StreamStatus
  selectedTargetCount: number
}
```

`SdkLogRow` is the public DTO. It is adapted from internal parser rows and intentionally excludes host-only fields such as file paths.

Completion gate:

```text
- Type tests prove SDK calls exist and call host actions.
- Registry tests prove only raw is core.
- A sample extension renders from snapshot and uses sdk.export.rowsAsJsonl().
```

---

## 3. Extension registration API

Keep the current minimal registration shape, but harden it into the public SDK surface:

```ts
registerLogViewerExtension({
  id: 'vendor.viewer-name',
  ownerId: 'vendor',
  label: 'Viewer Name',
  description: 'What this viewer does',
  component: ViewerComponent,
  requestedCapabilities: ['logs.read'],
  trustLevel: 'trusted-bundled',
  order: 100,
})
```

Required behavior:

```text
- id must be lowercase and stable.
- core ids are reserved.
- duplicate ids are rejected unless replace=true and ownerId is unchanged.
- returned unregister function removes the tab.
- registry snapshot is immutable.
- AppShell updates when extensions register/unregister at runtime.
```

Completion gate:

```text
- Third-party registration after AppShell mount adds a tab without reload.
- Unregister removes the tab and falls back to Raw Logs if active.
- Duplicate and reserved ids produce actionable errors.
```

---

## 4. Extension loading model

Define two loading levels.

### Level 1: bundled extensions

Bundled extensions are imported at build time and call `registerLogViewerExtension`.

Use this for:

```text
- first-party examples
- company-internal viewers
- tests and documentation
```

Completion gate:

```text
- `src/extensions/examples/failedRequestsExtension.tsx` demonstrates registration without being core.
- The app starts with Raw Logs only unless an extension module is imported.
```

### Level 2: external extension packages

v1 external packages are build-time npm/import dependencies only. Runtime remote loading and arbitrary local plugin directories are out of scope until extension isolation exists.

External packages expose a module entry that exports a manifest and activation function.

Target shape:

```ts
export const klogcatExtension = {
  protocol: { name: 'klogcat.logViewer', version: 1 },
  requestedCapabilities: ['logs.read'],
  trustLevel: 'trusted-bundled',
  activate(host: KlogcatExtensionHost) {
    host.registerLogViewer(...)
  },
}
```

Completion gate:

```text
- Host validates protocol before activation.
- Unsupported protocol version shows a visible extension load error.
- Unknown capabilities are rejected before activation.
- Build-time discovery path is `src/extensions/configuredLogViewerExtensions.ts`.
- Configured modules activate by order, then id.
- Activation failures are collected and later modules continue activating.
- Successful activation cleanup callbacks run in reverse order.
- Package loading path is documented and covered by a fake package test.
```

---

## 5. Host capability boundaries

Add explicit capability groups before exposing more power. Same-context bundled extensions are trusted code; capabilities restrict SDK calls but are not a sandbox.

Initial capabilities:

```text
logs.read
logs.export
grep.write
viewer.control
```

Do not expose to same-context extensions:

```text
stream.start
stream.stop
kube.targets.write
settings.write
filesystem.write
network
shell
```

Untrusted runtime extensions require an isolated iframe/webview/worker host, message-passing SDK broker, stricter CSP, and a separate Tauri capability scope.

Completion gate:

```text
- Extension registration declares requested capabilities.
- Host rejects unknown capabilities.
- SDK object only contains calls allowed by granted capabilities.
- Documentation does not claim same-context capabilities are a security boundary.
```

---

## 6. Developer experience

Provide a real SDK authoring path.

Tasks:

```text
1. Export public SDK types from a stable barrel file.
2. Add a minimal example viewer extension.
3. Add a plugin author guide with copy-pasteable code.
4. Add a test helper for mounting an extension with fake snapshots.
5. Add a compatibility matrix for protocol versions.
```

Completion gate:

```text
- A new viewer can be created by copying one example file.
- Example does not import app stores, host components, host utils, parser internals, or AppShell.
- Typecheck fails if the example uses an unsupported SDK call.
- Lint fails if example extensions import host internals.
```

---

## 7. UI behavior

Required tab behavior:

```text
- Raw Logs is always first.
- Extension tabs sort by order, then label, then id.
- Active extension id persists only after protocol validation is added.
- If active extension unloads, app switches to Raw Logs.
- Extension render failure is isolated to that tab and does not break Raw Logs.
```

Completion gate:

```text
- Error boundary test proves a broken extension renders a tab-local failure state.
- Unregister-active-extension test proves fallback to Raw Logs.
- Tab list is keyboard navigable and exposes selected tabpanel semantics through role=tablist, role=tab, role=tabpanel, aria-controls, and aria-labelledby.
```

---

## 8. Testing and harness

Required tests:

```text
- unit: protocol SDK calls
- unit: registry validation/sorting/unregister
- component: selector renders registered extensions
- scenario: AppShell receives runtime registration
- scenario: extension uses sdk actions to update grep/viewer state
- scenario: active extension unregister falls back to Raw Logs
- scenario: broken extension render is isolated to the active tab panel
- lint: example extensions cannot import host internals
- e2e: product boots with Raw Logs only
- e2e: sample extension appears only when registered
```

Verification commands:

```bash
npm run typecheck
npm run lint
npm run build
npm test
```

Completion gate:

```text
All commands pass in a fresh worktree after npm install.
```

---

## 9. Delivery milestones

### Milestone A: Protocol foundation

```text
- raw-only core registry
- klogcat.logViewer@1 protocol
- sdk/snapshot props
- docs/LOG_VIEWER_EXTENSIONS.md
```

Status: implemented in `work/log-viewer-extensions`.

### Milestone B: Runtime lifecycle hardening

```text
- active tab fallback on unregister
- extension render error boundary
- runtime registration after AppShell mount test
- extension load errors surfaced in UI
```

### Milestone C: Bundled extension example

```text
- move FailedRequestsView behavior into an SDK-only example extension module
- keep component outside core registration and host store access
- add author-facing example tests
```

### Milestone D: External package protocol

```text
- define manifest/activate shape
- protocol version validation
- fake external package activation test
- capability declaration validation
```

### Milestone E: SDK packaging

```text
- stable public type export path
- author guide
- changelog rules for protocol changes
- compatibility matrix
```

---

## 10. Definition of done

The extension system is complete when:

```text
1. Fresh app boot shows only Raw Logs.
2. A third-party viewer can be registered without importing internal stores/components.
3. The viewer receives all data/actions through klogcat.logViewer@1 SDK calls.
4. Unsupported or broken extensions cannot break Raw Logs.
5. Docs include a minimal extension, capability rules, and protocol versioning rules.
6. Typecheck, lint, build, and full test suite pass.
```
