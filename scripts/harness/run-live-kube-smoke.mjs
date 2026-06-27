#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createE2eArtifactDir, relativeToRepo } from './e2e-artifacts.mjs'

const repoRoot = process.cwd()
const artifactDir = createE2eArtifactDir('live-kube-smoke')
const enabled = process.env.KLOGCAT_LIVE_KUBE === '1'
const kubectlBin = process.env.KLOGCAT_KUBECTL_BIN || 'kubectl'
const requestedContext = process.env.KLOGCAT_TEST_CONTEXT || ''
const namespace = process.env.KLOGCAT_TEST_NAMESPACE || ''
const selector = process.env.KLOGCAT_TEST_POD_SELECTOR || ''
const requestedContainer = process.env.KLOGCAT_TEST_CONTAINER || ''
const timeoutMs = Number(process.env.KLOGCAT_TEST_TIMEOUT_MS || 30_000)
const requireLogLine = process.env.KLOGCAT_LIVE_REQUIRE_LOG_LINE === '1'
const diagnostics = {
  status: 'running',
  mode: 'read-only-live-kube-smoke',
  artifactDir: relativeToRepo(artifactDir),
  env: {
    context: requestedContext || '(current)',
    namespace: namespace || '(missing)',
    selector: selector || '(missing)',
    container: requestedContainer || '(first container)',
    requireLogLine,
    timeoutMs,
  },
  kubectl: [],
  canI: {},
  discovery: {},
  logAttach: {},
}

console.log(`[live-kube-smoke] status=running artifacts=${relativeToRepo(artifactDir)}`)

try {
  if (!enabled) {
    finish('skipped', { reason: 'Set KLOGCAT_LIVE_KUBE=1 to run read-only diagnostics against the local kubeconfig.' })
    console.log('[live-kube-smoke] status=skipped reason=KLOGCAT_LIVE_KUBE_not_enabled')
    process.exit(0)
  }

  assertRequiredEnv()
  assertCommand()

  const actualContext = requestedContext || runKubectl(['config', 'current-context']).stdout.trim()
  diagnostics.env.context = actualContext

  diagnostics.canI.listNamespaces = canI(['list', 'namespaces'], actualContext)
  diagnostics.canI.listPods = canI(['list', 'pods', '-n', namespace], actualContext)
  diagnostics.canI.watchPods = canI(['watch', 'pods', '-n', namespace], actualContext)
  diagnostics.canI.getPodLogs = canI(['get', 'pods/log', '-n', namespace], actualContext)

  if (!diagnostics.canI.listPods.allowed) {
    throw new Error(`kubectl auth can-i list pods -n ${namespace} returned no; target discovery cannot be trusted`)
  }
  if (!diagnostics.canI.getPodLogs.allowed) {
    throw new Error(`kubectl auth can-i get pods/log -n ${namespace} returned no; log streaming will be blocked by RBAC`)
  }

  const podsJson = runKubectl([
    ...contextArgs(actualContext),
    'get', 'pods',
    '-n', namespace,
    '-l', selector,
    '--field-selector=status.phase=Running',
    '-o', 'json',
  ]).stdout
  fs.writeFileSync(path.join(artifactDir, 'pods.json'), podsJson)
  const pods = parsePods(podsJson)
  diagnostics.discovery.runningPodCount = pods.length
  diagnostics.discovery.selector = selector
  if (pods.length === 0) {
    throw new Error(`no Running pods found in namespace=${namespace} selector=${selector}`)
  }

  const selectedPod = pods[0]
  const selectedContainer = requestedContainer || selectedPod.containers[0]
  if (!selectedContainer) throw new Error(`selected pod ${selectedPod.name} has no containers`)
  diagnostics.discovery.selectedPod = selectedPod.name
  diagnostics.discovery.selectedContainer = selectedContainer

  const logs = runKubectl([
    ...contextArgs(actualContext),
    'logs',
    '-n', namespace,
    selectedPod.name,
    '-c', selectedContainer,
    '--tail=1',
  ])
  diagnostics.logAttach.exitCode = logs.status
  diagnostics.logAttach.stdoutBytes = logs.stdout.length
  diagnostics.logAttach.stderrBytes = logs.stderr.length
  fs.writeFileSync(path.join(artifactDir, 'kubectl-logs-tail.txt'), logs.stdout)
  if (requireLogLine && logs.stdout.trim().length === 0) {
    throw new Error(`kubectl logs attached to ${namespace}/${selectedPod.name}/${selectedContainer} but returned no line; unset KLOGCAT_LIVE_REQUIRE_LOG_LINE to allow quiet pods`)
  }

  finish('passed')
  console.log(`[live-kube-smoke] status=passed context=${actualContext} namespace=${namespace} pod=${selectedPod.name} container=${selectedContainer} artifacts=${relativeToRepo(artifactDir)}`)
} catch (error) {
  finish('failed', { error: messageFor(error) })
  console.error(`[live-kube-smoke] status=failed artifacts=${relativeToRepo(artifactDir)} error=${messageFor(error)}`)
  process.exitCode = 1
}

function assertRequiredEnv() {
  const missing = []
  if (!namespace) missing.push('KLOGCAT_TEST_NAMESPACE')
  if (!selector) missing.push('KLOGCAT_TEST_POD_SELECTOR')
  if (missing.length > 0) throw new Error(`missing required env: ${missing.join(', ')}`)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error(`KLOGCAT_TEST_TIMEOUT_MS must be positive, got ${process.env.KLOGCAT_TEST_TIMEOUT_MS}`)
}

function assertCommand() {
  const result = spawnSync(kubectlBin, ['version', '--client'], { cwd: repoRoot, encoding: 'utf8', timeout: timeoutMs })
  recordKubectl(['version', '--client'], result)
  if (result.error?.code === 'ENOENT') throw new Error(`${kubectlBin} is required but was not found on PATH`)
  if (result.status !== 0) throw new Error(`${kubectlBin} version --client failed: ${(result.stderr || result.stdout || '').trim()}`)
}

function contextArgs(context) {
  return context ? ['--context', context] : []
}

function runKubectl(args) {
  const result = spawnSync(kubectlBin, args, { cwd: repoRoot, encoding: 'utf8', timeout: timeoutMs })
  recordKubectl(args, result)
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`kubectl ${args.join(' ')} failed with exit ${result.status}: ${(result.stderr || result.stdout || '').trim()}`)
  }
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function canI(args, context) {
  const kubectlArgs = [...contextArgs(context), 'auth', 'can-i', ...args]
  const result = spawnSync(kubectlBin, kubectlArgs, { cwd: repoRoot, encoding: 'utf8', timeout: timeoutMs })
  recordKubectl(kubectlArgs, result)
  const stdout = result.stdout ?? ''
  return {
    allowed: result.status === 0 && stdout.split(/\r?\n/).some((line) => line.trim().toLowerCase() === 'yes'),
    status: result.status,
    stdout: stdout.trim(),
    stderr: (result.stderr ?? '').trim(),
    error: result.error ? messageFor(result.error) : undefined,
  }
}

function parsePods(input) {
  let data
  try {
    data = JSON.parse(input)
  } catch (error) {
    throw new Error(`invalid kubectl get pods json: ${messageFor(error)}`, { cause: error })
  }
  return (data.items || []).map((item) => ({
    name: item?.metadata?.name,
    phase: item?.status?.phase || 'Unknown',
    containers: (item?.spec?.containers || []).map((container) => container.name).filter(Boolean),
  })).filter((pod) => pod.name && pod.phase === 'Running')
}

function recordKubectl(args, result) {
  const entry = {
    command: `${kubectlBin} ${args.join(' ')}`,
    status: result.status,
    stdout: truncate(result.stdout ?? ''),
    stderr: truncate(result.stderr ?? ''),
    error: result.error ? messageFor(result.error) : undefined,
  }
  diagnostics.kubectl.push(entry)
  fs.appendFileSync(path.join(artifactDir, 'kubectl.log'), `$ ${entry.command}\n${result.stdout ?? ''}${result.stderr ?? ''}\n`)
}

function finish(status, extra = {}) {
  diagnostics.status = status
  Object.assign(diagnostics, extra)
  fs.writeFileSync(path.join(artifactDir, 'summary.json'), `${JSON.stringify(diagnostics, null, 2)}\n`)
}

function truncate(value) {
  const text = String(value).trim()
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text
}

function messageFor(error) {
  return error instanceof Error ? error.message : String(error)
}
