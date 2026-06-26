# 06 Snapshot Subscription Semantics Result

Status: implemented.

Evidence:
- `LogViewerExtensionChangeEvent` exists in `src/sdk/log-viewer.ts`.
- AppShell emits `log-state` and `target-state` snapshot events.
- `LogViewerExtensionSnapshot` includes row counts and `rowLimit`.

Verification:
- Protocol tests assert subscription event delivery.
