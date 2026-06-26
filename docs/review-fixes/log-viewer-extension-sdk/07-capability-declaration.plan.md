# 07 Capability Declaration Plan

Reviewer finding: capabilities were promised but missing from registration and manifest shapes.

Plan:
- Add `requestedCapabilities` to registration and manifest types.
- Require `logs.read` for every log viewer extension.
- Reject unknown capabilities in registry and loader.

Completion gate:
- Registry tests cover missing `logs.read` and unknown capabilities.
- Loader tests cover unknown capability rejection before activation.
