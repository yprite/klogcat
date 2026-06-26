#!/usr/bin/env bash
set -euo pipefail

for arg in "$@"; do
  if [ "$arg" = "--no-verify" ]; then
    printf '%s\n' "policy violation: git push --no-verify is not allowed in this repository."
    printf '%s\n' "Use: npm run push -- [git args] (without --no-verify)."
    exit 1
  fi
done

exec git push "$@"
