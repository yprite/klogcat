#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createE2eArtifactDir, relativeToRepo } from './e2e-artifacts.mjs'

const repoRoot = process.cwd()
const artifactDir = createE2eArtifactDir('desktop')
const binary = path.join(repoRoot, 'src-tauri', 'target', 'release', process.platform === 'win32' ? 'klogcat.exe' : 'klogcat')

console.log(`[desktop-e2e] status=running artifacts=${relativeToRepo(artifactDir)}`)

try {
  runBuild()
  assertExecutable(binary)
  const launch = await launchSmoke(binary)
  fs.writeFileSync(path.join(artifactDir, 'desktop-smoke.json'), `${JSON.stringify(launch, null, 2)}\n`)
  console.log(`[desktop-e2e] status=passed tests=2 artifacts=${relativeToRepo(artifactDir)}`)
} catch (error) {
  fs.writeFileSync(path.join(artifactDir, 'desktop-error.txt'), messageFor(error))
  console.error(`[desktop-e2e] status=failed tests=2 artifacts=${relativeToRepo(artifactDir)} error=${messageFor(error)}`)
  process.exit(1)
}

function runBuild() {
  const result = spawnSync('npm', ['run', 'tauri', 'build', '--', '--no-bundle'], {
    cwd: repoRoot,
    shell: process.platform === 'win32',
    encoding: 'utf8',
  })
  fs.writeFileSync(path.join(artifactDir, 'tauri-build.stdout.log'), result.stdout ?? '')
  fs.writeFileSync(path.join(artifactDir, 'tauri-build.stderr.log'), result.stderr ?? '')
  if (result.status !== 0) throw new Error(`tauri build failed with exit ${result.status ?? 'unknown'}`)
}

function assertExecutable(file) {
  if (!fs.existsSync(file)) throw new Error(`release binary missing: ${relativeToRepo(file)}`)
  if (process.platform !== 'win32' && (fs.statSync(file).mode & 0o111) === 0) {
    throw new Error(`release binary is not executable: ${relativeToRepo(file)}`)
  }
}

async function launchSmoke(file) {
  const emptyPathDir = path.join(artifactDir, 'empty-path')
  fs.mkdirSync(emptyPathDir, { recursive: true })
  const stdout = fs.createWriteStream(path.join(artifactDir, 'binary.stdout.log'))
  const stderr = fs.createWriteStream(path.join(artifactDir, 'binary.stderr.log'))
  const child = spawn(file, [], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: emptyPathDir, KLOGCAT_DEBUG: '1' },
  })
  child.stdout?.pipe(stdout)
  child.stderr?.pipe(stderr)

  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      settled = true
      child.kill('SIGTERM')
      resolve({ launched: true, survivedMs: 2500, terminatedBySmoke: true })
    }, 2500)
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    child.on('exit', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (code === 0) resolve({ launched: true, exitedEarly: true, code, signal })
      else reject(new Error(`release binary exited before smoke timeout code=${code} signal=${signal ?? ''}`))
    })
  })
}

function messageFor(error) {
  return error instanceof Error ? error.message : String(error)
}
