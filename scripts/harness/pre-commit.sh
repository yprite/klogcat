#!/usr/bin/env bash
set -euo pipefail

run() {
  printf '\n[harness:pre-commit] %s\n' "$*"
  "$@"
}

staged_files="$(git diff --cached --name-only --diff-filter=ACMR)"

if [[ -z "$staged_files" ]]; then
  printf '[harness:pre-commit] No staged files. Nothing to check.\n'
  exit 0
fi

printf '[harness:pre-commit] Checking staged files.\n'
run git diff --cached --check

blocked_paths='(^|/)(node_modules|src-tauri/target)/|(^|/)\.DS_Store$'
if printf '%s\n' "$staged_files" | grep -E "$blocked_paths" >/dev/null; then
  printf '\n[harness:pre-commit] Blocked generated/dependency path staged:\n'
  printf '%s\n' "$staged_files" | grep -E "$blocked_paths"
  exit 1
fi

if [[ "${KLOGCAT_ALLOW_DIST:-0}" != "1" ]] && printf '%s\n' "$staged_files" | grep -E '(^|/)dist/' >/dev/null; then
  printf '\n[harness:pre-commit] dist/ is staged. Unstage it unless this is an intentional publishable build-output update.\n'
  printf 'Set KLOGCAT_ALLOW_DIST=1 to allow this commit explicitly.\n'
  printf '%s\n' "$staged_files" | grep -E '(^|/)dist/'
  exit 1
fi

frontend_pattern='^(package\.json|package-lock\.json|tsconfig\.json|vite\.config\.ts|vitest\.config\.ts|src/.*\.(ts|tsx))$'
frontend_test_pattern='^(src/.*\.(ts|tsx))$'
rust_pattern='^(src-tauri/.*\.rs|src-tauri/Cargo\.toml|src-tauri/Cargo\.lock)$'
source_metrics_pattern='^(src/.*\.(ts|tsx)|src-tauri/.*\.rs)$'

if printf '%s\n' "$staged_files" | grep -E "$frontend_pattern" >/dev/null; then
  run npm run lint
  run npm run typecheck
fi

if printf '%s\n' "$staged_files" | grep -E "$frontend_test_pattern" >/dev/null; then
  run npm run test:unit
fi

if printf '%s\n' "$staged_files" | grep -E "$source_metrics_pattern" >/dev/null; then
  run npm run metrics:precommit
fi

if printf '%s\n' "$staged_files" | grep -E "$rust_pattern" >/dev/null; then
  run bash -lc 'cd src-tauri && cargo fmt --check'
  run bash -lc 'cd src-tauri && cargo check'
fi

printf '\n[harness:pre-commit] Passed.\n'
