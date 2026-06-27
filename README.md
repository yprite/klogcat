# klogcat

klogcat is a desktop log viewer for Kubernetes pod log files. It gives you a
focused, local-first UI for selecting Kubernetes targets, streaming log files
through `kubectl exec tail -F`, filtering raw output, and building specialized
viewer tabs through a small public extension protocol.

The app is built with Tauri, React, TypeScript, Rust, and Vite.

## Why klogcat?

Kubernetes logs are often easy to tail and hard to investigate. `kubectl logs`
and ad-hoc terminal filters work well for a single stream, but become awkward
when you need repeatable target selection, fast local filtering, multi-source
inspection, and domain-specific views over the same raw data.

klogcat keeps the core product narrow:

- Raw log streaming stays the source of truth.
- Kubernetes target selection is handled in the app instead of shell history.
- Log filtering, pause, clear, copy, and export are first-class UI actions.
- Non-core investigation views are added through the log-viewer extension SDK.
- Local quality gates are treated as the release gate, not as optional cleanup.

## Features

- Tail pod file logs through `kubectl exec ... tail -F`.
- Select Kubernetes context, namespace, pod, container, source type, and file
  path from the desktop UI.
- Stream multiple selected targets into a single ordered viewer.
- Filter with the shared grep/query controls.
- Pause, resume, clear, copy, and export visible rows.
- Keep only a bounded in-memory row buffer for large log streams.
- Use the public `klogcat.logViewer@1` SDK to register third-party viewer tabs.
- Run deterministic unit, scenario, stress, browser e2e, and Tauri gates before
  push.

## Demo

The demo below is recorded from the deterministic browser e2e harness. It shows
the app running with a mock log stream, visible raw rows, and query filtering.

<video src="docs/assets/klogcat-demo.webm" controls muted width="100%"></video>

If your Markdown renderer does not play embedded WebM, open
[docs/assets/klogcat-demo.webm](docs/assets/klogcat-demo.webm).

## Requirements

Runtime:

- `kubectl`
- Access to the Kubernetes context and namespace you want to inspect

Development and local builds:

- Node.js and npm
- Rust and Cargo
- Tauri platform dependencies

For OS-specific native dependencies, see [docs/INSTALL.md](docs/INSTALL.md).

## Install

### Option A: install from GitHub

```bash
npm install -g git+ssh://git@github.com/yprite/klogcat.git
klogcat
```

The first launch builds the native Tauri binary locally. The launcher checks
for `src-tauri/target/release/klogcat` and runs this command when the binary is
missing:

```bash
npm run tauri build -- --no-bundle
```

### Option B: clone and run

```bash
git clone git@github.com:yprite/klogcat.git
cd klogcat
npm install
npm run klogcat:build
npm start
```

### Option C: development mode

```bash
npm install
npm run klogcat:dev
```

## CLI

The npm package exposes a `klogcat` launcher:

```bash
klogcat                # build if needed, then launch
klogcat --build-only   # build the Tauri binary and exit
klogcat --force-build  # rebuild before launch
klogcat --dev          # run Tauri dev mode
klogcat --no-build     # launch the existing binary only
klogcat --debug        # print stream diagnostics to the terminal
klogcat --help         # show dependency and build notes
```

## Using the App

1. Open klogcat.
2. Choose a Kubernetes target: context, namespace, pod, container, source type,
   and file path.
3. Press Start.
4. Use grep/query controls to narrow the visible rows.
5. Pause, copy, export, or clear the viewer as needed.

If a stream does not start, launch with diagnostics:

```bash
klogcat --debug
```

The terminal prints the generated `kubectl exec` command, received stdout
lines, stderr, and stream exit status. You can run the same command manually:

```bash
kubectl exec -n <namespace> <pod> -c <container> -- tail -n <lines> -F <filePath>
```

Common causes of empty streams:

- The selected pod is not `Running`.
- The selected container is not present in the pod.
- The configured file path does not exist inside the container.
- The current `kubectl` context or permissions are not what you expect.
- The viewer is paused or the active filter hides incoming rows.

## Log Viewer Extensions

klogcat ships `Raw Logs` as the core viewer. Other tabs should be added through
the public log-viewer SDK instead of importing internal stores, components, or
utilities.

Current protocol:

```ts
import type {
  KlogcatExtensionModule,
  LogViewerExtensionProps,
} from 'klogcat/sdk/log-viewer'
```

A minimal extension module looks like this:

```tsx
import type {
  KlogcatExtensionModule,
  LogViewerExtensionProps,
} from 'klogcat/sdk/log-viewer'

function SlowRequests({ sdk, snapshot }: LogViewerExtensionProps) {
  return (
    <section>
      <h2>Slow Requests</h2>
      <p>Visible rows: {snapshot.visibleRows.length}</p>
      <button type="button" onClick={() => sdk.grep.setQuery('elapsed > 1000')}>
        Show slow rows
      </button>
    </section>
  )
}

export const klogcatExtension: KlogcatExtensionModule = {
  manifest: {
    id: 'vendor.slow-requests',
    ownerId: 'vendor',
    protocol: { name: 'klogcat.logViewer', version: 1 },
    label: 'Slow Requests',
    requestedCapabilities: ['logs.read', 'grep.write'],
    trustLevel: 'trusted-bundled',
  },
  activate(host) {
    return host.registerLogViewer({
      id: 'vendor.slow-requests',
      ownerId: 'vendor',
      label: 'Slow Requests',
      component: SlowRequests,
      requestedCapabilities: ['logs.read', 'grep.write'],
      trustLevel: 'trusted-bundled',
      order: 100,
    })
  },
}
```

The v1 extension model is build-time registration for trusted bundled modules.
Runtime loading of arbitrary local or remote plugins is intentionally out of
scope until an isolated host is added.

Read the full SDK contract in
[docs/LOG_VIEWER_EXTENSIONS.md](docs/LOG_VIEWER_EXTENSIONS.md).

## Development

```bash
npm install
npm run typecheck
npm run lint
npm run test:unit
npm run test:scenario
npm run test:stress
npm run test:e2e
npm run build
```

Native checks:

```bash
cd src-tauri
cargo fmt -- --check
cargo clippy --all-targets -- -D warnings
cargo test --all-targets
```

## Test Harness

klogcat uses local Git hook harnesses as the authoritative quality gate:

- `npm run harness:precommit` for fast commit-time checks.
- `npm run harness:prepush` for the full release gate.
- `npm run push -- origin <branch>` for policy-compliant pushes.

The pre-push gate covers TypeScript, ESLint, coverage, unit tests, scenario
tests, stress tests, e2e tests, security/license checks, frontend build, Rust
formatting, Rust linting, Rust tests, and a Tauri no-bundle build.

See [docs/HARNESS_GATES.md](docs/HARNESS_GATES.md) for the exact pass/fail
criteria.

## Live Kubernetes E2E

The default e2e suite is deterministic and does not require a cluster. To test
the real pod-file stream path, opt in explicitly:

```bash
KLOGCAT_LIVE_KUBECTL_E2E=1 npm run test:e2e:live-kubectl
```

This harness creates and deletes Kubernetes resources in the selected
context/namespace. Run it only against a disposable namespace or cluster.

Useful options:

```bash
KLOGCAT_LIVE_CONTEXT=<context>
KLOGCAT_LIVE_NAMESPACE=klogcat-e2e
KLOGCAT_LIVE_POD=<unique-pod-name>
KLOGCAT_LIVE_CONTAINER=app
KLOGCAT_LIVE_IMAGE=alpine:3.20
KLOGCAT_LIVE_LOG_PATH=/tmp/klogcat-live-e2e/INFO.log
KLOGCAT_LIVE_KEEP=1
KLOGCAT_LIVE_DRY_RUN=1
```

## Project Layout

```text
bin/                    npm launcher
docs/                   installation, design, extension, and harness docs
e2e/                    browser product e2e tests
scripts/harness/        local quality gate implementation
src/                    React app, stores, SDK, extensions, tests
src-tauri/              Rust/Tauri shell and native commands
```

## Contributing

1. Create a branch or worktree from `origin/main`.
2. Keep changes scoped and follow the existing project structure.
3. Add or update tests for behavior changes.
4. Run the relevant local gates.
5. Use `npm run push -- <remote> <branch>` instead of bypassing hooks.

AI agents working in this repository must follow the worktree rule in
[AGENTS.md](AGENTS.md).

## Release Notes

See [RELEASE_NOTES.md](RELEASE_NOTES.md).

## License

This repository is currently marked `UNLICENSED` in `package.json`. Choose and
commit an open-source license before publishing it as an open-source project.
