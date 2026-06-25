# klogcat 0.0.6

## UX polish

- Clarifies empty/no-target state with a direct **Choose Target** action in the log pane.
- Disables Start, Stop, Restart, Pause, Clear, Copy, and Export when the current state cannot perform the action.
- Replaces ambiguous idle/ready status copy with target-aware labels such as **Select a target**, **Waiting for target**, **Idle**, and **Streaming**.
- Adds filtered row counts to the export/status footer.

## Streaming backend

- Keeps the existing backend merge/supervisor path: `kubectl exec tail -F` readers feed a central merge worker, ordered by parsed log time with received-time fallback and monotonic sequence tie-breaks.
- Batched `log://lines` events and stream-ended queue flush acknowledgements remain the runtime path for lower frontend event pressure and deterministic stream shutdown.

## Verification checklist

Run before publishing:

```bash
npm run typecheck
npm test -- --run
npm run build
cd src-tauri && cargo fmt -- --check
cd src-tauri && cargo check
cd src-tauri && cargo test
```
