# 06 Snapshot Subscription Semantics Plan

Reviewer finding: `getSnapshot` and `subscribe` were too vague for large log streams.

Plan:
- Define v1 as full-snapshot invalidation, not diff streaming.
- Add `LogViewerExtensionChangeEvent` with `reason` and `sequence`.
- Add snapshot counts and host `rowLimit`.
- Document that rows are bounded by host buffer settings.

Completion gate:
- `subscribe` listener receives typed invalidation events.
- Snapshot includes `totalRowCount`, `visibleRowCount`, and `rowLimit`.
