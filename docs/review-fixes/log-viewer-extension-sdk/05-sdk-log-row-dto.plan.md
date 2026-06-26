# 05 SDK Log Row DTO Plan

Reviewer finding: the SDK exposed internal `ParsedLogLine`, freezing parser internals and exposing host-only fields.

Plan:
- Define `SdkLogRow` in the public SDK.
- Add a host adapter from `ParsedLogLine` to `SdkLogRow`.
- Exclude host-only fields such as `filePath`.
- Keep documented scalar fields under `fields` for custom viewers.

Completion gate:
- `LogViewerExtensionSnapshot` uses `SdkLogRow`.
- AppShell converts store rows through the adapter before invoking extensions.
