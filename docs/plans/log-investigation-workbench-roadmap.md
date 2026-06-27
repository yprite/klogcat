# Log Investigation Workbench Roadmap

**Goal:** Make klogcat a Kubernetes log investigation workbench, not a broad
cluster manager and not only a prettier `tail -F` viewer.

**Position:** klogcat complements tools such as K9s, Lens, Stern, Kubetail,
Grafana Loki, and Datadog. Those tools either manage Kubernetes resources,
aggregate logs centrally, or tail many pods well. klogcat should win the local
investigation loop after a service, workload, pod, or incident has been
identified.

**End image:** An engineer can select a workload, stream the relevant pod file
logs, follow pod replacements, pivot through structured fields, bookmark
evidence, run specialized analysis tabs, and export a reproducible
investigation bundle. Third-party extensions can add domain-specific or AI
analysis without depending on klogcat internals.

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
- reducing raw log volume into meaningful slices
- preserving investigation context and evidence
- allowing specialized tabs to turn raw rows into domain-specific insight
- supporting AI analysis with explicit privacy and context boundaries

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
| K9s | Fast terminal resource navigation, logs, exec, port-forward, restart, scale, metrics | Full cluster operations console | Need better workload context around logs: owner, labels, restarts, events, previous pod fallback |
| Lens | GUI Kubernetes IDE, pod/container log views, cluster navigation | Broad Kubernetes IDE scope | Need a clearer desktop investigation flow once the relevant workload is selected |
| Stern | Multi-pod and multi-container tailing, regex pod matching, new pod auto-follow | CLI-first output formatting | Need workload/label-selector stream targets and pod replacement follow |
| Kubetail | Kubernetes log-focused live tail, multi-pod single timeline, browser/terminal modes | Full hosted log viewer product | Need stronger structured analysis, extension tabs, and investigation artifacts |
| Loki/Datadog/New Relic | Indexed search, facets, grouping, dashboards, alert and retention workflows | Centralized observability platform | Need local facets, structured filters, export bundles, and fast raw-to-analysis pivots |

---

## 3. Prioritization Model

Use these priority labels:

```text
P0 = Required to make the workbench position true.
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

---

## 4. Priority Roadmap

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
3. Pod replacement follow:
   - Watch/refresh matching pods.
   - Auto-start streams for new matching pods.
   - Mark old pod streams as ended without losing rows.
4. Previous container logs:
   - Offer a previous-log mode for restarted containers when Kubernetes exposes it.
   - Keep file-tail mode as the main path; previous logs should be explicit.

Completion gates:

```text
- User can select a Deployment and stream logs from all matching pods.
- When a pod disappears and a replacement appears, klogcat follows the new pod.
- Timeline rows keep target context visible.
- Tests cover direct pod mode, workload mode, and pod replacement.
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

Completion gates:

```text
- User can explain whether errors correlate with restarts, scheduling, image,
  or readiness state without leaving klogcat.
- Context panel failures are recoverable and do not block raw logs.
```

Why first:

```text
K9s and Lens win on Kubernetes context. klogcat does not need their full command
surface, but it must bring the context that makes logs interpretable.
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
```

Why second:

```text
This closes the gap with observability products at local scale and gives
extensions better inputs.
```

### P1. First-Party Analysis Tabs

Current gap:

```text
Raw Logs and SDK prove the platform direction, but users need a default
analysis experience before third-party tabs matter.
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

Completion gates:

```text
- At least Failed Requests and Slow Requests ship as extensions using only the
  public SDK.
- Each tab has an empty state, loading/error boundary, and export path.
- Raw Logs remains first and is not coupled to analysis tab internals.
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

Completion gates:

```text
- User can export an investigation bundle and reproduce what was visible.
- Bundle excludes host-only or sensitive fields unless explicitly allowed.
- Extension findings can be included through a public result contract.
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
4. Finding result contract:
   - title
   - severity
   - evidence row ids
   - explanation
   - suggested next checks
   - confidence
5. Async analysis lifecycle:
   - queued/running/succeeded/failed/cancelled
   - progress messages
   - retry with same context

Completion gates:

```text
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

## 5. Suggested Release Slices

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

### Slice B: Investigation Filters MVP

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

### Slice C: First Analysis Tabs

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

### Slice D: Investigation Bundle

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

### Slice E: AI Analyzer Readiness

Priority: P2

Scope:

- analysis input selection
- redaction preview
- async findings contract
- sample AI analyzer extension

Success metric:

```text
AI analysis produces structured findings with evidence row ids and no hidden
data egress.
```

### Slice F: Third-Party Runtime Extensions

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

---

## 6. Things Not To Build Yet

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

## 7. Decision Checklist Before Each Feature

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
