# klogcat v0.0.2 smoke test

1. Confirm `kubectl config current-context` works.
2. Start the app with `npm run tauri dev`.
3. Confirm current context is displayed or an actionable error is shown.
4. Select a namespace.
5. Select a Running pod.
6. Open Settings and verify APP/ACC/ERR container/file mappings plus initial tail and buffer limits.
7. Start APP tail and verify rows arrive from `kubectl exec ... tail -n <N> -F <file>`.
8. Type a grep query and confirm rows filter without a process restart.
9. Toggle Auto-scroll off, wait for new rows, and confirm scroll position is preserved.
10. Toggle Auto-scroll on and confirm app scrolls to newest visible row.
11. Pause, wait for logs, Resume, and confirm visible rows recompute.
12. Clear and confirm the stream continues and Auto-scroll setting is preserved.
13. Stop and confirm the process exits without error.
14. Switch APP/ACC/ERR and confirm no automatic restart occurs.
15. Start ACC or ERR and validate rendered rows include display time and trace fields when present.
16. Set a nonexistent but absolute file path and confirm stderr warning / non-zero exit behavior.
17. Try invalid paths (relative, empty, null byte) and confirm validation blocks before spawn.
