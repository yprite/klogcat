# 08 Safe Replace Result

Status: implemented.

Evidence:
- `ownerId` is required on extension registration and manifest.
- `registerLogViewerExtension` rejects cross-owner replacement.
- Core id `raw` remains reserved.

Verification:
- `logViewerExtensions.test.tsx` covers duplicate, reserved, cross-owner replace, and same-owner replace.
