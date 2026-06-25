#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const repoRoot = process.cwd()
const allowedLicenseIds = new Set([
  '0BSD',
  'Apache-2.0',
  'Apache-2.0 WITH LLVM-exception',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC-BY-4.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'Unicode-3.0',
  'Unlicense',
  'Zlib',
])

run('npm', ['audit', '--audit-level=high'])
run('cargo', ['audit'], path.join(repoRoot, 'src-tauri'))

const npmViolations = checkNpmLicenses()
const cargoViolations = checkCargoLicenses()
const violations = [...npmViolations, ...cargoViolations]

if (violations.length > 0) {
  console.error('[security-license] License check failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('[security-license] Passed. npm audit, cargo audit, npm licenses, and Rust licenses are acceptable.')

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function checkNpmLicenses() {
  const packageLockPath = path.join(repoRoot, 'package-lock.json')
  const lock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'))
  const violations = []
  for (const [location, pkg] of Object.entries(lock.packages ?? {})) {
    if (!location.startsWith('node_modules/')) continue
    const name = location.replace(/^node_modules\//, '')
    const license = pkg.license
    if (!license) {
      violations.push(`npm:${name} has no license metadata`)
    } else if (!isLicenseExpressionAllowed(license)) {
      violations.push(`npm:${name} uses disallowed license expression "${license}"`)
    }
  }
  return violations
}

function checkCargoLicenses() {
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', '--locked'], {
    cwd: path.join(repoRoot, 'src-tauri'),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  }))
  const violations = []
  for (const pkg of metadata.packages ?? []) {
    if (!pkg.source && pkg.name === 'klogcat') continue
    const license = pkg.license
    if (!license) {
      violations.push(`cargo:${pkg.name}@${pkg.version} has no license metadata`)
    } else if (!isLicenseExpressionAllowed(license)) {
      violations.push(`cargo:${pkg.name}@${pkg.version} uses disallowed license expression "${license}"`)
    }
  }
  return violations
}

function isLicenseExpressionAllowed(expression) {
  return splitOptions(expression).some((option) => {
    const ids = option
      .replace(/[()]/g, ' ')
      .split(/\s+AND\s+|\s*\/\s*/i)
      .map((item) => item.trim())
      .filter(Boolean)
    return ids.length > 0 && ids.every((id) => allowedLicenseIds.has(id))
  })
}

function splitOptions(expression) {
  return expression
    .split(/\s+OR\s+/i)
    .map((item) => item.trim())
    .filter(Boolean)
}
