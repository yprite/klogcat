# 08 Safe Replace Plan

Reviewer finding: `replace=true` allowed accidental or malicious extension takeover.

Plan:
- Add stable `ownerId`.
- Permit replacement only when the existing extension and replacement have the same `ownerId`.
- Keep core ids reserved and non-replaceable.

Completion gate:
- Registry test proves cross-owner replacement is rejected.
- Same-owner replacement remains available for development/HMR style flows.
