# 07 Capability Declaration Result

Status: implemented.

Evidence:
- `requestedCapabilities` is required on `LogViewerExtension` and `KlogcatExtensionManifest`.
- Registry validation rejects missing `logs.read`.
- Loader validation rejects unknown capabilities.

Verification:
- `logViewerExtensions.test.tsx` and `logViewerExtensionLoader.test.tsx` cover these paths.
