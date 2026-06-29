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

## Remaining productization work

These contracts are implemented and tested at the utility/data layer. Remaining work before calling the full product done:

- Wire workload/label selector controls into `TargetPickerDialog`.
  - Status: workload group quick-select and bounded `key=value` label selector form are wired for loaded running pods.
- Wire resolved stream groups into the existing Start/Stop UI flow.
  - Status: pod-backed workload/label-selector quick-select feeds the existing selected pod flow; direct workload command resolution is still pending.
- Add browser e2e coverage for target picker, stream limits, incident start path, copy summary, and runtime extension failure isolation.
- Add Tauri/Rust command implementations for workload listing and pod context/events if not already present.
- Add disposable live-kube fixtures for Slice A/A2/B acceptance.
- Add user-facing docs and screenshots/videos for the completed UI flows.

## Verification commands

- `npm test -- --run src/__tests__/workbenchFeatureFlags.test.ts src/__tests__/workloadTarget.test.ts src/__tests__/streamTargets.test.ts src/__tests__/kubernetesContext.test.ts src/__tests__/incidentTriage.test.ts src/__tests__/roadmapWorkbenchContracts.test.ts src/__tests__/settings.test.ts src/__tests__/AppShellTargetPicker.test.tsx src/__tests__/IncidentTriagePanel.test.tsx src/__tests__/KubernetesContextPanel.test.tsx`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `git diff --check`
