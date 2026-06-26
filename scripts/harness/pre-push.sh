#!/usr/bin/env bash
set -euo pipefail

tmp_dir=".harness/tmp/prepush-$$"
mkdir -p "$tmp_dir"

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

run() {
  printf '\n[harness:pre-push] %s\n' "$*"
  "$@"
}

run_capture() {
  local name="$1"
  shift
  printf '\n[harness:pre-push] %s\n' "$*"
  set +e
  "$@" 2>&1 | tee "$tmp_dir/$name.out"
  local status="${PIPESTATUS[0]}"
  set -e
  if [[ "$status" -ne 0 ]]; then
    printf '\n[harness:pre-push] Command failed with exit %s: %s\n' "$status" "$*"
    exit "$status"
  fi
}

release_gate=0
while read -r local_ref _local_sha remote_ref _remote_sha; do
  case "$local_ref:$remote_ref" in
    refs/heads/main:*|refs/heads/release/*:*|refs/tags/v*:*)
      release_gate=1
      ;;
  esac
done || true

run git diff --check
run git diff --cached --check

if git grep -n -E '^(<<<<<<< |=======$|>>>>>>> )' -- . >/tmp/klogcat-conflict-markers.$$; then
  printf '\n[harness:pre-push] Conflict markers found in tracked files:\n'
  cat /tmp/klogcat-conflict-markers.$$
  rm -f /tmp/klogcat-conflict-markers.$$
  exit 1
fi
rm -f /tmp/klogcat-conflict-markers.$$

blocked_tracked='(^|/)(node_modules|src-tauri/target)/|(^|/)\.DS_Store$'
if git ls-files | grep -E "$blocked_tracked" >/tmp/klogcat-blocked-tracked.$$; then
  printf '\n[harness:pre-push] Blocked generated/dependency path is tracked:\n'
  cat /tmp/klogcat-blocked-tracked.$$
  rm -f /tmp/klogcat-blocked-tracked.$$
  exit 1
fi
rm -f /tmp/klogcat-blocked-tracked.$$

run_capture typecheck npm run typecheck
run_capture lint npm run lint
run_capture metrics-prepush npm run metrics:prepush
run_capture coverage npm run test:coverage
run_capture security-license npm run security:license
run_capture test-unit npm run test:unit
run_capture test-scenario npm run test:scenario
run_capture test-stress npm run test:stress
run_capture test-e2e npm run test:e2e
run_capture frontend-build npm run build
run_capture rust-fmt bash -lc 'cd src-tauri && cargo fmt --check'
run_capture rust-clippy bash -lc 'cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings'
run_capture rust-test bash -lc 'cd src-tauri && cargo test --all-targets'

if [[ "$release_gate" -eq 1 ]]; then
  run_capture tauri-build npm run tauri build -- --no-bundle
  if [[ ! -x src-tauri/target/release/klogcat ]]; then
    printf '\n[harness:pre-push] Expected release binary was not produced: src-tauri/target/release/klogcat\n'
    exit 1
  fi
fi

run node scripts/harness/prepush-report.mjs --tmp-dir "$tmp_dir" --release-gate "$release_gate"

printf '\n[harness:pre-push] Passed.\n'
