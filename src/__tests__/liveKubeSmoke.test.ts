import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '../..')
const script = path.join(repoRoot, 'scripts/harness/run-live-kube-smoke.mjs')

function runSmoke(env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, [script], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
}

function fakeKubectl() {
  const dir = mkdtempSync(path.join(tmpdir(), 'klogcat-fake-kubectl-'))
  const bin = path.join(dir, 'kubectl')
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.KLOGCAT_FAKE_KUBECTL_LOG, args.join(' ') + '\\n')
if (args.join(' ') === 'version --client') {
  console.log('Client Version: v1.30.0')
  process.exit(0)
}
if (args.join(' ') === 'config current-context') {
  console.log('dev-context')
  process.exit(0)
}
const withoutContext = args[0] === '--context' ? args.slice(2) : args
if (withoutContext[0] === 'auth' && withoutContext[1] === 'can-i') {
  console.log('yes')
  process.exit(0)
}
if (withoutContext[0] === 'get' && withoutContext[1] === 'pods') {
  console.log(JSON.stringify({ items: [{ metadata: { name: 'api-123' }, status: { phase: 'Running' }, spec: { containers: [{ name: 'app' }] } }] }))
  process.exit(0)
}
if (withoutContext[0] === 'logs') {
  console.log('live smoke log line')
  process.exit(0)
}
console.error('unexpected kubectl args: ' + args.join(' '))
process.exit(7)
`)
  spawnSync('chmod', ['+x', bin])
  return { bin, log: path.join(dir, 'kubectl.log') }
}

describe('live kube smoke harness', () => {
  it('skips unless explicitly enabled', () => {
    const result = runSmoke({ KLOGCAT_LIVE_KUBE: undefined })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('status=skipped')
    expect(result.stdout).toContain('KLOGCAT_LIVE_KUBE_not_enabled')
  })

  it('runs read-only can-i, pod discovery, and log attach diagnostics through kubectl', () => {
    const kubectl = fakeKubectl()
    const result = runSmoke({
      KLOGCAT_LIVE_KUBE: '1',
      KLOGCAT_KUBECTL_BIN: kubectl.bin,
      KLOGCAT_TEST_CONTEXT: 'dev-context',
      KLOGCAT_TEST_NAMESPACE: 'payments',
      KLOGCAT_TEST_POD_SELECTOR: 'app=api',
      KLOGCAT_TEST_TIMEOUT_MS: '5000',
      KLOGCAT_LIVE_REQUIRE_LOG_LINE: '1',
      KLOGCAT_FAKE_KUBECTL_LOG: kubectl.log,
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('status=passed')
    expect(result.stdout).toContain('pod=api-123')
    const calls = readFileSync(kubectl.log, 'utf8')
    expect(calls).toContain('--context dev-context auth can-i list pods -n payments')
    expect(calls).toContain('--context dev-context auth can-i get pods/log -n payments')
    expect(calls).toContain('--context dev-context get pods -n payments -l app=api --field-selector=status.phase=Running -o json')
    expect(calls).toContain('--context dev-context logs -n payments api-123 -c app --tail=1')
  })
})
