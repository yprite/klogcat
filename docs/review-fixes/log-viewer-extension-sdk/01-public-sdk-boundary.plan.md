# 01 Public SDK Boundary Plan

Reviewer finding: the plan called this a stable SDK while examples imported internal paths and the render contract was React-coupled but not declared.

Plan:
- Create a stable public SDK boundary at `src/sdk/log-viewer.ts`.
- Expose SDK protocol, DTO, capability, manifest, host, and React component prop types from that boundary.
- Document React as the v1 render contract and clarify that host internals are not part of the SDK.
- Stop author-facing docs from importing `src/extensions` or other host internals.

Completion gate:
- `docs/LOG_VIEWER_EXTENSIONS.md` uses `klogcat/sdk/log-viewer`.
- `package.json` exposes `./sdk/log-viewer`.
- Extension code can type against SDK exports without importing stores/components/utils/types.
