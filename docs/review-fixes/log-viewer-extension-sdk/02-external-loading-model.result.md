# 02 External Loading Model Result

Status: implemented for v1 build-time modules.

Evidence:
- Loader: `src/extensions/logViewerExtensionLoader.ts`.
- Build-time discovery/config path: `src/extensions/configuredLogViewerExtensions.ts`.
- Public module/manifest types: `src/sdk/log-viewer.ts`.
- Fake module test: `src/__tests__/logViewerExtensionLoader.test.tsx`.
- External package fixture: `src/__tests__/fixtures/external-extensions/latencyPackage.tsx`.
- Docs state runtime remote loading and arbitrary local plugin directories are out of scope until isolation exists.
- Docs define activation order, failure recovery, and cleanup order.

Verification:
- Loader tests cover valid activation, unsupported protocol version, and unknown capability rejection.
- Loader tests cover configured module ordering, continue-on-failure behavior, reverse cleanup order, and external package fixture activation.
