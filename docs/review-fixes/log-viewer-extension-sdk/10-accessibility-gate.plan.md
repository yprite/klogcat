# 10 Accessibility Gate Plan

Reviewer finding: the accessibility gate only required roles and missed keyboard and tabpanel semantics.

Plan:
- Add stable tab and panel ids.
- Wire `aria-controls` and `aria-labelledby`.
- Add arrow/Home/End keyboard navigation.
- Wrap active viewer in `role=tabpanel`.

Completion gate:
- Selector tests cover aria metadata and keyboard movement.
- AppShell renders active extension content inside a tabpanel.
