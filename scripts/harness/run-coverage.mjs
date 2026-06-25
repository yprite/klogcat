#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const repoRoot = process.cwd()
const reportsDir = path.join(repoRoot, '.harness', 'coverage', 'all')
const summaryPath = path.join(reportsDir, 'coverage-summary.json')
const baselinePath = path.join(repoRoot, 'scripts', 'harness', 'coverage-baseline.json')
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))

const vitestBin = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vitest.cmd' : 'vitest')
if (!fs.existsSync(vitestBin)) {
  console.error('[coverage] missing vitest binary')
  process.exit(1)
}

const result = spawnSync(vitestBin, [
  'run',
  '--coverage',
  '--coverage.provider=v8',
  '--coverage.reporter=text',
  '--coverage.reporter=json-summary',
  `--coverage.reportsDirectory=${path.relative(repoRoot, reportsDir)}`,
  '--coverage.include=src/**/*.{ts,tsx}',
  '--coverage.exclude=src/**/*.test.{ts,tsx}',
  '--coverage.exclude=src/__tests__/**',
  '--coverage.exclude=src/vite-env.d.ts',
], {
  cwd: repoRoot,
  stdio: 'inherit',
})

if (result.status !== 0) process.exit(result.status ?? 1)
if (!fs.existsSync(summaryPath)) {
  console.error(`[coverage] missing summary: ${path.relative(repoRoot, summaryPath)}`)
  process.exit(1)
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')).total
const thresholds = baseline.thresholds
const failures = []
for (const metric of ['lines', 'statements', 'functions', 'branches']) {
  const actual = summary[metric]?.pct
  const threshold = thresholds[metric]
  if (typeof actual !== 'number') {
    failures.push(`${metric}: missing actual coverage`)
  } else if (actual < threshold) {
    failures.push(`${metric}: ${actual}% < ${threshold}%`)
  }
}

if (failures.length > 0) {
  console.error('[coverage] Failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`[coverage] Passed. lines=${summary.lines.pct}% statements=${summary.statements.pct}% functions=${summary.functions.pct}% branches=${summary.branches.pct}%`)
