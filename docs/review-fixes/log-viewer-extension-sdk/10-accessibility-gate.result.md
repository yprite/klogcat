# 10 Accessibility Gate Result

Status: implemented.

Evidence:
- `InvestigationModeSelector` exports tab/panel id helpers and handles ArrowLeft/ArrowRight/Home/End.
- AppShell wraps active viewer in `role=tabpanel`.
- Selector tests assert `aria-controls` and keyboard selection.

Verification:
- Targeted selector tests pass in the full suite.
