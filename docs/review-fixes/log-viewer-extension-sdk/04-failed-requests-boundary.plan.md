# 04 Failed Requests Boundary Plan

Reviewer finding: `FailedRequestsView` still imported `useLogStore` and policy internals, so it did not prove an extension can work through SDK inputs only.

Plan:
- Remove the host component version from `src/components`.
- Recreate failed-request behavior under `src/extensions/examples`.
- Make it consume only `LogViewerExtensionProps`, `snapshot`, and SDK row fields.
- Register it through a sample extension module in tests.

Completion gate:
- Failed Requests example imports no stores/components/utils/types.
- Tests render the example with SDK snapshots, not host stores.
