# 09 Import Boundary Plan

Reviewer finding: the plan said extensions must not import internals, but no test or lint rule enforced it.

Plan:
- Add ESLint `no-restricted-imports` for `src/extensions/examples/**`.
- Add the same boundary for `src/__tests__/fixtures/external-extensions/**`.
- Block imports from host stores, components, utils, and internal types.
- Keep example extensions on `src/sdk/log-viewer`.
- Keep external fixtures on `src/sdk/log-viewer`.

Completion gate:
- `npm run lint` fails if an example extension or external fixture imports blocked host internals.
