# Last-Hope Incident Persona Pre-Mortem

Date: 2026-06-27

Review target: `docs/plans/log-investigation-workbench-roadmap.md`

## Persona

The user is an on-call backend or platform engineer during a live production
incident. It is 03:17, customer impact is active, normal terminal tailing is too
noisy or too fragmented, centralized observability is unavailable or untrusted,
and klogcat is the last practical tool before rollback, escalation, or blind
guessing.

This persona does not judge the product by feature breadth. They judge it by:

- time to first credible signal
- clarity of the next action
- trust that no important log source is silently missing
- ability to preserve evidence for the incident channel
- ability to keep working when Kubernetes permissions or pod state are imperfect

## Verdict

The roadmap is implementation-ready as a roadmap/RFC gate, and the P0.5
Incident Triage Loop now addresses the original first-five-minutes gap. It is
still not implementation-ready for any slice until the slice RFC carries the
concrete dependency gates, feature flags, rollback behavior, degraded-state
contracts, and verification artifacts required by the roadmap.

The product can claim the log investigation workbench position only after the
P0/P0.5 loop works under the last-hope conditions below and later P1/P2 work
does not dilute or bypass that loop.

## Tigers: Real Risks

### 1. First-five-minutes incident path must stay explicit

Classification: historically launch-blocking; mitigated by the P0.5 Incident
Triage Loop, but still a regression risk

The original roadmap had workload collection, context, filters, analysis tabs,
and exports, but did not define the golden path from app-ready state to first
actionable suspect. P0.5 now addresses that gap; later slices must not scatter
or weaken the path.

Failure mode:

```text
The user selects a workload, sees raw logs, but still has to decide manually
which fields, filters, tabs, events, and exports matter. The product feels like
a better tail viewer, not a last-hope investigation workbench.
```

Mitigation:

- Keep the P0.5 Incident Triage Loop as a protected MVP requirement.
- Define the required path in every affected slice: select target -> validate
  sources -> stream -> show error/slow/restart/event suspects -> copy/share
  summary.
- Keep the hard metric aligned with the roadmap timing boundary: after the app is
  ready and the fixture is deployed/Ready/producing logs, first actionable
  finding appears within 60 seconds.

Owner: PM + engineering

Due: before first workload-follow implementation plan is accepted

### 2. Log source discovery is under-specified

Classification: launch-blocking

The roadmap keeps the file-tail model, but the persona may not know the correct
pod-internal log path, container, or source mapping during an incident.

Failure mode:

```text
The workload is correct, but the file path is wrong or missing. klogcat fails
with a stream error while kubectl logs, sidecar logs, or app-specific files may
contain the needed evidence.
```

Mitigation:

- Define source presets and validation states for common app log paths.
- Add a source validation step before starting a stream group.
- Show per-target file-path existence errors with copyable diagnostics.
- Decide whether source discovery is manual, preset-based, or plugin-provided.

Owner: engineering

Due: before P0 Workload-Aware Log Collection starts

### 3. Analysis tabs are P1, but last-hope value depends on them

Classification: launch-blocking for positioning, fast-follow for platform

Workload follow and context explain where logs come from. They do not explain
what is wrong. For this persona, Failed Requests, Slow Requests, Error Clusters,
and Trace/Transaction View are not nice-to-have tabs. They are the reason to
open the product under pressure.

Failure mode:

```text
klogcat follows the right pods and shows context, but the user still needs to
manually grep, scan, and correlate rows during an outage.
```

Mitigation:

- Promote a minimal Failed Requests and Slow Requests path to P0.5.
- Require bundled analysis tabs to emit `InvestigationFinding` before third
  parties or AI are considered.
- Make findings visible in a shared incident rail, not hidden inside separate
  tabs only.

Owner: PM + frontend + SDK

Due: before public "workbench" positioning

### 4. Permission failures need a repair kit, not only graceful degradation

Classification: launch-blocking

The roadmap has RBAC fallback behavior, which is necessary. But in a last-hope
incident, "events unavailable" or "RBAC denied" is not enough. The user needs to
know exactly what to send to a platform admin or run in the right context.

Failure mode:

```text
The stream works but context/events/workload listing fail. The UI degrades
correctly, yet the user cannot recover the missing signal quickly.
```

Mitigation:

- Add a Permission Repair Kit surface.
- Show exact denied verb/resource/namespace.
- Provide copyable minimum RBAC YAML or kubectl commands.
- Include permission state in export diagnostics.

Owner: engineering + documentation

Due: before live Kubernetes validation is treated as complete

### 5. Hard stream limits can block the user at the worst time

Classification: launch-blocking

The hard limit of 50 streams is reasonable technically, but a production
incident may involve deployments, daemonsets, or label selectors above that
limit.

Failure mode:

```text
The product blocks the selected workload because it resolves to too many pods.
The user is forced back to ad hoc kubectl commands during the incident.
```

Mitigation:

- Add a narrowing workflow when a selector exceeds limits.
- Offer top-N recent restarts, not-ready pods, newest pods, specific node, or
  label refinements.
- Show the blocked pod list and a copyable selector refinement.
- Treat "too many pods" as an investigation path, not only an error state.

Owner: PM + engineering

Due: before hard-limit UX ships

### 6. Incident collaboration artifact is too late

Classification: fast-follow, launch-blocking for serious incident use

The P1 export bundle is strong, but the persona needs a minimal share action as
soon as the product produces a finding.

Failure mode:

```text
The user finds the issue but cannot quickly paste a credible summary into
Slack, Jira, GitHub, or an incident doc without manual copying.
```

Mitigation:

- Add "Copy incident summary" before full export bundle.
- Include target, time window, active filters, top findings, dropped rows,
  permission gaps, and redaction status.
- Keep full export bundle as the richer P1 artifact.

Owner: PM + frontend

Due: with first bundled analysis tab

### 7. Self-diagnostics are not visible enough

Classification: launch-blocking

The roadmap includes stream status, dropped rows, and diagnostics, but the
persona needs continuous confidence that the tool itself is not lying.

Failure mode:

```text
The user sees no errors or few rows and cannot tell whether the service is fine,
the parser failed, the stream dropped rows, the time order is skewed, or a pod
was not tailed.
```

Mitigation:

- Add an always-visible Investigation Health area.
- Show active context, namespace, target count, running/failed streams, parser
  failure count, dropped row count, last row time, and clock skew hints.
- Include a one-click diagnostics export.

Owner: engineering + frontend

Due: before Workbench MVP launch; if Slice A is demoed separately, show at least minimal stream health so users do not mistake missing rows for healthy logs

### 8. AI tab is correctly P2, but trust rules must be visible earlier

Classification: fast-follow

The roadmap handles AI privacy at the protocol level, but if an AI analyzer is
part of the strategic story, users need to understand data boundaries before
they install or run an analyzer.

Failure mode:

```text
The user wants AI help but cannot tell what data will leave the machine, where
the API key lives, or whether raw logs are sent.
```

Mitigation:

- Add a pre-AI trust screen and extension capability summary.
- Support no-network/local-only analyzer states.
- Make redaction preview part of the action, not buried in settings.

Owner: SDK + security + documentation

Due: before any AI analyzer demo is promoted

## Paper Tigers: Overblown Concerns

### "K9s already owns Kubernetes logs"

Not launch-blocking. K9s owns fast cluster operation. klogcat can still win if
it owns local investigation, structured pivots, findings, and evidence bundles.

### "We need hosted log retention to compete"

Not required for this position. The roadmap correctly avoids becoming Loki,
Datadog, or New Relic. Local raw-to-analysis is a valid wedge.

### "The extension ecosystem must exist before bundled tabs"

Overblown. Bundled extensions are the right proof that the SDK is usable.
Third-party adoption should follow a demonstrated first-party pattern.

## Elephants: Under-Discussed Unknowns

### 1. What is the first supported log format?

The roadmap references fields such as status, elapsed, method, URL, rcode,
traceId, and trId. It should define which parser or schema makes the first
analysis tabs credible.

Investigation:

- Choose one canonical sample fixture.
- Define required parsed fields for Failed Requests and Slow Requests.
- Document what happens when rows are unstructured.

### 2. Who configures log source paths in teams?

If every user must know pod-internal paths, adoption will be fragile.

Investigation:

- Validate whether source config belongs in project files, user presets,
  cluster annotations, or extensions.
- Add a default source setup story to onboarding.

### 3. Does the product optimize for single-service incidents or fleet-wide incidents?

The roadmap supports workload and label selectors, but the UX and limits imply
single-service investigation. That is a good starting point, but it must be
explicit.

Investigation:

- State the MVP scale target: one workload/service or one bounded label selector in one namespace at a time.
- Treat fleet-wide or cross-namespace search as out of scope unless backed by indexed storage.

## Required Product Standard for This Persona

The roadmap should not pass last-hope readiness until these are true:

```text
- After the app is ready and the disposable incident fixture is deployed, Ready,
  and producing documented log files, a user can select a workload, validate log
  sources, and see the first failed/slow/error suspect in under 60 seconds.
- If no suspect is found, the UI explains whether that means no matching rows,
  missing parser fields, missing permissions, stream failures, or source-path
  problems.
- Every degraded Kubernetes permission shows exact missing verb/resource/scope
  and a copyable repair request.
- Too-many-pods selectors offer a narrowing path instead of only blocking.
- Findings can be copied into an incident channel with target, time window,
  evidence rows, redaction status, and known blind spots.
- The user can always see whether klogcat is healthy enough to trust the result.
```

## Recommended Roadmap Adjustment

Accepted roadmap adjustment:

```text
P0.5 Incident Triage Loop
```

Scope:

- source discovery/setup baseline and source validation
- first parser/log-schema contract, disposable incident fixture, realistic sample corpus, and degraded/no-finding fixture family
- investigation health panel
- minimal Failed Requests and Slow Requests findings
- finding rail shared by bundled tabs
- copy incident summary with default redaction, no hidden disk write, and recoverable copy/redaction-warning states
- permission repair kit
- selector narrowing for too-many-pods

This slice should be completed before marketing the product as a log
investigation workbench. It remains the protected minimum because without it the
roadmap would be technically coherent but emotionally and operationally weak for
the last-hope user.

Follow-up hardening accepted after independent review:

```text
- P0/P0.5 implementation must not start from this roadmap alone; each slice
  needs an implementation RFC with exact commands, DTOs, feature flags, tests,
  rollout, and rollback.
- The Workbench MVP launch line is P0 Workload Follow + Kubernetes Context MVP
  + P0.5 Incident Triage Loop, not workload following alone.
- Source discovery/setup and the first supported parser/log schema are
  launch-blocking, not optional polish.
- Service-originated incidents require an explicit product decision: unsupported
  with a clear handoff, or supported through a Service target contract.
- Copy incident summary must apply redaction before clipboard write and must not
  silently persist data to disk.
- AI remains optional acceleration; deterministic findings and visible blind
  spots are the trust baseline.
```


## 30-Loop Follow-Up Risks

Thirty independent review passes after the initial premortem found that the
first-five-minutes gap is no longer the only risk. The remaining launch-blocking
risk is **contract ambiguity**: implementation can still be wrong while appearing
to satisfy the roadmap prose.

### A. The file-tail runtime can be unavailable in real containers

Classification: launch-blocking

The product's core collection path depends on `kubectl exec ... -- tail -F`.
Distroless/minimal images, shell-less containers, sidecar-only log paths, missing
files, unreadable files, and completed/terminating pods can all make that path
unavailable without implying the target was wrong.

Mitigation:

- Treat `tail_unavailable`, `shell_unavailable`, `missing_container`,
  `missing_file_path`, `unreadable_file_path`, `permission_denied`,
  `no_rows_yet`, and `command_failed` as distinct states.
- Show container inventory, including regular/init/ephemeral/sidecar-like
  containers, and never silently choose the first container.
- Add live-kube fixtures for missing tail, missing shell, multi-container pods,
  sidecar inclusion/exclusion, and completed/terminating pods.

### B. Evidence can become ambiguous across pod and stream lifecycles

Classification: launch-blocking

Pod names are not stable evidence identities. Pod replacement, container restart,
context/namespace switches, late async responses, stopped streams, dropped rows,
and replay/import can all make a finding point to the wrong row or target.

Mitigation:

- Use pod UID, container identity, stream id, per-stream sequence, row id, and
  stream incarnation in evidence references.
- Make start/stop idempotent and reject stale async responses by operation id and
  target generation.
- Preserve row ids through export/import/replay; stale or missing evidence must
  render as stale/missing, not silently disappear or relink.

### C. Findings can be noisy or falsely reassuring

Classification: launch-blocking

Failed, slow, and error findings require deterministic rules. A no-finding result
is dangerous unless source, stream, parser, permission, dropped-row, and clock
skew health are good enough for the rules being claimed.

Mitigation:

- Define rule ids, fingerprints, thresholds, severity rubric, evidence sampling,
  dedupe, and false-positive/false-negative fixtures.
- Define parser format, timestamp, alias, coercion, malformed-row, multiline, and
  mixed-format behavior.
- Gate `healthy_no_findings` on source/stream/parser/permission/data-loss health.

### D. Release-slice discipline must apply beyond P0.5

Classification: launch-blocking for roadmap execution

P1/P2 slices can break the last-hope loop if they add filters, analysis tabs,
exports, AI, or runtime extensions without the same feature-flag, rollback,
Raw Logs fallback, redaction, SDK, and compatibility discipline.

Mitigation:

- Every Slice C-G RFC inherits the same rollout, rollback, feature-flag,
  expected-red-test, and scope-cut requirements as Slice A/B.
- Cut risky P1/P2 scope before weakening direct pod Raw Logs, source validation,
  first findings, no-finding explanations, permission repair, or redacted copy
  summary.
- Runtime extension and AI claims require real capability isolation, host-mediated
  result channels, redaction preview, secret storage, cancellation, and audit
  metadata before promotion.

### E. Accessibility, localization, and handoff are part of incident trust

Classification: launch-blocking for public workbench positioning

A last-hope incident tool fails if the user cannot complete the path by keyboard,
if screen readers cannot understand stream/finding/degraded state, if Korean and
English copy is unclear, or if the copied summary is not an actionable handoff.

Mitigation:

- Add keyboard-only and screen-reader smoke gates for target picker, stream
  controls, finding drilldown, no-finding card, and copy summary.
- Keep English/Korean incident copy in the i18n catalog and review repair text,
  redaction warnings, no-finding explanations, and handoff summaries.
- Copy summary must include hypothesis, checked areas, open questions, suggested
  next checks, known blind spots, evidence, permission gaps, and redaction state.
