# klogcat Git hook harness gates

This document defines the pass/fail criteria for the local Git hook harness.
The harness is split into two Git events:

- `pre-commit`: fast local checks before a commit is created.
- `pre-push`: full repository checks before commits are pushed.

The goal is to catch deterministic failures early and make the pushed state
fully locally verified. klogcat does not assume an external CI environment, so
`pre-push` is the authoritative local integration gate.

## Scope

klogcat is a Tauri app with two quality surfaces:

- Frontend: React, TypeScript, Vite, Vitest.
- Native shell: Rust, Cargo, Tauri.

Every gate below must be deterministic and must not require network access.
If dependencies are missing, the gate fails with an actionable message rather
than installing packages automatically.

## Common failure criteria

Both `pre-commit` and `pre-push` must fail when any of these are true:

1. A required command exits with a non-zero status.
2. A required tool is missing from `PATH`.
3. Git conflict markers are staged or present in checked files being validated:
   - `<<<<<<<`
   - `=======`
   - `>>>>>>>`
4. Generated or dependency output is staged:
   - `node_modules/`
   - `src-tauri/target/`
   - `.DS_Store`
5. The harness script itself exits before printing the failed command and the
   stage that failed.

`dist/` is allowed only when the change is intentionally updating publishable
frontend build output. If it is staged accidentally, the hook should fail and
ask the developer to unstage it or rerun the release/build workflow explicitly.

## Static code quality metrics

Static code quality metrics are enforced in both hook stages:

- `pre-commit`: changed-code quality gate for early feedback.
- `pre-push`: full repository quality gate for the pushed state.

The metrics gate covers complexity, coupling, maintainability, and dependency
rule violations. The exact tool can change, but the harness contract must stay
stable.

| Metric family | What it catches | Default threshold |
| --- | --- | --- |
| Cyclomatic complexity | Too many independent paths inside a function | Function score must be `<= 10`. |
| Cognitive complexity | Human difficulty of understanding a function | Function score must be `<= 15`. |
| Function length | Functions that are too large to review safely | Function body must be `<= 80` non-blank lines. |
| File length | Files that collect too many responsibilities | Source file must be `<= 500` non-blank lines. |
| Coupling | Modules importing too many unrelated modules | Module coupling score must not exceed the configured baseline. |
| Circular dependency | Cycles between modules or layers | No circular dependency is allowed. |
| Architecture dependency rule | Imports crossing forbidden boundaries | No forbidden import is allowed. |
| Maintainability | Overall maintainability regression | Score must not fall below the configured baseline. |

The frontend coverage gate enforces `100%` line coverage for `src/**/*.ts(x)`.
Statement, function, and branch coverage are tracked as ratcheted baselines so
they cannot regress while historical branch gaps are closed.

The first implementation must record the current repository baseline before
turning baseline-based coupling or maintainability checks into hard failures.
After that baseline is recorded, the gate fails on any regression.

Metric reports must be written to an ignored local path such as:

```text
.harness/reports/
```

Reports are diagnostic output only. A hook passes or fails based on command exit
status and threshold checks, not on whether a report file exists.

## pre-push audit reports

Because klogcat does not assume an external CI system, every successful
`pre-push` run must write an audit report under:

```text
docs/reports/<timestamp>-prepush-<git-short-sha>/
```

Example:

```text
docs/reports/20260625T143347+0900-prepush-a1b2c3d/
```

The report ID format is:

```text
<YYYYMMDD>T<HHMMSS><timezone-offset>-prepush-<git-short-sha>
```

The report directory must include:

| File | Purpose |
| --- | --- |
| `summary.md` | Human-readable pre-push result with quality, test, build, and Git metadata. |
| `summary.json` | Machine-readable summary. |
| `quality-metrics.json` | Full static code quality metrics copied from the metrics gate. |
| `test-results.json` | Parsed test metrics grouped into `unit`, `scenario`, and `e2e` layers. |
| `command-results.json` | Command pass/fail metadata and log paths. |
| `logs/*.out` | Raw command output captured during the gate. |

The report is generated only after all required `pre-push` checks pass. Failed
push attempts may leave temporary logs under `.harness/tmp/`, but they must not
create a successful audit report under `docs/reports/`.

The hook must not automatically stage or commit report files. If a report should
be preserved in Git history, the developer stages it explicitly.

## Test layers

Tests are grouped into three layers:

| Layer | Default command | File selection | pre-commit | pre-push |
| --- | --- | --- | --- | --- |
| Unit | `npm run test:unit` and Rust `cargo test --all-targets` | `src/__tests__/**/*.test.ts(x)` except scenario/e2e files; Rust unit tests from Cargo | Runs for relevant frontend staged files | Required |
| Scenario | `npm run test:scenario` | files under `src/**/scenario*/` or files named `*.scenario.*` | Not required | Required; may report `skipped` when no scenario tests exist |
| E2E | `npm run test:e2e` | files under `e2e/`, `src/**/e2e/`, or files named `*.e2e.*` | Not required | Required; may report `skipped` when no e2e tests exist |

The `pre-push` report must show the status of all three layers, even when a
layer has no test files yet. Missing scenario or e2e tests are reported as
`skipped`, not silently omitted.

## pre-commit gate

`pre-commit` is a fast correctness gate. It should validate the files that are
about to be committed and avoid expensive package builds.

### Required checks

The commit passes only when all applicable checks pass:

| Changed files | Required checks | Pass criteria |
| --- | --- | --- |
| Any staged file | Conflict marker scan | No staged file contains conflict markers. |
| Any staged file | Generated-file scan | No blocked generated/dependency path is staged. |
| `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `src/**/*.ts`, `src/**/*.tsx` | `npm run typecheck` | TypeScript exits `0`. |
| `package.json`, `package-lock.json`, `eslint.config.js`, `src/**/*.ts`, `src/**/*.tsx`, `scripts/**/*.js`, `scripts/**/*.mjs` | `npm run lint` | ESLint exits `0`. |
| `src/**/*.test.ts`, `src/**/*.test.tsx`, `src/**/*.spec.ts`, `src/**/*.spec.tsx`, or source files under `src/` | Frontend unit tests | Vitest exits `0`. |
| `src/**/*.ts`, `src/**/*.tsx`, `src-tauri/**/*.rs` | Changed-code static quality metrics | Complexity, function length, file length, and local dependency rules pass for changed source files. |
| `src-tauri/**/*.rs`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` | `cargo fmt --check` from `src-tauri/` | rustfmt exits `0`. |
| `src-tauri/**/*.rs`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` | `cargo check` from `src-tauri/` | Cargo check exits `0`. |

### Recommended command mapping

When the harness scripts are implemented, these commands should be the default
pre-commit checks:

```bash
npm run lint
npm run typecheck
npm test -- --run
npm run metrics:precommit
(cd src-tauri && cargo fmt --check)
(cd src-tauri && cargo check)
```

The frontend and Rust commands should run only when relevant staged files are
present. If only documentation changes are staged, `pre-commit` should run only
the common staged-file checks.

### Explicit non-goals

`pre-commit` must not run these by default:

- `npm run build`
- `npm run tauri build`
- `cargo clippy`
- full release packaging

Those checks belong to `pre-push` or release validation. Static code quality
metrics still run in `pre-commit`, but they should be scoped to changed source
files where possible.

## pre-push gate

`pre-push` is the full local integration gate. It validates that the repository
is in a pushable state, not just that the latest staged files are acceptable.

### Required checks

The push passes only when every command below exits `0`:

| Surface | Required command | Pass criteria |
| --- | --- | --- |
| Frontend type safety | `npm run typecheck` | TypeScript exits `0`. |
| Frontend lint | `npm run lint` | ESLint exits `0`. |
| Frontend tests | `npm test` | All Vitest tests pass. |
| Frontend coverage | `npm run test:coverage` | All frontend tests pass and line coverage is `100%`; statement/function/branch coverage cannot regress below the configured baseline. |
| Frontend production build | `npm run build` | `tsc` and Vite production build both exit `0`. |
| Full static code quality metrics | `npm run metrics:prepush` | Complexity, coupling, circular dependency, architecture rule, and maintainability checks pass for the full repository. |
| Security and license | `npm run security:license` | npm audit has no high vulnerabilities, cargo audit has no vulnerabilities, and npm/Rust dependency licenses match the allowlist. |
| Rust formatting | `(cd src-tauri && cargo fmt --check)` | rustfmt reports no changes needed. |
| Rust static analysis | `(cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings)` | Clippy exits `0` with warnings treated as errors. |
| Rust tests | `(cd src-tauri && cargo test --all-targets)` | All Rust tests pass. |
| Audit report | `node scripts/harness/prepush-report.mjs ...` | `docs/reports/<id>/` contains summary, quality metrics, test metrics, command results, and raw logs. |

### Release or protected branch checks

For pushes to `main`, `release/*`, or a version tag, the harness should also
run a Tauri packaging check:

```bash
npm run tauri build -- --no-bundle
```

Pass criteria:

1. The command exits `0`.
2. The expected release binary is produced under `src-tauri/target/release/`.
3. No generated build artifact is automatically staged by the hook.

The full bundled installer build, `npm run tauri build` without `-- --no-bundle`,
is a release workflow gate and should not be required for every ordinary push.

## Bypass policy

Bypassing hooks with `--no-verify` is allowed only for emergency or work-in-
progress handoff commits. A bypassed commit is not considered quality-gated.

Before merging or publishing, the developer must run the equivalent push gate
manually:

```bash
npm run typecheck
npm run metrics:prepush
npm test
npm run build
(cd src-tauri && cargo fmt --check)
(cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings)
(cd src-tauri && cargo test --all-targets)
```

## Required package scripts

The harness expects these scripts to exist in `package.json`:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "metrics:precommit": "scripts/harness/metrics-pre-commit.sh",
    "metrics:prepush": "scripts/harness/metrics-pre-push.sh",
    "harness:precommit": "scripts/harness/pre-commit.sh",
    "harness:prepush": "scripts/harness/pre-push.sh"
  }
}
```

Existing scripts already cover:

```json
{
  "scripts": {
    "build": "tsc && vite build",
    "test": "vitest run",
    "tauri": "tauri"
  }
}
```

## Done criteria for harness implementation

The harness implementation is complete only when all of these are true:

1. `.githooks/pre-commit` delegates to `scripts/harness/pre-commit.sh`.
2. `.githooks/pre-push` delegates to `scripts/harness/pre-push.sh`.
3. `git config core.hooksPath .githooks` is documented or automated for local
   setup.
4. `npm run harness:precommit` can be run manually and matches the Git
   `pre-commit` behavior.
5. `npm run harness:prepush` can be run manually and matches the Git `pre-push`
   behavior.
6. The scripts print the failing stage and command before exiting non-zero.
7. `npm run metrics:precommit` runs a changed-code metrics gate for staged
   source files.
8. `npm run metrics:prepush` runs the full repository metrics gate.
9. Successful `pre-push` runs create `docs/reports/<timestamp>-prepush-<git-short-sha>/`.
10. Documentation-only commits do not run frontend, Rust, or metrics build/test commands
   during `pre-commit`.
11. `pre-push` runs the full repository gate regardless of which files changed.
