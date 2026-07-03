# klogcat plugin model

klogcat separates plugin policy into two platform-level kinds:

- `target`: discovers or selects log targets, such as Kubernetes pods or AWS VMs.
- `viewer`: renders or analyzes log rows, such as Raw Logs or request-focused viewers.

Target plugins register through `targetPluginRegistry.ts`.
Each target plugin owns:

- a manifest with `kind: 'target'`
- a settings key under `settings.plugins.targets`
- a runtime target kind used by stream requests
- default settings
- validation policy
- enabled policy

Viewer plugins are existing log viewer extensions.
`pluginRegistry.ts` exposes them as `kind: 'viewer'` manifests so UI, settings, and future plugin management can reason about target and viewer plugins uniformly.

Current core plugins:

- `target`: `aws-vm`
- `viewer`: `raw`
