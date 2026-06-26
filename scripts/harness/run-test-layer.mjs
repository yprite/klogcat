#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const repoRoot = process.cwd()
const argv = process.argv.slice(2)
const layer = argv[0]
const coverageEnabled = argv.includes('--coverage')

if (!['unit', 'scenario', 'stress', 'e2e'].includes(layer)) {
  console.error('[test-layer] usage: run-test-layer.mjs <unit|scenario|stress|e2e>')
  process.exit(1)
}

const files = selectFiles(layer)

if (files.length === 0) {
  console.log(`[test-layer] layer=${layer} status=skipped files=0 tests=0 reason=no-${layer}-tests`)
  process.exit(0)
}

const vitestBin = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vitest.cmd' : 'vitest')
if (!fs.existsSync(vitestBin)) {
  console.error(`[test-layer] layer=${layer} status=failed reason=missing-vitest`)
  process.exit(1)
}

console.log(`[test-layer] layer=${layer} status=running files=${files.length}${coverageEnabled ? ' coverage=enabled' : ''}`)
const coverageArgs = coverageEnabled
  ? [
      '--coverage',
      '--coverage.provider=v8',
      '--coverage.reporter=text',
      '--coverage.reporter=json-summary',
      `--coverage.reportsDirectory=.harness/coverage/${layer}`,
      '--coverage.include=src/**/*.{ts,tsx}',
      '--coverage.exclude=src/**/*.test.{ts,tsx}',
      '--coverage.exclude=src/__tests__/**',
      '--coverage.exclude=src/vite-env.d.ts',
    ]
  : []
const result = spawnSync(vitestBin, ['run', ...coverageArgs, ...files], {
  cwd: repoRoot,
  stdio: 'inherit',
})

if (result.status === 0) {
  console.log(`[test-layer] layer=${layer} status=passed files=${files.length}`)
} else {
  console.error(`[test-layer] layer=${layer} status=failed files=${files.length} exit=${result.status ?? 'unknown'}`)
}

process.exit(result.status ?? 1)

function selectFiles(targetLayer) {
  const allTests = [
    ...listMatchingFiles(path.join(repoRoot, 'src'), /\.(test|spec)\.(ts|tsx)$/),
    ...listMatchingFiles(path.join(repoRoot, 'e2e'), /\.(test|spec)\.(ts|tsx)$/),
    ...listMatchingFiles(path.join(repoRoot, 'tests'), /\.(test|spec)\.(ts|tsx)$/),
  ].map((file) => normalize(path.relative(repoRoot, file))).sort()

  if (targetLayer === 'unit') {
    return allTests.filter((file) => file.startsWith('src/__tests__/')
      && !file.includes('/scenarios/')
      && !file.includes('/scenario/')
      && !file.includes('/stress/')
      && !file.includes('/e2e/')
      && !file.includes('.scenario.')
      && !file.includes('.stress.')
      && !file.includes('.e2e.'))
  }

  if (targetLayer === 'scenario') {
    return allTests.filter((file) => file.includes('/scenarios/')
      || file.includes('/scenario/')
      || file.includes('.scenario.'))
  }

  if (targetLayer === 'stress') {
    return allTests.filter((file) => file.includes('/stress/')
      || file.includes('.stress.'))
  }

  return allTests.filter((file) => file.startsWith('e2e/')
    || file.includes('/e2e/')
    || file.includes('.e2e.'))
}

function listMatchingFiles(dir, pattern) {
  if (!fs.existsSync(dir)) return []
  const files = []
  walk(dir, files, pattern)
  return files
}

function walk(dir, files, pattern) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, files, pattern)
    } else if (entry.isFile() && pattern.test(entry.name)) {
      files.push(fullPath)
    }
  }
}

function normalize(file) {
  return file.split(path.sep).join('/')
}
