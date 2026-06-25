#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const steps = [
  ['npm', ['run', 'build']],
  ['node', ['scripts/harness/run-test-layer.mjs', 'e2e']],
  ['node', ['scripts/harness/run-browser-e2e.mjs']],
  ['node', ['scripts/harness/run-desktop-e2e.mjs']],
]

for (const [command, args] of steps) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
