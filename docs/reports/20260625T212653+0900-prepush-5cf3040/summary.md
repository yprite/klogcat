# klogcat pre-push report

| Field | Value |
| --- | --- |
| Report ID | `20260625T212653+0900-prepush-5cf3040` |
| Status | `passed` |
| Generated at | `2026-06-25T12:26:53.614Z` |
| Branch | `feat/logcat-query-suggestions` |
| HEAD | `5cf3040` |
| Release gate | `skipped` |

## Software quality static metrics

| Metric | Value |
| --- | ---: |
| Source files | 91 |
| Functions | 337 |
| Max cyclomatic complexity | 96 |
| Max cognitive complexity | 419 |
| Max function lines | 703 |
| Max file lines | 943 |
| Max coupling | 13 |
| Min maintainability | 0 |
| Circular dependencies | 0 |
| Architecture violations | 0 |
| Violations | 0 |

## Test metrics

| Layer | Status | Passed | Total | Notes |
| --- | --- | ---: | ---: | --- |
| Unit | `passed` | 181 | 181 | frontend + Rust cargo tests |
| Scenario | `passed` | 23 | 23 |  |
| E2E | `passed` | 6 | 6 | vitest + browser + desktop |

## E2E subchecks

| Check | Status | Passed | Total | Artifacts |
| --- | --- | ---: | ---: | --- |
| Vitest contract | `passed` | 3 | 3 | n/a |
| Real browser | `passed` | 1 | 1 | [`20260625T122630548Z-97109-browser`](e2e-artifacts/20260625T122630548Z-97109-browser) |
| Desktop binary | `passed` | 2 | 2 | [`20260625T122632081Z-97127-desktop`](e2e-artifacts/20260625T122632081Z-97127-desktop) |

## Build and static checks

| Check | Status |
| --- | --- |
| TypeScript typecheck | `passed` |
| Frontend build | `passed` |
| Rust fmt | `passed` |
| Rust clippy | `passed` |
| Tauri build | `skipped` |

## Frontend build assets

| Asset | Size kB | Gzip kB |
| --- | ---: | ---: |
| `dist/index.html` | 0.39 | 0.26 |
| `dist/assets/index-C6pUuFzN.css` | 19.85 | 4.98 |
| `dist/assets/App-DYsi4aGh.js` | 105.53 | 30.51 |
| `dist/assets/index-FFHQQtA8.js` | 202.05 | 63.77 |

## Logs

- `frontend-build`: [logs/frontend-build.out](logs/frontend-build.out)
- `metrics-prepush`: [logs/metrics-prepush.out](logs/metrics-prepush.out)
- `rust-clippy`: [logs/rust-clippy.out](logs/rust-clippy.out)
- `rust-fmt`: [logs/rust-fmt.out](logs/rust-fmt.out)
- `rust-test`: [logs/rust-test.out](logs/rust-test.out)
- `test-e2e`: [logs/test-e2e.out](logs/test-e2e.out)
- `test-scenario`: [logs/test-scenario.out](logs/test-scenario.out)
- `test-unit`: [logs/test-unit.out](logs/test-unit.out)
- `typecheck`: [logs/typecheck.out](logs/typecheck.out)
