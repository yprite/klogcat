# 03 Capability And Trust Boundary Plan

Reviewer finding: capabilities were described like a security boundary even though same-context extensions can still use globals and imports.

Plan:
- Treat same-context bundled extensions as trusted code.
- Keep capabilities as SDK method grants, not as a sandbox.
- Add `trustLevel` to manifest/registration.
- Document that untrusted runtime extensions require iframe/webview/worker isolation, message passing, CSP, and separate Tauri capabilities.

Completion gate:
- SDK calls throw when a capability is not granted.
- Docs do not claim same-context capabilities are a security sandbox.
