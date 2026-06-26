# 05 SDK Log Row DTO Result

Status: implemented.

Evidence:
- Public DTO: `src/sdk/log-viewer.ts` `SdkLogRow`.
- Adapter: `src/extensions/logViewerSdkAdapter.ts`.
- AppShell uses `toLogViewerExtensionSnapshot`.
- Protocol tests now use `SdkLogRow`, not `ParsedLogLine`.

Verification:
- `npm run typecheck` proves snapshot and extension props no longer expose `ParsedLogLine`.
