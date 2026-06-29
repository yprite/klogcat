# Slice A Workload Follow MVP Implementation Plan

Status: ready-for-initial-implementation
Roadmap link: `docs/plans/log-investigation-workbench-roadmap.md#slice-a-workload-follow-mvp`

## Scope

In scope:

- Add the `workbench.workloadFollow.enabled` feature flag, defaulting off outside development.
- Preserve direct pod Raw Logs as the fallback path.
- Add typed target-mode contracts for `pod`, `workload`, and `labelSelector` without enabling Service targets.
- Add workload/selector resolution behind the flag.
- Start one stream group from multiple resolved pod/source targets.
- Track per-target status and stream identity for context, namespace, pod, container, source type, and file path.
- Poll selected workloads for pod replacement; start replacement streams as new stream segments.
- Block stream start above the hard stream-target limit and surface narrowing data.

Out of scope:

- Service target support. Service names produce `unsupported_service_target` handoff only.
- `kubectl logs` stdout/previous logs.
- Cross-namespace search or fleet-wide indexed search.
- AI analysis, extension-provided source discovery, and export bundles.
- Full incident triage findings from Slice B.

## Compatibility

Preserved `docs/DESIGN.md` rules:

- klogcat tails pod-internal APP/ACC/ERR files through `kubectl exec tail -F`.
- Raw Logs remains the source of truth.
- Direct pod Raw Logs remains available when the flag is off or workload resolution fails.
- Persisted source keys remain `info`, `access`, and `error`; display labels stay separate.

Superseded or extended rules:

- Target selection can represent a workload or bounded label selector, but resolved stream targets still become pod-internal file tails.
- Stream state becomes a stream group with per-target status instead of a single selected pod stream only.

Migration/rollback:

- The feature flag defaults off outside development.
- No existing settings migration is required for the first flag contract because absent `workbench` settings resolve to all flags disabled.
- Rollback is disabling `workbench.workloadFollow.enabled`; direct pod Raw Logs keeps working.

SDK impact:

- `klogcat.logViewer@1` remains unchanged for the initial flag/target-contract slice.
- Any later extension-visible stream-group snapshots require a separate SDK protocol note.

## User Surfaces

- Target picker:
  - normal: direct pod selection remains visible; workload and label-selector controls appear only when the flag is enabled.
  - empty: direct pod CTA remains available.
  - loading: context/namespace/pod loading states remain unchanged; workload loading gets its own state when added.
  - partial-success: direct pod mode remains usable when workload list is denied.
  - permission-denied: workload target mode shows RBAC warning and repair hint; pod mode remains enabled if pod list works.
  - stale-resource: resolved pods that disappear are marked stale and replacement polling can create new stream segments.
  - fatal error: selection failure does not hide Raw Logs fallback.

- Raw Logs stream controls:
  - Start resolves the selected target mode to stream targets.
  - Stop cancels all active targets in the stream group.
  - Restart creates a new stream group generation.

## Kubernetes Contract

Every selected-target command must use structured argv with explicit context and namespace.

- List contexts: `kubectl config get-contexts -o name`
- List namespaces: `kubectl --context <context> get namespaces -o json`
- List pods by namespace: `kubectl --context <context> get pods -n <namespace> -o json`
- List pods by selector: `kubectl --context <context> get pods -n <namespace> -l <selector> -o json`
- List workloads: `kubectl --context <context> get deploy,statefulset,daemonset,replicaset -n <namespace> -o json`
- Start file stream: `kubectl --context <context> exec -n <namespace> <pod> -c <container> -- tail -n <lines> -F <filePath>`

RBAC fallbacks:

- `list namespaces` denied: show namespace-list warning, allow manual/recent namespace entry, then validate namespace-scoped pod access.
- `list pods` denied: disable pod/workload target mode for that namespace and show repair text.
- workload list denied: keep direct pod mode available with warning.
- selector syntax error: show selector-specific error before stream start.

Selector rules:

- `TargetMode = 'pod' | 'workload' | 'labelSelector'`.
- Deployment/StatefulSet/DaemonSet/ReplicaSet use `.spec.selector.matchLabels` only when no `matchExpressions` exist.
- Any `matchExpressions` returns `unsupported_selector` until exact expression serialization is implemented.
- Service targets use Option A: `unsupported_service_target` with handoff to workload or selector.

## Log Source Contract

- Source setup uses existing persisted settings/log policy path and built-in `scloud` policy.
- `SourceLogType` remains `info | access | error`.
- Each resolved stream target is `pod × container × source/filePath`.
- Source validation distinguishes missing container, missing file path, unreadable file path, tail unavailable, shell unavailable, permission denied, no rows yet, parser mismatch, and generic command failure as implementation grows.

## Parser and Fixture Contract

Slice A does not claim failed/slow/error findings. It only preserves row collection and raw timeline behavior. Parser mismatch may be surfaced as source validation but full finding rules start in Slice B unless a later Slice A sub-plan explicitly includes the minimum parser contract.

## Data Contract

Initial DTOs:

```ts
export type WorkbenchFeatureFlagName =
  | 'workbench.workloadFollow.enabled'
  | 'workbench.kubernetesContext.enabled'
  | 'workbench.incidentTriage.enabled'

export type WorkbenchFeatureFlags = Record<WorkbenchFeatureFlagName, boolean>
export type TargetMode = 'pod' | 'workload' | 'labelSelector'
```

Future Slice A DTOs:

- `LogTargetRef`
- `ResolvedStreamTarget`
- `StreamGroupState`
- `StreamTargetStatus`
- `SourceValidationState`
- `StreamEndReason`

## Performance Budget

- Soft limit: 20 active stream targets per stream group.
- Hard limit: 50 active stream targets.
- Poll interval: 5 seconds by default.
- Existing Raw Logs buffer limits remain enforced.
- Above hard limit, Start is blocked with pod count, pod list inspection, selector refinement, and available narrowing hints.

## Privacy and Security

- No new disk writes for workload follow state in the initial flag/target-contract slice.
- Clipboard/export/network boundaries are unchanged.
- Diagnostic commands are rendered from structured argv and redacted before copy when needed.
- Raw Kubernetes objects do not cross persistence/export/SDK boundaries.

## Tests

Expected RED tests before implementation:

- `src/__tests__/workbenchFeatureFlags.test.ts`
  - defaults all three workbench flags off outside development.
  - allows development defaults to be enabled explicitly.
  - settings validation accepts the default workbench flag object.
  - settings validation rejects unknown workbench flag keys and non-boolean values.
- Later Slice A tests:
  - workload target mode is hidden when the flag is disabled.
  - service target paste returns `unsupported_service_target`.
  - workload with `matchExpressions` returns `unsupported_selector`.
  - hard stream-target limit blocks Start and exposes narrowing data.

Validation commands:

- `npm test -- --run src/__tests__/workbenchFeatureFlags.test.ts`
- `npm run typecheck`
- `npm run lint`
- Before merging the complete slice: `npm run push -- origin <branch>` plus live-kube validation when implemented.

## Rollout

- Feature flags:
  - `workbench.workloadFollow.enabled`
  - `workbench.kubernetesContext.enabled`
  - `workbench.incidentTriage.enabled`
- Default state:
  - off outside development.
  - development may opt in explicitly for local dogfood.
- Rollback:
  - disable the flag and keep direct pod Raw Logs available.
