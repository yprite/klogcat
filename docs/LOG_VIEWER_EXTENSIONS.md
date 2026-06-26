# Log Viewer Extensions

Klogcat ships only the `Raw Logs` viewer as a core tab. Every other log viewer tab should be registered through the public log-viewer SDK so third-party code depends on a stable protocol instead of internal stores or components.

The current public SDK boundary is:

```ts
import type { KlogcatExtensionModule, LogViewerExtensionProps } from 'klogcat/sdk/log-viewer'
```

Inside this repository, bundled examples import the same API from `src/sdk/log-viewer`. Extension code must not import `src/stores`, `src/components`, `src/utils`, or `src/types` directly.

## Register a Viewer

```tsx
import type { KlogcatExtensionModule, LogViewerExtensionProps } from 'klogcat/sdk/log-viewer'

function LatencyMapViewer({ sdk, snapshot }: LogViewerExtensionProps) {
  const exportVisibleRows = () => {
    const jsonl = sdk.export.rowsAsJsonl()
    console.info(jsonl)
  }

  return (
    <section>
      <h2>Latency Map</h2>
      <p>Protocol: {sdk.protocol.name}@{sdk.protocol.version}</p>
      <p>Visible rows: {snapshot.visibleRows.length}</p>
      <button type="button" onClick={() => sdk.grep.setQuery('elapsed > 1000')}>Show slow rows</button>
      <button type="button" onClick={exportVisibleRows}>Export visible rows</button>
    </section>
  )
}

export const klogcatExtension: KlogcatExtensionModule = {
  manifest: {
    id: 'vendor.latency-map',
    ownerId: 'vendor',
    protocol: { name: 'klogcat.logViewer', version: 1 },
    label: 'Latency Map',
    description: 'Vendor latency breakdown',
    requestedCapabilities: ['logs.read', 'logs.export', 'grep.write'],
    trustLevel: 'trusted-bundled',
  },
  activate(host) {
    return host.registerLogViewer({
      id: 'vendor.latency-map',
      ownerId: 'vendor',
      label: 'Latency Map',
      description: 'Vendor latency breakdown',
      component: LatencyMapViewer,
      requestedCapabilities: ['logs.read', 'logs.export', 'grep.write'],
      trustLevel: 'trusted-bundled',
      order: 100,
    })
  },
}
```

The `id` and `ownerId` must be lowercase and may contain numbers, dots, or hyphens. Core ids such as `raw` are reserved. Duplicate third-party ids are rejected unless registration passes `{ replace: true }` from the same `ownerId`.

## Protocol

The current protocol is `klogcat.logViewer@1`. The React component contract is part of v1: extensions render a React component that receives `sdk` and `snapshot`. React itself is a peer dependency of bundled extension code; klogcat host internals are not.

Each extension receives:

- `snapshot`: current SDK rows, visible SDK rows, grep state, pause/autoscroll state, stream status, selected target count, and host row limit.
- `sdk.getSnapshot()`: pull the latest snapshot outside a React render.
- `sdk.subscribe(listener)`: listen for full-snapshot invalidation events with reason `log-state` or `target-state`.
- `sdk.grep.setQuery()` and `sdk.grep.setMode()`: update the shared query controls.
- `sdk.viewer.pause()`, `sdk.viewer.resume()`, `sdk.viewer.clear()`, and `sdk.viewer.setAutoScrollEnabled()`: operate on the shared viewer state.
- `sdk.export.rowsAsJsonl()`: export rows without depending on internal utilities.

Extensions can render their own layout while preserving the existing raw log stream and filters as the source of truth.

## Data Contract

Extensions receive `SdkLogRow`, not klogcat's internal parser row. The host adapts internal rows to this DTO and omits file paths and other host-only fields from the public SDK contract.

Important fields:

- `raw`, `summary`, `sourceType`, `parseStatus`, `receivedAt`
- `target.context`, `target.namespace`, `target.pod`, `target.container`
- `correlationIds.trId`, `correlationIds.traceId`
- `request.method`, `request.url`, `request.status`, `request.elapsed`
- `error.method`, `error.path`, `error.reason`
- `fields`: documented scalar public fields for custom viewers

## Capabilities and Trust

Bundled extensions currently run in the same JavaScript context as klogcat, so they are treated as trusted code. Capabilities limit the SDK methods the host provides, but they are not a security sandbox.

Supported v1 capabilities:

- `logs.read`
- `logs.export`
- `grep.write`
- `viewer.control`

Untrusted runtime extensions require a future isolated host using iframe/webview/worker message passing, stricter CSP, and a separate Tauri capability scope. They must not be loaded as same-context bundled code.

## Loading Model

v1 supports build-time imported extension modules. A module exports a manifest and `activate(host)` function. The host validates `klogcat.logViewer@1`, trust level, and requested capabilities before activation.

Configured build-time modules are discovered through:

```ts
// src/extensions/configuredLogViewerExtensions.ts
import { klogcatExtension as latency } from 'vendor-klogcat-latency'

export const configuredLogViewerExtensions = [
  { module: latency, order: 100 },
]
```

Activation rules:

- Modules sort by `order`, then manifest `id`.
- A failing module records an extension load error and does not prevent later modules from activating.
- Successful activations return cleanup callbacks; cleanup runs in reverse activation order.
- The app surfaces activation failures through the existing error banner.

Runtime remote loading and arbitrary local plugin directories are out of scope until isolation exists.
