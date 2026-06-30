# klogcat documentation index

This is the first documentation file every agent should read.
Do not open every document by default. Use this index to choose the minimum document set for the task.

## Agent reading protocol

1. Read `AGENTS.md`.
2. Read this file.
3. Pick only the documents required by the task from the routing table below.
4. If the task changes scope, return to this index before opening more documents.
5. When adding, moving, or deleting a document under `docs/`, update this index in the same change.

## Task routing

| Task | Read first | Then read only if needed |
| --- | --- | --- |
| Product identity, current product contract, non-goals | `docs/DESIGN.md` | `docs/DESIGN_REVIEW_FOR_IMPLEMENTATION.md` |
| Plugin platform, target plugins, viewer plugins, platform completion gates | `docs/plugin-platform-todo.md` | `docs/LOG_VIEWER_EXTENSIONS.md` |
| Viewer extension SDK or third-party viewer work | `docs/LOG_VIEWER_EXTENSIONS.md` | `docs/plugin-platform-todo.md` |
| Local install, packaging, user setup | `docs/INSTALL.md` | `docs/SMOKE_TEST.md` |
| Hook harnesses, pre-commit/pre-push gates | `docs/HARNESS_GATES.md` | `scripts/harness/*` |
| Manual desktop smoke testing | `docs/SMOKE_TEST.md` | `docs/testing/live-kubernetes.md` |
| Live Kubernetes harness or real cluster smoke checks | `docs/testing/live-kubernetes.md` | `docs/SMOKE_TEST.md` |
| Log investigation workbench roadmap | `docs/plans/log-investigation-workbench-roadmap.md` | `docs/plans/log-investigation-workbench-last-hope-premortem.md` |
| Incident persona, last-hope workflow review | `docs/plans/log-investigation-workbench-last-hope-premortem.md` | `docs/plans/log-investigation-workbench-roadmap.md` |
| Demo media or visual asset references | `docs/assets/klogcat-demo.mp4` | `docs/SMOKE_TEST.md` |

## Canonical documents

### Architecture and product contract

- `docs/DESIGN.md`
  - Current shipped product definition and non-goals.
  - Use when changing core logging behavior, source types, grep/filter behavior, or app scope.
- `docs/DESIGN_REVIEW_FOR_IMPLEMENTATION.md`
  - Implementation-readiness review of the original design.
  - Use when converting product design into implementation tasks or checking missing contracts.

### Plugin platform

- `docs/plugin-platform-todo.md`
  - Measurable todo list, acceptance gates, and harness mapping for target/viewer plugin platform work.
  - Use before changing `src/plugins`, target selection plugins, viewer plugin manifests, or SDK plugin identity.
- `docs/LOG_VIEWER_EXTENSIONS.md`
  - Public log-viewer SDK and extension registration contract.
  - Use before changing `src/sdk/log-viewer.ts`, `src/extensions/*`, or bundled viewer examples.

### Install and smoke testing

- `docs/INSTALL.md`
  - User-facing install prerequisites and platform setup.
  - Use before changing package/install scripts or Tauri build setup.
- `docs/SMOKE_TEST.md`
  - Manual smoke test checklist for the desktop app.
  - Use before release checks or manual verification flows.
- `docs/testing/live-kubernetes.md`
  - Opt-in live Kubernetes smoke harness documentation.
  - Use before changing `npm run test:kube:live` behavior or live cluster assumptions.

### Harnesses and gates

- `docs/HARNESS_GATES.md`
  - Local hook gate definitions for pre-commit and pre-push.
  - Use before changing scripts under `scripts/harness` or hook behavior.

### Roadmaps and plans

- `docs/plans/log-investigation-workbench-roadmap.md`
  - vNext product roadmap for investigation workbench positioning.
  - Use for roadmap, product strategy, or incident workflow feature planning.
- `docs/plans/log-investigation-workbench-last-hope-premortem.md`
  - Persona-driven pre-mortem for incident readiness.
  - Use when judging whether a workflow is useful during active incidents.

### Assets

- `docs/assets/klogcat-demo.mp4`
  - Demo media asset.
  - Use only when a task explicitly references demo media or visual artifacts.

## Required maintenance checks

Run this after adding, moving, or deleting docs:

```bash
npm run test:docs-index
```

Expected result:

```text
docs-index-contract: all docs indexed
```
