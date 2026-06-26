# 02 External Loading Model Plan

Reviewer finding: external package loading did not specify package location, discovery, manifest parsing, activation, or recovery.

Plan:
- Define v1 external extensions as build-time npm/import dependencies only.
- Add `KlogcatExtensionManifest`, `KlogcatExtensionModule`, and `KlogcatExtensionHost` SDK types.
- Add a host loader that validates protocol version, trust level, and capabilities before activation.
- Explicitly defer runtime remote/local arbitrary loading until isolation exists.

Completion gate:
- Fake external module test validates activation and rejection paths.
- Docs state build-time loading only for v1 and describe the manifest/activate shape.
