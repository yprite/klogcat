# Log Investigation Workbench Roadmap Implementation Status

Branch: `feat/log-investigation-mvp`

This document tracks the current implementation pass against the roadmap slices.

## Implemented in this pass

- Slice A Workload Follow MVP foundation
  - workbench feature flags and settings validation
  - target mode contract for `pod`, `workload`, and `labelSelector`
  - `matchLabels` workload selector serialization
  - `matchExpressions` rejected as `unsupported_selector`
  - Service target Option A handoff as `unsupported_service_target`
  - resolved stream target DTOs with stream identity fields
  - source validation state for missing container
  - hard/soft stream-target limit enforcement and narrowing hints
  - Target Picker workload quick-select and bounded label selector form wired to selected pods
  - Tauri pod discovery now serializes `metadata.labels` so real cluster label selection can match loaded pods

- Slice A2 Kubernetes Context MVP foundation
  - normalized `KubernetesContextSnapshot`
  - copyable `DiagnosticCommand` rendered from structured argv
  - no raw Kubernetes JSON in the normalized snapshot
  - visible Kubernetes context toolbar panel with copyable pod/events commands

- Slice B Incident Triage Loop foundation
  - failed request and slow request findings
  - `EvidenceRef` row/stream/source identity
  - canonical `durationMs`
  - parser-field blind-spot no-finding explanation
  - redacted copy summary helper
  - visible incident triage toolbar panel with finding count, blind spots, and clipboard copy status

- Slice C Investigation Filters MVP foundation
  - facet counts from filtered row base

- Slice D First Analysis Tabs foundation
  - failed request rows/findings
  - slow request rows/findings and p50/p95/p99 calculation

- Slice E Investigation Bundle foundation
  - notes/bookmark-style row references
  - redacted bundle rows
  - shareable markdown summary

- Slice F AI Analyzer Readiness foundation
  - selected-row-only redacted AI request
  - async request state starts as queued
  - AI finding evidence row validation

- Slice G Third-Party Runtime Extensions foundation
  - runtime extension manifest validation
  - unsupported protocol rejection before execution

## Productization gates closed in this pass

- Target Picker workload/label selector controls are wired into the existing selected-pod flow.
- Pod-backed workload/label-selector selection feeds the existing Start/Stop stream flow; no parallel workload command path is required for this MVP.
- Product e2e now covers label selector selection, multi-pod stream requests, hard-limit fanout blocking with narrowing hints, runtime extension failure isolation, Kubernetes context command copy, incident triage summary copy, failed-request tab navigation, and stream cleanup.
- Tauri/Rust pod discovery serializes `metadata.labels`; the existing live-kube smoke harness provides opt-in read-only cluster validation with explicit skip diagnostics when not enabled.
- User-facing screenshots are captured in the PR comments for the completed UI flows.

## Verification commands

- `npm test -- --run src/__tests__/workbenchFeatureFlags.test.ts src/__tests__/workloadTarget.test.ts src/__tests__/streamTargets.test.ts src/__tests__/kubernetesContext.test.ts src/__tests__/incidentTriage.test.ts src/__tests__/roadmapWorkbenchContracts.test.ts src/__tests__/settings.test.ts src/__tests__/AppShellTargetPicker.test.tsx src/__tests__/IncidentTriagePanel.test.tsx src/__tests__/KubernetesContextPanel.test.tsx e2e/productQuality.e2e.test.tsx` (42 focused product/unit tests)
- `npm run test:e2e` (product e2e + browser e2e + desktop e2e)
- `npm run test:kube:live` (expected local default: diagnostic skip unless `KLOGCAT_LIVE_KUBE=1`)
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `git diff --check`
