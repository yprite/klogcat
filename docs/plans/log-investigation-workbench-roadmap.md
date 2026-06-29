# Log Investigation Workbench Roadmap

**Goal:** Make klogcat a Kubernetes log investigation workbench, not a broad
cluster manager and not only a prettier `tail -F` viewer.

**Position:** klogcat complements tools such as K9s, Lens, Stern, Kubetail,
Grafana Loki, and Datadog. Those tools either manage Kubernetes resources,
aggregate logs centrally, or tail many pods well. klogcat should win the local
investigation loop after a service, workload, pod, or incident has been
identified.

**End image:** An engineer can select a workload, validate the log sources,
stream the relevant pod file logs, follow pod replacements, see the first
failed/slow/error suspects in under 60 seconds after the app is ready and the
incident fixture is deployed/Ready/producing logs, preserve evidence, and share
a redacted incident summary. Third-party extensions can add domain-specific or
AI analysis without depending on klogcat internals.

**Last-hope persona:** The product must work for an on-call engineer during an
active production incident, when normal terminal tailing is too noisy or too
fragmented and klogcat is the last practical tool before rollback, escalation,
or blind guessing. This persona judges the product by time to first credible
signal, clarity of next action, trust that no source is silently missing, and
ability to preserve evidence.

Related review: `docs/plans/log-investigation-workbench-last-hope-premortem.md`
captures the persona-driven pre-mortem that produced the P0.5 requirements.

**Implementation-readiness verdict:** This roadmap is a vNext product plan, not
yet an implementation specification. A slice is not ready to build until it
passes the readiness gates in this document.

---

## 0. Supersedes and Compatibility

`docs/DESIGN.md` remains the source of truth for the current shipped product
contract:

```text
- klogcat tails pod-internal APP/ACC/ERR files through kubectl exec tail -F.
- Raw Logs is the source of truth.
- The current product is not a kubectl logs stdout viewer.
- The current product does not expose a structured query language or AI analysis.
```

This roadmap is a **vNext RFC**. It may propose changes that supersede the old
v0.1/v0.2 constraints, but every implementation slice must explicitly state:

```text
1. Which current DESIGN.md rule it preserves.
2. Which current DESIGN.md rule it intentionally supersedes.
3. Which migration or compatibility behavior keeps existing Raw Logs workflows
   working.
4. Which SDK protocol version is required if extension-visible contracts change.
```

Hard rule:

```text
No implementation may use this roadmap alone as the engineering spec. Each
slice needs a slice RFC or implementation plan that passes the readiness gates
below before code changes start.
```

### Workbench MVP Launch Criteria

The product must not be marketed as a Kubernetes log investigation workbench
until all of these are true:

```text
- Slice A Workload Follow MVP is complete.
- A Kubernetes Context MVP is complete or explicitly included in Slice A/B.
- Slice B Incident Triage Loop is complete.
- The first source discovery/setup mechanism is specified and implemented.
- The first supported parser/log-schema contract is specified and covered by an
  incident fixture plus at least one realistic sample corpus that was not
  authored solely for the happy path.
- After the app is ready and the disposable incident fixture is deployed, Ready,
  and producing documented log files, a user can reach the first
  failed/slow/error finding in under 60 seconds through both product e2e and
  live-kube validation.
- Degraded/no-finding fixture families prove missing source, missing parser
  fields, permission gaps, stream failures, no matching rows, and healthy logs
  are distinguishable before launch.
- Copy incident summary works with default redaction and no hidden disk write.
- Permission repair text is copyable for every degraded Kubernetes permission
  that blocks a P0/P0.5 path.
- Direct pod Raw Logs remains intact as the source-of-truth fallback.
- The file-tail runtime prerequisite is documented and validated: target
  containers support `kubectl exec` plus readable `tail -F`, or the UI shows a
  specific tail/runtime diagnostic instead of a generic command failure.
- The launch-trust minimum is met: license, checksumed release, HTTPS install
  path, supported OS/kubectl/Kubernetes matrix, and privacy/security statement.
```

P1 analysis tabs, full export bundles, runtime extensions, and AI analyzers can
make the product more compelling, but they do not substitute for this minimum
last-hope incident loop. Workbench MVP optimizes for one direct pod, one workload, or one bounded
label selector in one namespace at a time. Service-originated incidents are
accepted only as clues unless the separate Service target Option B RFC is
accepted and implemented; fleet-wide indexed search and cross-namespace
incident search are out of scope until backed by a separate storage/search RFC.


### Consolidated Hardening from 30-Loop Review

A 30-pass independent review found that the roadmap is strong enough as a
product direction, but Slice A/B must not start until these invariants are made
explicit in the slice RFCs or accepted as deliberate cuts.

#### Launch and timing invariants

```text
- The 60-second first-finding metric starts when the desktop app is ready for
  input and the disposable incident fixture is already deployed, Ready, and
  producing the documented APP/ACC/ERR file logs. Fixture creation, image pull,
  namespace creation/deletion, cluster scheduling latency, and app startup are
  recorded separately and do not count toward the 60-second product triage
  budget.
- "First failed/slow/error suspect" means failed or slow request findings plus
  an explicitly supported error-classified finding family. If Slice B does not
  implement a third error-family rule, launch copy and acceptance criteria must
  say "failed or slow" rather than implying a separate error analyzer exists.
- Every launch-blocking criterion must have an evidence artifact: CI run, live
  kube run, fixture manifest, screenshot/video, checksumed release artifact,
  or docs PR. Missing evidence is a blocked launch row, not an implicit waiver.
```

#### Concrete Slice A/B decisions before implementation

```text
- Slice A uses `TargetMode = 'pod' | 'workload' | 'labelSelector'`. Service
  targets are out of scope unless a separate Option B RFC is accepted. A Service
  pasted into the target picker shows `unsupported_service_target` and suggests
  the owning workload or label selector. `serviceGet` must not be a baseline
  PermissionFeature unless service targets are accepted.
- Current persisted source keys are `SourceLogType = 'info' | 'access' | 'error'`.
  Slice A/B must preserve these keys and map display labels separately; do not
  introduce a persisted `app` key without a migration and SDK compatibility plan.
- Slice B's first source setup mechanism is the existing persisted settings/log
  policy path, starting with the built-in `scloud` policy. Repo/workspace
  defaults, cluster annotations, extension-provided presets, and automatic
  discovery are out of scope until their trust, precedence, and migration rules
  are specified.
- Initial feature flags are named and default off outside development:
  `workbench.workloadFollow.enabled`, `workbench.kubernetesContext.enabled`, and
  `workbench.incidentTriage.enabled`.
```

#### Kubernetes command, RBAC, and source-collection invariants

```text
- Every Kubernetes command for a selected target must pass `--context <context>`
  and every namespaced command must pass `-n <namespace>`; never rely on the
  mutable kubeconfig current context or namespace after target selection.
- `kubectl` must be spawned with structured argv. No shell-concatenated command
  strings for context, namespace, pod, selector, container, file path, repair
  text, or diagnostic commands.
- `tail -F` is a container-side runtime prerequisite. Missing or unusable tail,
  missing shell for shell-based probes, missing container, missing file path,
  unreadable file path, permission denied, no rows yet, parser mismatch, and
  generic command failure are distinct SourceValidationState outcomes.
- Multi-container pods must not silently default to the first container or all
  containers. Regular, init, ephemeral, and sidecar-like containers are shown
  separately. Init/ephemeral containers are context by default, not auto-tailed.
- Stream limits are based on resolved stream targets, not pod count:
  pods × selected containers × selected source families/file paths.
- RBAC diagnostics must run scope-correct `kubectl auth can-i` preflights where
  possible and still record attempted command failures. Namespace list denied
  must allow manual/recent namespace entry when namespace-scoped pod access is
  otherwise valid.
- Repair text must be scope-correct: Role/RoleBinding for namespace gaps,
  ClusterRole/ClusterRoleBinding for cluster gaps, never cluster-admin or
  wildcard permissions. Events API group and subresources must match the actual
  command used.
```

#### Stream identity, lifecycle, and data-loss invariants

```text
- Stream identity is not pod name alone. Targets and rows must carry context,
  namespace, pod name, pod UID, container, source type, file path, stream id,
  per-stream sequence, and stream incarnation/restart information.
- Pod replacement, terminating pods, completed pods, container restartCount or
  containerID changes, context/namespace unavailability, and user stop produce
  explicit end reasons. Old stream segments remain visible; replacement streams
  get new stream ids.
- Start and Stop are idempotent. A second Start while starting/running cannot
  spawn duplicate tails. Stop during Start either cancels before spawn or stops
  immediately after spawn. No rows may append after a terminal state.
- Every long-lived process, poller, watcher, Tauri subscription, extension
  subscription, timer, export, AI request, and analysis run has an owner,
  cancellation path, stale-response rule, and cleanup verification.
- Async operations carry operationId plus investigationId/targetGeneration.
  Superseded target/source/filter/extension/AI results are ignored or rendered
  only as stale evidence, never merged into the current investigation.
- Buffering policies must define row capacity, memory ceiling, oversize row
  handling, drop policy, dropped-row reasons, and incident-summary blind spots.
  Dropped, truncated, late, skewed, parser-error, and stream-gap rows cannot
  result in a healthy no-finding claim.
```

#### Row identity, evidence, parser, and finding correctness

```text
- `rowId` is stable within a session/export/import/replay and is preserved
  verbatim. Imported rows must not receive new row ids. Findings, summaries,
  bookmarks, exports, AI, and extensions use EvidenceRef objects, not bare row
  ids alone, when persistence or handoff is involved.
- PermissionGap has a stable id because health, summaries, and no-finding
  explanations reference permission gap ids. PermissionGap.id is stable for the
  same context, namespace, feature, apiGroup, resource, subresource, verb, and
  resourceName within an investigation/export/import replay.
- Parser contracts define supported formats: JSONL, text-prefix, multiline, or
  mixed. They also define timestamp fields/formats/timezone behavior, alias
  precedence, numeric coercion, malformed-row diagnostics, multiline framing,
  and mixed-format behavior.
- `healthy_no_findings` is allowed only when sources, streams, parser fields,
  permissions, dropped-row rates, and clock skew are healthy enough for the
  relevant rule. Empty streams use `no_rows_yet` or the source validation
  state, not healthy.
- Failed Requests, Slow Requests, and any Error Events family must have rule ids,
  fingerprints, severity rubric, evidence thresholds, false-positive/negative
  fixtures, boundary cases, dedupe behavior, and exact expected/no-extra finding
  assertions.
```

#### Search, filters, facets, and SDK consistency

```text
- Existing grep substring/regex mode remains separate from structured filters.
  Structured filters do not support regex unless a slice RFC explicitly adds it.
- Filters use draft vs committed state. Invalid structured filters keep the last
  committed result set and do not recompute facets, findings, exports, or SDK
  snapshots from the rejected query.
- Numeric comparisons match only normalized numeric fields. Numeric-looking
  strings are not coerced unless the parser contract normalizes that field.
- Time windows define inclusivity, parsedTimestamp vs receivedAt fallback,
  moving vs pinned behavior, and shared DTOs consumed by UI, facets, findings,
  export, and SDK snapshots.
- Facets and grouping define cardinality caps, missing buckets, OR-within-facet
  and AND-across-facets semantics, sort order, representative rows, and SDK
  snapshot behavior.
- Before Slice C/D, the current `klogcat.logViewer@1` SDK row shape must be
  reconciled with `ParsedLogRow`: either a documented adapter keeps v1 stable or
  a `klogcat.logViewer@2` protocol is introduced.
```

#### Privacy, export, extension, and launch-trust gates

```text
- Redaction applies to raw original text, parsed/original fields, notes,
  findings, Kubernetes events/metadata, diagnostic stderr, repair commands,
  extension outputs, exports, clipboard, and AI/network payloads. Redaction
  failure blocks clipboard/export/network unless an explicit user-confirmed
  override flow is defined.
- Copy incident summary opens a visible redacted preview before clipboard write,
  includes current hypothesis, checked areas, open questions, suggested next
  checks, blind spots, permission gaps, redaction status, and no hidden disk
  write.
- Export/import/persistence use versioned envelopes, JSON schemas, checksums,
  size limits, unsupported-version handling, rollback behavior, and read-only
  replay semantics. Corrupt Workbench state must not block direct pod Raw Logs.
- SDK/runtime extension capabilities are deny-by-default. Bundled extensions use
  only the public SDK and trusted-bundled trust level. `isolated-runtime` is
  rejected until a real isolated host exists. Findings emitted by extensions use
  a host-mediated result channel with host-owned ids, stale-evidence validation,
  cleanup, and export inclusion rules.
- Public launch requires license, privacy statement, HTTPS install path,
  supported OS/kubectl/Kubernetes matrix, signed/notarized or clearly unsigned
  macOS packaging policy, release checksums, and a runnable command gate whose
  shell snippets cannot fail due to `cd src-tauri` nesting.
```

#### Accessibility, i18n, and incident workflow gates

```text
- The first-five-minutes path has an Incident Mode / Start triage entry point,
  accepts common alert clues where supported, and always shows the next action
  for findings, no-finding states, permission gaps, source problems, and partial
  results.
- Keyboard-only users can complete target selection, source validation, stream
  start/stop, finding evidence drilldown, no-finding review, and copy summary.
- Screen readers receive useful labels, row counts, selection state, new
  findings, degraded health, copy/export status, and progress announcements.
- English and Korean user-facing copy for incident summaries, repair text,
  no-finding explanations, redaction warnings, and degraded states must be in the
  i18n catalog and reviewed for incident clarity.
- Color is never the only status signal. Large-data navigation includes keyboard
  jump to findings/matches/evidence and predictable focus under virtualization.
```

#### Mandatory review findings to carry into Slice RFCs

```text
- Slice A RFC must define the cross-process command/event contract for
  startStreamGroup, stopStreamGroup, stream-target status, stream-group status,
  and log-line events with groupId, streamId, sequence, target metadata, source
  type, file path, raw line, and receivedAt.
- Slice B RFC must pin the initial parser/finding thresholds and fields. A safe
  initial default is failed status >= 500 and slow duration >= 1000ms, but the
  RFC must choose and test it explicitly.
- Slice C-G RFCs inherit the same feature-flag, rollout, rollback, Raw Logs
  fallback, expected-red-test, and scope-cut requirements as P0/P0.5 slices.
- P1/P2 scope cuts protect the Workbench MVP loop first: direct pod Raw Logs,
  workload/label follow, source validation, visible degraded states, permission
  repair, first findings, no-finding explanations, and redacted copy summary are
  protected; service targets, advanced analysis, standalone exports, AI network
  calls, and runtime third-party loading are cut first when risk rises.
```

### Consolidated Hardening from 100-Loop Review

A follow-up 100-pass review produced 103 successful parsed passes, 101 completed
attempt records, and one failed/unparseable attempt that was replaced. Every
successful pass found at least one blocker, but the repeated findings converged
on a smaller set of contract fixes now carried by this roadmap.

Required carry-forward gates:

```text
- Kubernetes argv fidelity: every selected-target kubectl command uses structured
  argv with explicit --context and namespaced -n, including diagnostics and copy
  commands. Display strings are derived only from argv.
- Event API pinning: MVP uses events.events.k8s.io consistently, or a slice RFC
  changes both command, RBAC, PermissionGap, repair text, and live fixtures.
- Namespace-list denial fallback: least-privilege users can manually enter or
  reuse a recent namespace and validate namespace-scoped pod/exec access.
- Source-validation probes: every validation state has an exact argv, timeout,
  exit/stderr/stdout mapping, RBAC prerequisite, and fixture before Slice A/B.
- EvidenceRef everywhere: persisted/exported/SDK/copied/AI/bookmark/finding
  evidence never uses bare row ids without stream, pod UID, container, source,
  file path, incarnation, sequence, and stale/missing state.
- PermissionGap id stability: summaries, health, and no-finding explanations
  reference stable PermissionGap ids.
- Reconnect/cursor policy: tail reconnect, process exit, rotation gaps, duplicate
  risk, and data-loss events degrade investigation health until resolved.
- Finding rule identity: Failed Requests, Slow Requests, and Error Events expose
  family, rule id/version, fingerprint, dedupe key, thresholds, exact expected
  fixtures, and no-extra finding assertions.
- Query state DTO: draft invalid filters never replace committed rows, facets,
  findings, exports, incident summaries, or SDK snapshots.
- Service target scope: Workbench MVP supports direct pod, workload, and bounded
  label selector only unless the separate Service Option B contract is accepted.
```

---

## 1. Product Thesis

K9s is strong at cluster operation. Lens is strong at GUI cluster navigation.
Stern and Kubetail are strong at multi-pod tailing. Loki, Datadog, and New
Relic are strong at centralized indexed search and dashboards.

klogcat should not chase all of those surfaces. The product gap it can own is:

```text
Kubernetes pod file logs -> local investigation workspace -> structured findings
```

That means the product must optimize for:

- selecting the right workload and keeping up with pod changes
- validating that the selected containers and file paths actually contain the
  intended logs
- reducing raw log volume into meaningful slices
- showing failed, slow, restart, event, and permission suspects before users
  write custom filters
- preserving investigation context and evidence
- making degraded Kubernetes permissions and stream failures recoverable
- allowing specialized tabs to turn raw rows into domain-specific insight
- supporting AI analysis with explicit privacy and context boundaries

AI is optional acceleration, not the core trust mechanism. The default incident
path must work through deterministic first-party findings, visible EvidenceRefs, explicit blind spots, and user-controlled summaries before any AI analyzer
participates. Raw rows must never leave the machine by default.

---

## 2. Competitive Gaps

Comparison anchors:

- K9s: https://k9scli.io/
- Lens logs: https://docs.k8slens.dev/k8slens/cluster/view-logs/
- Stern: https://github.com/stern/stern
- Kubetail: https://www.kubetail.com/
- Grafana Loki query model: https://grafana.com/docs/loki/latest/query/
- Datadog Log Explorer: https://docs.datadoghq.com/logs/explorer/

| Competitor class | What users already get | klogcat should not copy | klogcat gap to close |
| --- | --- | --- | --- |
| K9s | Fast terminal resource navigation, logs, exec, port-forward, restart, scale, metrics | Full cluster operations console | Need better workload context around logs: owner, labels, restarts, events, pod replacement history/context |
| Lens | GUI Kubernetes IDE, pod/container log views, cluster navigation | Broad Kubernetes IDE scope | Need a clearer desktop investigation flow once the relevant workload is selected |
| Stern | Multi-pod and multi-container tailing, regex pod matching, new pod auto-follow | CLI-first output formatting | Need workload/label-selector stream targets and pod replacement follow |
| Kubetail | Kubernetes log-focused live tail, multi-pod single timeline, browser/terminal modes | Full hosted log viewer product | Need stronger structured analysis, extension tabs, and investigation artifacts |
| Loki/Datadog/New Relic | Indexed search, facets, grouping, dashboards, alert and retention workflows | Centralized observability platform | Need local facets, structured filters, export bundles, and fast raw-to-analysis pivots |

---

## 3. Implementation-Readiness Standard

This is the strict gate for turning any roadmap slice into engineering work.

### 3.1 Required Spec Sections

Every slice-specific implementation plan must include all of these sections:

| Required section | Pass criteria |
| --- | --- |
| Scope | Explicit in-scope and out-of-scope bullets. |
| Compatibility | States whether it preserves or supersedes relevant `docs/DESIGN.md` rules. |
| User surfaces | Names the exact app surface, normal state, empty state, loading state, partial-success state, permission-denied state, stale-resource state, and fatal error state. |
| Kubernetes contract | Lists exact `kubectl` commands, object fields read, required RBAC verbs, polling/watch strategy, and denied-permission fallback. |
| Log source contract | Defines how container/source/file-path choices are discovered, validated, persisted, and diagnosed when missing or wrong. The first supported source setup mechanism must be explicit; extension-provided presets cannot be a P0 dependency. |
| Parser and fixture contract | Defines the first supported log format, required parsed fields, aliases, unstructured-row fallback, disposable incident fixture, and expected findings/no-finding states. Required before any slice claims failed/slow/error findings. |
| Data contract | Defines DTOs for every persisted, exported, SDK-visible, or cross-process object. Raw Kubernetes objects must not cross persistence, export, or SDK boundaries unless the slice explicitly defines the shape and redaction rules. |
| Performance budget | Names row count, stream count, p95 latency, memory ceiling, and degradation behavior. |
| Privacy and security | Defines redaction, persistence, export, secret, network, and extension trust rules before data leaves memory. Clipboard, disk, and network boundaries must be separate. |
| SDK impact | States whether `klogcat.logViewer@1` is unchanged or a new protocol is required. Bundled extensions must not import host internals when the slice claims SDK coverage. |
| Tests | Maps acceptance criteria to named unit, scenario, stress, browser e2e, desktop e2e, and live Kubernetes commands, including tests expected to fail before implementation. |
| Rollout | Describes feature flag/default state, migration, rollback behavior, and Raw Logs fallback behavior. |

If any required section is missing, the slice is not implementation-ready.

### 3.2 Acceptance Criteria Format

Acceptance criteria must be written as testable Given/When/Then cases:

```text
Given <initial product and Kubernetes state>
When <user action or backend event>
Then <observable UI/state/output>
And <automated or manual validation command>
```

Vague gates such as "works with workloads" or "exports investigation bundle" do
not pass. A developer must be able to turn each criterion into a test without
inventing hidden product behavior.

### 3.3 Definition of Ready

A slice is ready for implementation only when all are true:

```text
- It changes at most one major product surface at a time.
- It has DTOs for all new state.
- It has explicit degraded behavior for missing RBAC, missing fields, stale
  Kubernetes objects, too many streams, parser failures, and extension failures.
- It has an explicit first-five-minutes path when the slice affects incident
  investigation.
- It tells the user what to do next when permissions, source paths, parser
  fields, or stream limits prevent the normal path.
- It states which existing tests should fail before implementation and pass
  after implementation.
- It defines manual/live validation against a disposable namespace.
- It does not require a later slice's undefined contract.
```

### 3.4 Definition of Done

A slice is done only when:

```text
- The slice implementation plan is linked from this roadmap.
- The code is implemented behind the documented product surface.
- Existing Raw Logs behavior remains covered.
- New unit/scenario/e2e/stress/live-kube tests pass.
- `npm run push -- origin <branch>` passes.
- Documentation for users and extension authors is updated when behavior is
  visible to them.
```

---

## 4. Baseline Contracts Required Before P0/P1 Work

These contracts close the current implementation gaps. They can live here until
they are split into slice-specific RFCs.

### 4.1 Kubernetes Command and RBAC Matrix

All workload features must remain file-tail first. The primary log collection
command remains:

```text
kubectl --context <context> exec -n <namespace> <pod> -c <container> -- tail -n <lines> -F <filePath>
```

Previous stdout/stderr logs from `kubectl logs --previous` are **not in scope**
for the workload-follow MVP. If previous container output is needed later, it
requires a separate RFC because it conflicts with the pod-internal file-tail
model and must be labeled as a different source family.

Required MVP commands:

MVP event API group is pinned to `events.k8s.io`; repair text, PermissionGap,
live fixtures, and `kubectl get events.events.k8s.io` must all use that same
resource family unless a slice RFC intentionally switches to core events.


| Operation | Command shape | Required RBAC | Fallback |
| --- | --- | --- | --- |
| List contexts | `kubectl config get-contexts -o name` | local kubeconfig | Show no contexts and diagnostic error. |
| List namespaces | `kubectl --context <context> get namespaces -o json` | `list namespaces` | Show namespace-list denied with exact scope; offer manual namespace entry and recent namespaces, then validate namespace-scoped pod access. |
| List pods by namespace | `kubectl --context <context> get pods -n <namespace> -o json` | `list pods` | Disable pod/workload target mode only for that namespace after manual/recent namespace validation fails. |
| List pods by selector | `kubectl --context <context> get pods -n <namespace> -l <selector> -o json` | `list pods` | Show selector permission or syntax error. |
| Get pod context | `kubectl --context <context> get pod -n <namespace> <pod> -o json` | `get pods` | Stream can continue; context panel shows degraded state. |
| List workloads | `kubectl --context <context> get deploy,statefulset,daemonset,replicaset -n <namespace> -o json` | `list deployments,statefulsets,daemonsets,replicasets` | Keep direct pod mode available. |
| Get related ReplicaSet | `kubectl --context <context> get replicaset -n <namespace> <name> -o json` | `get replicasets` | Owner chain stops at ReplicaSet. |
| List events | `kubectl --context <context> get events.events.k8s.io -n <namespace> --field-selector involvedObject.name=<pod> -o json` | `list events.events.k8s.io` | Context panel shows events unavailable and repair text uses `apiGroup: events.k8s.io`. |
| Start file stream | `kubectl --context <context> exec -n <namespace> <pod> -c <container> -- tail -n <lines> -F <filePath>` | `create pods/exec` | Stream group records per-target start failure. |

MVP workload selector rules:

```text
- Deployment, StatefulSet, DaemonSet, and ReplicaSet targets must resolve pods
  through `.spec.selector.matchLabels` only when no `matchExpressions` are
  present.
- If a workload uses any `matchExpressions`, including mixed
  `matchLabels` + `matchExpressions`, show `unsupported_selector` unless the
  slice RFC implements exact Kubernetes selector serialization for expressions.
  Do not broaden the selector by silently dropping expressions.
- Label-selector target mode accepts a Kubernetes selector string and passes it
  directly to `kubectl get pods -l`.
- Direct pod mode remains unchanged.
- Watch is optional. The MVP must poll every 5 seconds by default and may use
  watch later as an optimization.
```

Service targets are a deliberate MVP decision point. The roadmap can mention
service-originated incidents, but a slice must choose one of these contracts
before implementation starts:

```text
Option A, out of scope for Workbench MVP:
- Service target selection is not supported. Users must choose direct pod,
  workload, or label selector.
- Service names pasted into the target picker show a clear unsupported target
  message and suggest choosing the owning workload or selector.

Option B, supported service target:
- Add `service` to TargetMode.
- Add `service?: { name: string; selector: string }` to LogTargetRef.
- Add `serviceGet` to PermissionFeature.
- Add `Get service` to the Kubernetes command/RBAC matrix.
- Resolve pods through `kubectl get service -n <namespace> <name> -o json` and
  `.spec.selector`.
- Require `get services` RBAC.
- Selectorless, ExternalName, and unsupported headless-service cases must show
  `unsupported_service_target` and cannot guess pods from endpoints.
- Add scenario or live-kube validation for the chosen supported/unsupported
  service behavior before Slice A is complete.
```

Stream limits:

```text
- Default soft limit: 20 active stream targets per stream group.
- Hard limit: 50 active stream targets.
- If selected workload resolves above the soft limit, require explicit
  confirmation.
- If selected workload resolves above the hard limit, block start and show the
  selector/pod count.
- A hard-limit block must include a narrowing workflow, not only an error. The
  UI must offer at least pod list inspection and selector refinement, and should
  offer top recent restarts, not-ready pods, newest pods, or node-based
  narrowing when those fields are available.
```

Reconnect/cursor policy:

```text
- `tail -F` reconnect starts a new streamIncarnation and records the previous
  segment endReason. Because pod-internal files do not provide a durable cursor,
  reconnect must be documented as at-least-once within the retained buffer and
  may surface duplicate-risk or gap-risk markers.
- Reconnect tests must cover pod replacement, container restart, command exit,
  network interruption, user stop, duplicate rows after restart, and gap markers
  when a file rotated outside the retained window.
- DroppedRowCount is paired with reasoned data-loss events; aggregate counts
  alone cannot justify a healthy investigation state.
```

Partial success:

```text
- A stream group may be `running_with_errors`.
- Successful streams continue when some pods fail RBAC, container lookup, or
  file-path validation.
- Per-target failures must be visible and exportable in diagnostics.
```

Source validation:

```text
- Each stream group must validate container/source/file-path choices before or
  during start.
- Validation state must distinguish missing container, missing file path,
  unreadable file path, missing or unusable container-side tail runtime, missing
  shell for shell-based probes, permission denied, command failure, no rows yet,
  parser mismatch, and healthy.
- Source choices may come from user input, saved presets, repo/workspace
  defaults, or extension-provided presets, but the slice RFC must define which
  source is supported first.
- Validation errors must include copyable diagnostics and must not silently
  fall back to another source family.
```

Source validation probe matrix:

```text
- Slice A/B RFCs must define the exact structured argv, timeout, expected
  stdout/stderr/exit-code signals, RBAC prerequisite, and fixture for each
  validation outcome: missing_container, missing_file_path,
  unreadable_file_path, tail_unavailable, shell_unavailable,
  permission_denied, command_failed, no_rows_yet, parser_mismatch, and healthy.
- Probe failure order must prevent generic command_failed from masking a more
  specific state when stderr/exit-code evidence can distinguish it.
- healthy_no_findings is impossible unless source validation and parser probes
  have proven the source is healthy for the relevant finding rule.
```

Permission repair:

```text
- Permission-denied states must show the denied verb, resource, namespace, and
  affected feature when that information can be inferred from kubectl output or
  the attempted command.
- The UI must provide copyable repair text for a platform administrator,
  including the minimum required RBAC for the blocked feature.
- Permission gaps must be included in diagnostics and incident summaries.
```

### 4.2 Data Contracts

All new state must be represented by explicit DTOs before implementation.

```ts
type TargetMode = 'pod' | 'workload' | 'labelSelector'

type WorkloadKind = 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'ReplicaSet'

type SourceLogType = 'info' | 'access' | 'error'

type LogTargetRef = {
  context: string
  namespace: string
  mode: TargetMode
  pod?: string
  workload?: { kind: WorkloadKind; name: string; selector: string }
  labelSelector?: string
}

type StreamTarget = {
  streamId: string
  groupId: string
  context: string
  namespace: string
  pod: string
  podUid: string
  container: string
  containerId?: string
  sourceType: SourceLogType
  filePath: string
  restartCountAtStart?: number
  startedAt?: string
  endedAt?: string
  status: 'pending' | 'starting' | 'running' | 'ended' | 'failed'
  streamIncarnation: string
  endReason?: 'pod_replaced' | 'pod_terminated' | 'pod_completed' | 'container_restarted' | 'context_unavailable' | 'namespace_unavailable' | 'user_stop' | 'command_exit' | 'error'
  errorCode?: string
  droppedRowCount: number
  dataLossEventIds: string[]
  parserFailureCount: number
  lastRowAt?: string
  stateChangedAt: string
}

type SourceValidationState = {
  validationId: string
  streamId?: string
  groupId?: string
  context: string
  namespace: string
  pod?: string
  podUid?: string
  container: string
  sourceType: SourceLogType
  filePath: string
  status:
    | 'unvalidated'
    | 'validating'
    | 'healthy'
    | 'missing_container'
    | 'missing_file_path'
    | 'unreadable_file_path'
    | 'tail_unavailable'
    | 'shell_unavailable'
    | 'permission_denied'
    | 'command_failed'
    | 'no_rows_yet'
    | 'parser_mismatch'
  diagnosticCommand?: DiagnosticCommand
  message: string
}

type SourcePreset = {
  id: string
  label: string
  sourceType: SourceLogType
  containerSelector?: string
  filePath: string
  scope: 'user' | 'workspace' | 'repo' | 'cluster'
  origin: 'manual' | 'preset' | 'config' | 'extension'
}

type PermissionFeature =
  | 'namespaceList'
  | 'podList'
  | 'podGet'
  | 'workloadList'
  | 'replicaSetGet'
  | 'eventList'
  | 'execTail'
  | 'contextPanel'

type PermissionGap = {
  id: string
  feature: PermissionFeature
  context: string
  namespace?: string
  scope: 'cluster' | 'namespace'
  apiGroup: '' | 'apps' | 'events.k8s.io' | string
  verb: string
  resource: string
  subresource?: string
  resourceName?: string
  attemptedCommand?: DiagnosticCommand
  kubectlExitCode?: number
  stderrExcerpt?: string
  repairConfidence: 'exact' | 'inferred' | 'unknown'
  repairText: string
}

type KubernetesEventSummary = {
  reason: string
  type: 'Normal' | 'Warning' | 'Unknown'
  message: string
  firstTimestamp?: string
  lastTimestamp?: string
  count?: number
}

type ContainerContext = {
  name: string
  image: string
  imageId?: string
  ready: boolean
  restartCount: number
}

type KubernetesContextSnapshot = {
  context: string
  namespace: string
  pod: string
  podUid: string
  observedAt: string
  resourceVersion?: string
  owner?: { kind: WorkloadKind | 'Pod' | 'Job' | 'Unknown'; name: string; uid?: string }
  phase: string
  nodeName?: string
  labels: Record<string, string>
  containers: ContainerContext[]
  events: KubernetesEventSummary[]
  eventsUnavailableReason?: string
  state: 'loaded' | 'loading' | 'partial' | 'stale' | 'no_permission'
}

type DiagnosticCommand = {
  label: string
  executable: 'kubectl' | string
  argv: string[]
  displayCommand: string
  redactionRequired: boolean
}

// displayCommand/copy text is a one-way rendering of executable + argv. It is
// never parsed back for execution, and tests assert argv boundaries for context,
// namespace, selector, container, pod, and file path values.

type DataLossEvent = {
  id: string
  groupId: string
  streamId: string
  streamIncarnation: string
  sourceType: SourceLogType
  filePath: string
  timeWindow?: { from: string; to: string }
  sequenceRange?: { from: number; to: number }
  reason: 'buffer_eviction' | 'oversize_row' | 'stream_gap' | 'rotation_gap' | 'parser_drop' | 'unknown'
  count: number
  affectedEvidenceRefs: EvidenceRef[]
}

type StreamGroupState = 'starting' | 'running' | 'running_with_errors' | 'stopping' | 'ended' | 'failed'

type InvestigationHealth = {
  groupId: string
  context: string
  namespace: string
  targetCount: number
  activeTargets: number
  failedTargets: number
  streamState: StreamGroupState
  droppedRowCount: number
  dataLossEventIds: string[]
  parserFailureCount: number
  permissionGapCount: number
  permissionGapIds: string[]
  lastRowAt?: string
  receivedAt?: string
  clockSkewSuspected: boolean
  state: 'healthy' | 'degraded' | 'stale' | 'failed'
}

type TimelineRowIdentity = {
  rowId: string
  investigationId: string
  groupId: string
  streamId: string
  sequence: number
  streamIncarnation: string
  context: string
  namespace: string
  pod: string
  podUid: string
  container: string
  containerId?: string
  sourceType: SourceLogType
  filePath: string
}

type EvidenceRef = TimelineRowIdentity & {
  state: 'active' | 'stale' | 'missing'
  exportRowFileRef?: string
}

type FindingState = 'active' | 'partial_results' | 'stale_evidence'

type InvestigationFinding = {
  id: string
  source: 'firstParty' | 'extension' | 'ai'
  title: string
  severity: 'info' | 'warning' | 'error' | 'critical'
  affectedTargets: LogTargetRef[]
  timeRange?: { from: string; to: string }
  evidenceRefs: EvidenceRef[]
  evidenceCount: number
  family: 'failed_request' | 'slow_request' | 'error_event' | 'extension' | 'ai'
  ruleId: string
  ruleVersion: string
  fingerprint: string
  dedupeKey: string
  thresholdsApplied: Record<string, number | string>
  evidencePolicy: 'exact' | 'sampled' | 'partial'
  summary: string
  suggestedNextChecks: string[]
  state: FindingState
  confidence?: number
}

type NoFindingExplanation = {
  reason:
    | 'healthy_no_findings'
    | 'no_matching_rows'
    | 'missing_parser_fields'
    | 'missing_permissions'
    | 'stream_failures'
    | 'source_path_problems'
    | 'partial_results'
  message: string
  relatedPermissionGapIds?: string[]
  relatedStreamIds?: string[]
}

type FilterMode = 'grep' | 'regex' | 'structured'

type QueryState = {
  mode: FilterMode
  draft: string
  committed: string
  parseStatus: 'not_applicable' | 'valid' | 'invalid'
  parseError?: string
  appliedAt?: string
}

type FacetSelection = {
  field: string
  values: string[]
  operator: 'orWithinFacet' | 'andAcrossFacets'
}

type RedactionSummary = {
  policyId: string
  ruleVersion: string
  redactedFieldCounts: Record<string, number>
  warnings: string[]
}

type IncidentSummary = {
  target: LogTargetRef
  timeWindow: { from: string; to: string }
  findingIds: string[]
  evidenceRefs: EvidenceRef[]
  queryState: QueryState
  facetSelections: FacetSelection[]
  redactionPolicyId: string
  redactionStatus: 'not_required' | 'applied' | 'warning' | 'failed'
  redactionSummary: RedactionSummary
  permissionGapIds: string[]
  noFindingExplanation?: NoFindingExplanation
  blindSpots: Array<
    | 'missing_source'
    | 'missing_parser_fields'
    | 'permission_gap'
    | 'stream_failure'
    | 'dropped_rows'
    | 'partial_results'
  >
}

type CopyIncidentSummaryState = {
  status: 'idle' | 'preview' | 'redaction_warning' | 'copying' | 'copy_success' | 'copy_failure'
  summary?: IncidentSummary
  errorMessage?: string
}
```

Parsed row and field contract:

```text
Every parser, structured filter, bundled extension, AI analyzer input, export,
and SDK-visible snapshot must use the same normalized row contract. Slice RFCs
may add fields, but they cannot let core filters and extensions invent separate
alias or typing rules.
```

```ts
type ParsedLogRow = {
  rowId: string
  streamId: string
  sequence: number
  originalText: string
  parsedTimestamp?: string
  receivedAt: string
  normalizedFields: Record<string, string | number | boolean | null>
  originalFields: Record<string, unknown>
  parserStatus: 'parsed' | 'unstructured' | 'parser_error'
  parserError?: string
  fieldAliases: Record<string, string>
  privateFields: string[]
}
```

Timeline ordering contract:

```text
1. Prefer parsed log timestamp when available.
2. Fall back to receivedAt.
3. Break ties by streamId, then per-stream sequence.
4. Late arrivals can be inserted inside the reorder window.
5. Rows outside the reorder window append with a visible late-arrival marker.
6. Dropped rows must increment per-stream droppedRowCount.
```

Session/export DTOs must include:

```text
- schemaVersion
- createdAt
- appVersion
- target refs and resolved stream targets
- source validation states
- investigation health snapshot
- data-loss events and dropped-row reason summaries
- active filters/facets
- bookmarked EvidenceRefs and notes
- findings
- incident summary
- permission gaps
- redaction policy id and redaction summary
- exported row file references
```

The first slice that implements export or persistence must define concrete JSON
schemas for:

```text
- bundle manifest
- redaction summary
- row file references
- finding serialization
- bookmark/note serialization
```

### 4.3 Parser and Incident Fixture Contract

P0.5 findings cannot start until the first log schema is explicit. The first
slice that claims failed, slow, or error suspects must define:

```text
- the canonical disposable incident fixture namespace, deployment, container,
  and pod-internal APP/ACC/ERR file paths
- the sample log corpus used by unit, scenario, stress, browser e2e, and
  live-kube validation
- required parsed fields for Failed Requests
- required parsed fields for Slow Requests
- accepted field aliases such as status/statusCode, elapsed/elapsedMs/
  durationMs/latencyMs, traceId/trId, with all duration aliases normalized into canonical durationMs before Slow Requests run
- expected findings, expected EvidenceRefs, and expected no-finding states
- fallback behavior when rows are unstructured or required fields are missing
```

Minimum deterministic finding inputs:

```text
Failed Requests:
- numeric status/statusCode >= 500, or
- error rcode/reason field classified by the slice RFC.

Slow Requests:
- canonical numeric durationMs field normalized from elapsed/elapsedMs/durationMs/latencyMs aliases, and
- a threshold in milliseconds defined by the slice RFC. Slow Requests must not consume ambiguous raw elapsed fields until their units/coercion rules are specified.

Correlation:
- traceId or trId is optional for P0.5 but required before Trace/Transaction
  View can be marked ready.
```

A fixture-only pass is not enough for launch. Before Workbench MVP launch, the
parser contract must be exercised against at least one realistic sample corpus
that was not authored solely for the happy-path test, and that validation must
be referenced by the Workbench MVP launch checklist and Slice B acceptance.

### 4.4 Structured Filter Grammar

Structured filters are not part of the current `DESIGN.md` contract. Before
Slice B starts, a slice RFC must explicitly supersede that rule.

MVP grammar:

```text
filter       := clause (WS "AND" WS clause)*
clause       := field operator value | field ":" value
operator     := "=" | "!=" | ">" | ">=" | "<" | "<="
field        := [A-Za-z_][A-Za-z0-9_.-]*
value        := quoted-string | number | bare-token
```

The Slice B RFC must define quoted-string escaping and whether the `AND`
operator is case-sensitive before implementation starts.

MVP exclusions:

```text
- No OR.
- No NOT.
- No parentheses.
- No arbitrary JavaScript/regex in structured mode.
- Regex remains only in the existing grep mode.
```

Field behavior:

```text
- Numeric comparisons only match numeric fields.
- Missing fields do not match comparisons.
- `field:value` is case-insensitive substring for strings and exact match for
  numbers/booleans.
- Invalid filters show a parse error and do not change the active result set.
- Facet counts are computed from rows after time range and source/target
  filters, but before that facet's own selected values.
```

Filter state contract:

```text
- Gated filter state is represented by QueryState and FacetSelection, not only
  display strings. Draft invalid structured queries never replace the committed
  query used by rows, facets, findings, exports, incident summaries, or SDK
  snapshots.
- Slice B may ship incident triage without general structured filters only if
  its RFC states which first-party finding shortcuts are deterministic rules
  rather than user-entered structured queries. Slice C owns the full grammar.
```

### 4.5 Required Product Surfaces

The roadmap is not implementation-ready unless these surfaces are specified in
the slice plan:

| Surface | Required states |
| --- | --- |
| Target picker | direct pod, workload, label selector, loading, empty namespace, unsupported selector, too many pods, RBAC denied |
| Source validation | unvalidated, validating, healthy, missing container, missing file path, unreadable file path, tail unavailable, shell unavailable, permission denied, command failed, no rows yet, parser mismatch |
| Stream group status | all running, running with errors, starting, stopping, ended, failed |
| Kubernetes context panel | loaded, loading, stale, partial, no permission, events unavailable |
| Permission repair kit | no gaps, partial gaps, blocked feature, copy repair request, copy failed |
| Investigation health | healthy, degraded, stale, dropped rows, parser failures, stream failures, clock skew suspected |
| Facets/filter panel | no rows, counts loading, parse error, selected filters, reset |
| Finding rail | no findings, calculating, findings present, partial findings, stale evidence, finding copy failed |
| Analysis tabs | empty, calculating, ready, partial, extension error, export unavailable |
| Investigation timeline | no bookmarks, bookmarks present, stale row reference, note edit error |
| Incident summary | no findings, preview, redaction warning, copy success, copy failure |
| Export dialog | redaction preview, redaction warning, file write success, file write failure |
| Extension manager | installed, disabled, incompatible protocol, capability denied, activation failed |

### 4.6 Privacy and Redaction Baseline

This baseline applies before exports, persisted sessions, AI analysis, or
runtime extensions.

Default redaction:

```text
- Authorization headers and bearer/basic tokens
- cookies and session ids
- API keys and secrets matching common key names
- email addresses
- IPv4/IPv6 addresses unless user disables IP redaction
- fields explicitly marked private by parser or extension metadata
```

Hard rules:

```text
- Raw rows are never sent to a network destination by default.
- Copy incident summary applies default redaction before clipboard write and
  must not write the copied summary to disk unless a later slice explicitly adds
  persistence with location, retention, and clear semantics.
- Export and AI analysis must show a redaction preview before writing or
  sending data.
- Extensions cannot read host secrets through the log-viewer SDK.
- Runtime extensions cannot get network, shell, filesystem, or Tauri command
  access without a separate isolated capability RFC.
```

### 4.7 Test and Performance Gates

Every slice must update tests at the correct layer.

Required command gate:

```bash
npm run typecheck
npm run lint
npm run test:coverage
npm run test:unit
npm run test:scenario
npm run test:stress
npm run test:e2e
npm run build
(cd src-tauri && cargo fmt -- --check)
(cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings)
(cd src-tauri && cargo test --all-targets)
```

Required live Kubernetes validation for workload features:

```text
- disposable namespace is created and deleted
- deployment with two pods is tailed through file-tail mode
- replacement pod is followed after deleting one pod
- valid source path starts cleanly and invalid source path produces a specific
  source validation error
- RBAC-denied events path degrades the context panel without stopping streams
- RBAC-denied paths provide copyable permission repair text
- too-many-pods selector blocks at the documented hard limit and offers a
  narrowing workflow
```

Performance budgets for P0/P1:

```text
- 50k buffered rows remain supported.
- 150k-row burst simulation remains supported.
- query p95 < 500ms.
- tab switch p95 < 200ms.
- detail/open row p95 < 150ms.
- stream group status update p95 < 250ms at 20 active streams.
- facet recompute p95 < 500ms at 50k rows.
- first credible failed/slow/error finding appears in < 60 seconds after the
  app is ready and the disposable incident fixture is deployed, Ready, and
  producing documented log files.
- investigation health updates p95 < 250ms when stream, parser, dropped-row, or
  permission state changes.
```

---

## 5. Prioritization Model

Use these priority labels:

```text
P0 = Required to make the workbench position true.
P0.5 = Required to make the product usable as a last-hope incident tool.
P1 = Required for a compelling first public product.
P2 = Differentiators that make klogcat hard to replace.
P3 = Ecosystem and polish once the core loop is credible.
```

Evaluation criteria:

| Criterion | Weight | Reason |
| --- | ---: | --- |
| Investigation impact | 40% | Does it help users reach root cause faster? |
| Positioning leverage | 25% | Does it make klogcat distinct from K9s/Lens/Stern? |
| Implementation risk | 20% | Can it ship without destabilizing log streaming? |
| Extension leverage | 15% | Does it improve third-party or AI analysis paths? |

Product validation metrics for Workbench MVP:

```text
- time to first credible signal
- time to explain a no-finding result
- source misconfiguration recovery rate
- copy incident summary success rate
- percentage of investigations with visible blind spots
- kubectl/K9s/Stern fallback rate during fixture-based usability trials
```

At least three fixture families are mandatory before public workbench launch:

```text
1. failing request incident
2. slow request incident
3. degraded/no-finding incident covering missing source, missing parser fields,
   permission gaps, stream failures, no matching rows, and healthy logs
```

---

## 6. Priority Roadmap

### P0. Workload-Aware Log Collection

Current gap:

```text
klogcat selects pod/container/file path. Real incidents usually start from a
workload, deployment, label selector, service, or restarted pod set.
```

Ship:

1. Workload target mode:
   - Deployment, StatefulSet, DaemonSet, ReplicaSet, and label selector targets.
   - Resolve selected workload to pods in the selected namespace/context.
   - Preserve the existing direct pod mode.
2. Multi-pod stream groups:
   - Start one stream per matched pod/container/source.
   - Keep a shared ordered timeline.
   - Surface per-pod stream status.
   - Validate source/container/file-path state per target.
3. Pod replacement follow:
   - Watch/refresh matching pods.
   - Auto-start streams for new matching pods.
   - Mark old pod streams as ended without losing rows.
4. Selector narrowing:
   - If a selector exceeds the hard stream limit, show pod count and matching
     pods instead of only blocking.
   - Offer selector refinement and available narrowing dimensions such as
     restart count, readiness, newest pods, or node.
5. Explicit previous-log non-goal for MVP:
   - Do not use `kubectl logs --previous` in the workload-follow MVP.
   - If previous stdout/stderr logs become necessary, write a separate RFC that
     labels them as a different source family from pod-internal file logs.

Completion gates:

```text
- User can select a Deployment and stream logs from all matching pods.
- When a pod disappears and a replacement appears, klogcat follows the new pod.
- Timeline rows keep target context visible.
- Source validation distinguishes missing container, missing file path,
  permission denied, no rows yet, and healthy targets. Parser mismatch is only
  required in Slice A if the Slice A RFC defines the minimum parser contract;
  otherwise it becomes mandatory in Slice B.
- Tests cover direct pod mode, workload mode, and pod replacement.
- RBAC-denied workload/event paths degrade without blocking direct pod mode.
- Too-many-pods selectors provide a narrowing path before the user falls back to
  manual kubectl commands.
- The implementation passes the Kubernetes command/RBAC matrix above.
```

Why first:

```text
Without workload follow, klogcat remains a pod viewer. Workbench users need to
follow the system under investigation, not a single pod name.
```

### P0. Kubernetes Context Panel

Current gap:

```text
Logs are detached from the Kubernetes facts needed to explain them.
```

Ship:

1. Selected target context panel:
   - owner kind/name
   - labels
   - image/tag
   - node
   - restart count
   - pod phase
   - container ready state
2. Related Kubernetes events:
   - show recent warning events for selected pod/workload
   - expose event time and reason
3. Copy diagnostic commands:
   - copy stream command
   - copy `kubectl describe pod`
   - copy `kubectl get events`
4. Permission repair kit:
   - show the denied verb/resource/namespace where available
   - copy a minimum RBAC request for the blocked feature
   - include permission gaps in diagnostics and incident summaries

Completion gates:

```text
- User can explain whether errors correlate with restarts, scheduling, image,
  or readiness state without leaving klogcat.
- Context panel failures are recoverable and do not block raw logs.
- Permission-denied context/event/workload paths provide copyable repair text,
  not only warning banners.
- Context DTOs and event fallback behavior are documented before code changes.
```

Why first:

```text
K9s and Lens win on Kubernetes context. klogcat does not need their full command
surface, but it must bring the context that makes logs interpretable.
```

### P0.5. Incident Triage Loop

Current gap:

```text
The roadmap has collection, context, filters, analysis, and exports, but the
last-hope user needs one continuous path from target selection to the first
credible suspect and shareable evidence.
```

Ship:

1. First-five-minutes incident path:
   - select workload or label selector
   - discover or choose a supported source preset/setup path
   - validate source/container/file-path choices
   - start stream group
   - show stream health and blind spots
   - show first failed/slow/error suspects
   - copy a redacted incident summary
2. Investigation health panel:
   - active context and namespace
   - target count and stream state
   - failed stream count
   - dropped row count
   - parser failure count
   - last row time
   - permission gaps
   - clock-skew suspicion when row time and receive time diverge
3. Minimal bundled findings:
   - Failed Requests for parsed `status >= 500` or error reason fields
   - Slow Requests for parsed elapsed/duration fields
   - parser/log-schema contract and disposable incident fixture defined before
     implementation
   - evidence rows referenced by EvidenceRefs with stable row ids and stream identity
   - explicit "unavailable because parser fields are missing" state
4. Finding rail:
   - top suspects across bundled analysis tabs
   - severity, title, evidence count, affected target, and time range
   - stale evidence and partial-results states
5. Copy incident summary:
   - target/context/namespace
   - time window
   - top findings and EvidenceRefs
   - active filters
   - stream/source/parser/permission blind spots
   - default redaction before clipboard write
   - no hidden disk write
   - redaction status

Completion gates:

```text
- On the disposable incident fixture, after the app is ready and the fixture is
  deployed, Ready, and producing documented log files, a user can reach the
  first failed/slow/error finding in under 60 seconds.
- If no finding appears, the UI explains whether the cause is no matching rows,
  missing parser fields, missing permissions, stream failures, source-path
  problems, partial results, or healthy logs, using `NoFindingExplanation`.
- The user can copy an incident summary without using the full export bundle,
  after default redaction and without hidden disk persistence.
- Investigation health is always visible while a stream group is active.
- Findings are emitted through `InvestigationFinding` so P1 analysis tabs,
  exports, AI, and third-party extensions reuse the same contract.
```

Why before P1:

```text
This is the bridge from "log viewer with roadmap" to "tool an engineer can trust
during an active incident." Without it, the strongest value remains distributed
across separate future features.
```

### P1. Structured Investigation Controls

Current gap:

```text
grep is necessary but not enough. Investigation tools need facets, field
filters, grouping, and time-window pivots.
```

Ship:

1. Field facets:
   - source type
   - pod
   - container
   - level
   - status
   - method
   - url/path prefix
   - rcode/error reason
2. Structured filters:
   - `status >= 500`
   - `elapsed > 1000`
   - `level:error`
   - `pod:<name>`
   - `traceId:<id>` / `trId:<id>`
3. Time controls:
   - last N minutes
   - around selected row
   - pause at incident time
4. Group by:
   - group errors by reason/path/status
   - group slow requests by route

Completion gates:

```text
- User can find failed or slow requests without writing raw regex.
- Filters update visible rows and extension snapshots consistently.
- Facet counts remain responsive at the current stress-test row limits.
- The structured filter grammar is implemented exactly as documented or the
  slice RFC updates the grammar before implementation.
```

Why second:

```text
This closes the gap with observability products at local scale and gives
extensions better inputs.
```

### P1. First-Party Analysis Tabs

Current gap:

```text
The P0.5 triage loop proves minimal failed/slow findings. P1 turns those
incident findings into full bundled analysis tabs that prove the SDK and make
third-party tabs worth copying.
```

Ship as bundled extensions, not core viewer logic:

1. Failed Requests:
   - status >= 500
   - error rcode/reason
   - top failing URLs
   - sample rows
2. Slow Requests:
   - configurable elapsed threshold
   - top slow routes
   - p50/p95/p99 for visible rows
3. Error Clusters:
   - group by exception name, reason, path, or response code
   - show representative rows
4. Trace/Transaction View:
   - pivot by `trId` or `traceId`
   - show rows in request sequence
5. Shared finding contract:
   - all analysis tabs emit `InvestigationFinding`
   - finding evidence references EvidenceRefs with stable row ids and stream identity
   - findings can be exported before AI work begins
   - top findings appear in the shared finding rail, not only inside tab-local
     UI
6. Bundled Extension SDK readiness:
   - the public SDK exposes a finding emit/subscribe contract or an equivalent
     host-mediated result channel
   - registered capabilities cannot exceed declared manifest capabilities
   - `isolated-runtime` extensions are rejected until an actual isolated host
     exists; same-context bundled code can only use `trusted-bundled`
   - bundled extensions must not import Zustand stores, Tauri commands, or host
     internals directly

Completion gates:

```text
- At least Failed Requests and Slow Requests ship as extensions using only the
  public SDK, extending the minimal P0.5 findings rather than replacing them.
- Each tab has an empty state, loading/error boundary, and export path.
- Raw Logs remains first and is not coupled to analysis tab internals.
- Findings are produced through a shared contract that can later be reused by AI
  and third-party extensions.
```

Why second:

```text
The product needs a visible answer to "what investigation does this do better
than a terminal log tail?"
```

### P1. Investigation Session Artifacts

Current gap:

```text
Workbench users need to leave with evidence, not just a filtered screen.
```

Ship:

1. Bookmarks:
   - mark important rows
   - add short notes
   - preserve target metadata
2. Investigation timeline:
   - selected rows
   - notes
   - Kubernetes events
   - analysis findings
3. Export bundle:
   - redacted JSONL rows
   - summary markdown
   - target metadata
   - active filters
   - extension findings
4. Local session persistence:
   - resume the last investigation
   - clear session explicitly
5. Incident summary continuity:
   - full bundle must include any copied incident summary fields
   - export must preserve investigation health, permission gaps, source
     validation state, and known blind spots

Completion gates:

```text
- P0.5 "copy incident summary" remains available without requiring full export.
- User can export an investigation bundle and reproduce what was visible.
- Bundle excludes host-only or sensitive fields unless explicitly allowed.
- Extension findings can be included through a public result contract.
- Bundle schema, persistence location, retention rules, and redaction defaults
  are documented before implementation.
```

Why second:

```text
This converts klogcat from viewer to workbench.
```

### P2. AI Analysis Protocol

Current gap:

```text
An AI tab cannot be treated as just another renderer. It needs row-window
selection, privacy controls, async state, and structured findings.
```

Ship:

1. Analysis input contract:
   - selected rows
   - visible rows
   - around selected row
   - bookmarked rows
   - time-window rows
2. Redaction policy:
   - default redact tokens, cookies, authorization headers, IPs, emails, and
     configurable fields
   - preview redacted context before sending
3. Secret boundary:
   - explicit API key storage model
   - no SDK access to secrets by default
   - host-mediated network calls for untrusted extensions
   - visible local-only/no-network state when an analyzer cannot or should not
     send data
4. Finding result contract:
   - AI analyzers return `InvestigationFinding` directly, or a versioned adapter
     maps analyzer output into `InvestigationFinding`.
   - Use `summary`; do not introduce a separate `explanation` field unless the
     adapter maps it explicitly.
   - title
   - severity
   - affected targets
   - time range
   - EvidenceRefs
   - suggested next checks
   - confidence
5. Async analysis lifecycle:
   - queued/running/succeeded/failed/cancelled
   - progress messages
   - retry with same context

Completion gates:

```text
- User can see what data would leave the machine before enabling or running an
  AI analyzer.
- A sample AI analyzer extension can produce findings without importing host
  internals.
- Redacted context can be inspected before network submission.
- Findings render in an analysis tab and can be exported in the investigation
  bundle.
```

Why later:

```text
AI is a strong differentiator, but shipping it before session artifacts and
redaction would create trust and product-quality risk.
```

### P2. Runtime Extension System

Current gap:

```text
The current SDK supports build-time trusted extensions. Third-party development
needs a path that does not require editing the host source tree.
```

Ship:

1. Extension scaffold:
   - `npm create klogcat-extension`
   - sample viewer
   - local dev command
2. Manifest validation CLI:
   - protocol version
   - capabilities
   - id/owner rules
   - package metadata
3. Runtime local install:
   - load from a local extension directory
   - enable/disable per extension
   - show activation errors
4. Isolation model:
   - iframe/webview/worker host
   - message-passing SDK bridge
   - strict capabilities
   - no direct access to Zustand, Tauri commands, filesystem, network, or
     secrets
5. Compatibility policy:
   - `klogcat.logViewer@1`
   - deprecation window
   - test fixture for extension authors

Completion gates:

```text
- A third-party extension can be built outside the repo and loaded locally.
- A broken extension cannot break Raw Logs or another extension tab.
- Unknown protocol/capability fails before execution.
```

Why later:

```text
Runtime plugins are strategic, but isolation and trust boundaries must be real
before calling the platform third-party ready.
```

### P3. Distribution and Open-Source Trust

Current gap:

```text
The product is not yet easy or credible enough for an outside user to try.
```

Ship:

1. Choose an open-source license.
2. Add signed or checksumed GitHub Releases.
3. Add Homebrew Cask for macOS.
4. Use HTTPS install docs as the default path.
5. Add real rendered demo media:
   - GIF or image thumbnail in README
   - WebM/MP4 downloadable demo
6. Add contribution docs:
   - `CONTRIBUTING.md`
   - issue templates
   - PR checklist
7. Add compatibility matrix:
   - supported Kubernetes versions
   - supported OSes
   - required `kubectl`

Launch-trust minimum pulled earlier than full P3:

```text
Before any public Workbench MVP claim, klogcat needs license clarity, a
checksumed release artifact, HTTPS install instructions, the OS/kubectl/
Kubernetes compatibility matrix, and a short privacy/security statement.
Homebrew Cask, contribution docs, issue templates, and broader community
process can remain P3 polish.
```

Completion gates:

```text
- A new user can install without SSH access.
- GitHub README renders the demo visibly.
- License and contribution expectations are unambiguous.
```

Why later:

```text
This improves adoption, but it should not distract from the core workbench
feature gap.
```

---

## 7. Suggested Release Slices

### Slice A: Workload Follow MVP

Priority: P0

Scope:

- workload/label target selection
- multi-pod stream group
- pod replacement follow
- per-target status
- tests and stress gate update

Success metric:

```text
An engineer investigating a deployment can start one stream group and keep
following logs through pod replacement without manual reselection.
```

Acceptance criteria:

| Case | Given | When | Then | Required validation |
| --- | --- | --- | --- | --- |
| Deployment follow | A deployment has two running pods and APP file logs | User starts a workload stream | Two stream targets run in one timeline | scenario + live-kube |
| Pod replacement | One selected workload pod is deleted | Replacement pod appears | New pod stream starts automatically | live-kube |
| Source validation | One matching pod has the requested file path and another does not | User starts workload stream | Healthy target runs and failed target shows source validation error | unit + scenario |
| RBAC denied | Workloads are denied but pods are listable | User opens target picker | Direct pod mode remains available with warning | unit + scenario |
| Stream limit | Selector resolves above hard limit | User starts stream | Start is blocked with pod count, pod list inspection, selector refinement, and available restart/not-ready/newest/node narrowing options | unit + browser e2e |
| Service decision | Service target support is either out of scope or selected for the slice | User pastes or selects a Service name | Option A shows unsupported handoff to workload/selector, or Option B resolves through `.spec.selector` and handles selectorless/ExternalName/headless cases | unit + scenario + live-kube if Option B |
| Rollout fallback | Workload target mode is disabled by feature flag or rollback | User opens Raw Logs | Direct pod Raw Logs remains available with no migration | unit + scenario |

Implementation RFC must define:

```text
- feature flag name and default state
- rollback behavior
- Raw Logs fallback behavior
- tests expected to fail before implementation
```

### Slice A2: Kubernetes Context MVP

Priority: P0

Scope:

- selected target context panel
- owner, image/tag, node, restart count, phase, and ready state
- recent warning events when RBAC allows
- copy diagnostic commands
- permission repair kit for context/event/workload gaps
- `KubernetesContextSnapshot`, `KubernetesEventSummary`, and
  `DiagnosticCommand` DTOs

Success metric:

```text
An engineer can explain whether visible log errors correlate with restarts,
scheduling, image, readiness, or recent Kubernetes warning events without
leaving klogcat.
```

Acceptance criteria:

| Case | Given | When | Then | Required validation |
| --- | --- | --- | --- | --- |
| Pod context | A selected pod has owner, image, node, restart, and readiness data | Context panel loads | The normalized context snapshot renders without exposing raw Kubernetes JSON | unit + scenario |
| Events available | Warning events exist for the selected pod | User opens context panel | Event reason, time, and message appear | unit + live-kube |
| Events denied | Events are RBAC denied | User opens context panel | Logs continue and permission repair text is copyable | unit + live-kube |
| Stale pod | Selected pod is replaced | Poll refresh sees replacement | Old context is marked stale and replacement context appears when matched | scenario + live-kube |
| Pod get denied | `get pods` is denied but stream can continue | Context panel loads | Panel shows `no_permission`, stream continues, and repair text is copyable | unit + live-kube |
| Partial context | Pod context loads but events or owner chain are unavailable | Context panel loads | Panel shows `partial` with `eventsUnavailableReason` or owner-chain diagnostic | unit + scenario |
| Rollout fallback | Context panel is disabled by feature flag or rollback | User streams direct pod logs | Raw Logs remains usable and no context data is persisted | unit + scenario |

Implementation RFC must define:

```text
- feature flag name and default state
- rollback behavior
- Raw Logs fallback behavior
- tests expected to fail before implementation
```

### Slice B: Incident Triage Loop

Priority: P0.5

Scope:

- source discovery/setup baseline and source validation
- parser/log-schema contract and disposable incident fixture
- investigation health panel
- minimal Failed Requests and Slow Requests findings
- shared finding rail
- copy incident summary with default redaction and no hidden disk write
- permission repair kit
- selector narrowing for too-many-pods

Success metric:

```text
An on-call engineer can reach the first credible failed/slow/error suspect in
under 60 seconds after the app is ready and the disposable incident fixture is
deployed, Ready, and producing documented log files, or understand which source,
parser, permission, or stream gap prevents that result.
```

Acceptance criteria:

| Case | Given | When | Then | Required validation |
| --- | --- | --- | --- | --- |
| Source setup baseline | The chosen MVP source setup mechanism has an APP/ACC/ERR preset or equivalent input | User selects a workload | Supported container/source/file-path choices are surfaced with diagnostics before stream start | unit + scenario |
| First finding | Incident fixture is deployed, Ready, and producing failing and slow rows before the measured flow starts | User selects workload and starts triage after the app is ready | First finding appears under 60 seconds through product e2e and disposable live-kube file-tail validation | scenario + stress + e2e + live-kube |
| Incident start path | The app is ready and a supported alert clue, workload name, or label selector is available | User opens Incident Mode / Start triage | One visible path guides target selection, source confirmation, validation, stream start, health/blind-spot review, finding drilldown, and copy summary with next actions for finding, no-finding, partial, source, permission, and stream states | browser e2e + screenshot/video |
| Realistic corpus | A non-happy-path sample corpus includes realistic field names and mixed structured/unstructured rows | Parser and findings run | Expected findings and no-finding states match the parser contract | unit + scenario |
| Missing source | Selected source path does not exist in one pod | Stream group starts | Target shows missing file path and healthy targets continue | unit + scenario |
| Parser gap | Rows are unstructured or missing status/elapsed fields | Triage runs | UI explains findings are unavailable because parser fields are missing | unit + scenario |
| Healthy no finding | Logs are healthy or no rows match failed/slow criteria | Triage runs | `NoFindingExplanation` distinguishes healthy logs from no matching rows | unit + scenario + e2e |
| Permission repair | Events are RBAC denied | User opens repair kit | Denied scope, apiGroup, resource, and copyable RBAC request are shown | unit + live-kube |
| Too many pods | Selector resolves above hard limit | User starts stream | Narrowing workflow shows pod count, pod list inspection, selector refinement, and available restart/not-ready/newest/node narrowing options | unit + browser e2e |
| Copy summary success | Findings and blind spots exist | User copies summary | Redacted summary includes target, time window, findings, evidence rows, redaction status, and gaps | unit + e2e |
| Copy summary no findings | No finding explanation exists | User previews or copies summary | Summary includes no-finding reason and known blind spots | unit + e2e |
| Copy summary failure | Clipboard write fails or redaction warns | User copies summary | Recoverable `CopyIncidentSummaryState` shows warning or copy failure without hidden disk write | unit + browser e2e |
| Health trust | Streams drop rows or parser failures occur | User watches investigation health | Degraded state, per-stream counters, clock-skew suspicion, and permission gap references update within budget | stress + browser e2e |
| Rollout fallback | Incident triage is disabled by feature flag or rollback | User opens Raw Logs | Direct pod Raw Logs remains available and prior Raw Logs state is not migrated | unit + scenario |

Implementation RFC must define:

```text
- feature flag name and default state
- rollback behavior
- Raw Logs fallback behavior
- tests expected to fail before implementation
- whether `parser_mismatch` was already implemented in Slice A or starts here
```

### Slice C: Investigation Filters MVP

Priority: P1

Scope:

- field facets
- structured filters
- failed/slow filter shortcuts
- SDK snapshot compatibility
- performance budget at existing stress thresholds

Success metric:

```text
An engineer can reduce 50k rows to failed or slow request candidates in under
the existing query p95 budget.
```

Acceptance criteria:

| Case | Given | When | Then | Required validation |
| --- | --- | --- | --- | --- |
| Numeric filter | Rows include `status` and `elapsed` | User applies `status >= 500 AND elapsed > 1000` | Only matching rows remain | unit + scenario |
| Invalid filter | User enters malformed query | Query is submitted | Previous results remain and parse error is shown | unit + browser e2e |
| Facet count | 50k mixed rows are buffered | Facets render | Counts match filtered row base within budget | stress |

### Slice D: First Analysis Tabs

Priority: P1

Scope:

- Failed Requests extension
- Slow Requests extension
- grouped summaries
- export current analysis rows/findings

Success metric:

```text
The default product gives a useful answer before the user writes a custom
extension.
```

Acceptance criteria:

| Case | Given | When | Then | Required validation |
| --- | --- | --- | --- | --- |
| Failed Requests | ACC rows include 5xx responses | User opens Failed Requests | Top failing URLs and samples render | unit + scenario |
| Slow Requests | Rows include elapsed values | User sets threshold | p50/p95/p99 and route groups update | unit + scenario |
| Finding export | Analysis tab has findings | User exports | Findings reference EvidenceRefs with stable row ids and stream identity | unit + e2e |

### Slice E: Investigation Bundle

Priority: P1

Scope:

- bookmarks
- notes
- timeline
- redacted export bundle
- shareable markdown summary

Success metric:

```text
An investigation can be handed to another engineer with enough evidence to
reproduce the path.
```

Acceptance criteria:

| Case | Given | When | Then | Required validation |
| --- | --- | --- | --- | --- |
| Bookmark | User marks rows and adds notes | Session is exported | Notes and EvidenceRefs appear in summary | unit + browser e2e |
| Redaction | Rows contain tokens/emails/IPs | Export preview opens | Redacted output is shown before write | unit + scenario |
| Resume | Local session exists | App restarts | User can resume or clear explicitly | unit + e2e |

### Slice F: AI Analyzer Readiness

Priority: P2

Scope:

- analysis input selection
- redaction preview
- async findings contract
- sample AI analyzer extension

Success metric:

```text
AI analysis produces structured findings with EvidenceRefs and no hidden
data egress.
```

Acceptance criteria:

| Case | Given | When | Then | Required validation |
| --- | --- | --- | --- | --- |
| Context selection | User selects bookmarked rows | AI analysis starts | Only selected redacted rows are sent | unit + scenario |
| Async lifecycle | Analyzer runs slowly | User observes tab | queued/running/succeeded or failed state is visible | unit + browser e2e |
| Finding result | Analyzer returns finding | Finding renders | Evidence row ids point to existing rows | unit |

### Slice G: Third-Party Runtime Extensions

Priority: P2

Scope:

- scaffold
- manifest validation
- runtime local install
- isolated host
- compatibility docs

Success metric:

```text
A third-party developer can build and load a viewer without changing klogcat
source code.
```

Acceptance criteria:

| Case | Given | When | Then | Required validation |
| --- | --- | --- | --- | --- |
| Local install | Extension directory has valid manifest | User enables extension | Tab appears without host source edit | e2e |
| Incompatible protocol | Manifest requests unsupported version | App loads extension | Extension is rejected before execution | unit + e2e |
| Broken extension | Extension throws during render | User opens tab | Raw Logs and other tabs remain usable | unit + browser e2e |

---

## 8. Things Not To Build Yet

Do not chase these until the workbench loop is strong:

- cluster-wide resource management
- deployment scale/restart controls
- port-forward, exec shell, or terminal multiplexing
- full metrics dashboard
- alerting or long-term retention
- centralized log ingestion/storage
- arbitrary cloud observability replacement

Reason:

```text
Those areas are already owned by K9s, Lens, Loki, Datadog, New Relic, and
cloud-native observability stacks. klogcat should integrate with them or
complement them, not dilute itself into a weaker clone.
```

---

## 9. Decision Checklist Before Each Feature

Before accepting a new feature into the roadmap, answer:

```text
1. Does this help a user complete a log investigation faster?
2. Does it preserve Raw Logs as the source of truth?
3. Does it improve or reuse the extension SDK instead of bypassing it?
4. Does it avoid becoming a generic Kubernetes management feature?
5. Can it be tested under the existing stress and pre-push harness?
6. Does it create a reusable investigation artifact or finding?
```

If the answer to 1 is no, the feature should probably not be built.
