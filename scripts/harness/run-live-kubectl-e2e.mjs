#!/usr/bin/env node
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import readline from 'node:readline'
import { spawn, spawnSync } from 'node:child_process'
import { chromium } from '@playwright/test'
import { createE2eArtifactDir, relativeToRepo } from './e2e-artifacts.mjs'

const repoRoot = process.cwd()
const artifactDir = createE2eArtifactDir('live-kubectl')
const enabled = process.env.KLOGCAT_LIVE_KUBECTL_E2E === '1'
const dryRun = process.env.KLOGCAT_LIVE_DRY_RUN === '1'
const keep = process.env.KLOGCAT_LIVE_KEEP === '1'
const namespace = process.env.KLOGCAT_LIVE_NAMESPACE || 'klogcat-e2e'
const pod = process.env.KLOGCAT_LIVE_POD || `klogcat-live-${Date.now().toString(36)}`
const container = process.env.KLOGCAT_LIVE_CONTAINER || 'app'
const image = process.env.KLOGCAT_LIVE_IMAGE || 'alpine:3.20'
const context = process.env.KLOGCAT_LIVE_CONTEXT || ''
const logPath = process.env.KLOGCAT_LIVE_LOG_PATH || `/scloud/${namespace}/logs/${pod}/${namespace}.log`
const consoleEvents = []
const pageErrors = []
const created = { namespace: false, pod: false }
let devServer
let browser
let tailProcess
let page

console.log(`[live-kubectl-e2e] status=running artifacts=${relativeToRepo(artifactDir)}`)

try {
  if (!enabled) {
    writeSummary({ status: 'skipped', reason: 'Set KLOGCAT_LIVE_KUBECTL_E2E=1 to run against a live Kubernetes cluster.' })
    console.log('[live-kubectl-e2e] status=skipped reason=KLOGCAT_LIVE_KUBECTL_E2E_not_enabled')
    process.exit(0)
  }

  assertLogPath(logPath)
  const plan = { context: context || '(current)', namespace, pod, container, image, logPath, dryRun }
  fs.writeFileSync(path.join(artifactDir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`)
  if (dryRun) {
    writeSummary({ status: 'passed', mode: 'dry-run', plan })
    console.log(`[live-kubectl-e2e] status=passed mode=dry-run artifacts=${relativeToRepo(artifactDir)}`)
    process.exit(0)
  }

  assertCommand('kubectl')
  ensureNamespace()
  createLogPod()
  waitForPodReady()
  ensureLogFile()

  const port = await findFreePort()
  devServer = startVite(['--host', '127.0.0.1', '--port', String(port), '--strictPort'], 'vite-dev')
  await waitForHttp(`http://127.0.0.1:${port}/`)

  browser = await chromium.launch()
  const contextBrowser = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: artifactDir, size: { width: 1440, height: 900 } } })
  page = await contextBrowser.newPage()
  page.on('console', (message) => consoleEvents.push({ type: message.type(), text: message.text() }))
  page.on('pageerror', (error) => pageErrors.push({ message: error.message, stack: error.stack }))
  await installTauriBridge(page)
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' })
  await page.getByText('klogcat').waitFor()
  await chooseLiveTargetAndStart(page)
  await waitForTailReady()

  const token = `klogcat-live-e2e-${Date.now().toString(36)}`
  const lines = [
    `${new Date().toISOString()} ${token} first dummy line from kubectl exec`,
    `${new Date().toISOString()} ${token} second dummy line from pod file append`,
    `${new Date().toISOString()} ${token} third dummy line visible in viewer`,
  ]
  for (const line of lines) appendLineInPod(line)

  await page.getByText(token, { exact: false }).first().waitFor({ timeout: 20_000 })
  await waitForRowsCount(page, (count) => count.total >= lines.length, 'live kubectl lines to appear in viewer')
  for (const line of lines) await page.getByText(line, { exact: false }).waitFor({ timeout: 10_000 })

  await page.screenshot({ path: path.join(artifactDir, 'live-kubectl-final.png'), fullPage: true })
  await writeBrowserArtifacts(page, 'live-kubectl')
  await contextBrowser.close()
  await renameRecordedVideo('live-kubectl')

  const seriousConsoleErrors = consoleEvents.filter((event) => event.type === 'error')
  if (seriousConsoleErrors.length > 0 || pageErrors.length > 0) {
    throw new Error(`browser console/page errors detected: console=${seriousConsoleErrors.length} page=${pageErrors.length}`)
  }

  writeSummary({ status: 'passed', plan, appendedLines: lines, artifacts: relativeToRepo(artifactDir) })
  console.log(`[live-kubectl-e2e] status=passed tests=1 artifacts=${relativeToRepo(artifactDir)}`)
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(artifactDir, 'live-kubectl-failure.png'), fullPage: true }).catch(() => undefined)
    await writeBrowserArtifacts(page, 'failure').catch(() => undefined)
  }
  writeSummary({ status: 'failed', error: messageFor(error) })
  console.error(`[live-kubectl-e2e] status=failed tests=1 artifacts=${relativeToRepo(artifactDir)} error=${messageFor(error)}`)
  process.exitCode = 1
} finally {
  if (tailProcess && !tailProcess.killed) tailProcess.kill('SIGTERM')
  await browser?.close().catch(() => undefined)
  if (devServer && !devServer.killed) devServer.kill('SIGTERM')
  if (!keep && enabled && !dryRun) cleanupKubernetes()
}

function kubectlBaseArgs() {
  return context ? ['--context', context] : []
}

function runKubectl(args, options = {}) {
  const result = spawnSync('kubectl', [...kubectlBaseArgs(), ...args], {
    cwd: repoRoot,
    shell: false,
    encoding: 'utf8',
    ...options,
  })
  fs.appendFileSync(path.join(artifactDir, 'kubectl.log'), `$ kubectl ${[...kubectlBaseArgs(), ...args].join(' ')}\n${result.stdout ?? ''}${result.stderr ?? ''}\n`)
  if (result.status !== 0) {
    throw new Error(`kubectl ${args.join(' ')} failed with exit ${result.status}: ${(result.stderr || result.stdout || '').trim()}`)
  }
  return result.stdout ?? ''
}

function ensureNamespace() {
  const exists = spawnSync('kubectl', [...kubectlBaseArgs(), 'get', 'namespace', namespace], { encoding: 'utf8' })
  if (exists.status === 0) return
  runKubectl(['create', 'namespace', namespace])
  created.namespace = true
}

function createLogPod() {
  const existing = spawnSync('kubectl', [...kubectlBaseArgs(), 'get', 'pod', pod, '-n', namespace, '-o', 'jsonpath={.metadata.labels.klogcat/e2e-run}'], { encoding: 'utf8' })
  if (existing.status === 0) throw new Error(`refusing to reuse or delete existing pod ${namespace}/${pod}; choose a unique KLOGCAT_LIVE_POD or omit it`)
  const manifest = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: pod, namespace, labels: { app: 'klogcat-live-e2e', 'klogcat/e2e': 'live-stream', 'klogcat/e2e-run': pod } },
    spec: {
      restartPolicy: 'Never',
      containers: [{
        name: container,
        image,
        command: ['sh', '-c', `mkdir -p ${shellQuote(path.posix.dirname(logPath))} && touch ${shellQuote(logPath)} && trap 'exit 0' TERM INT; tail -f /dev/null`],
      }],
    },
  }
  runKubectl(['apply', '-f', '-'], { input: `${JSON.stringify(manifest)}\n` })
  created.pod = true
}

function waitForPodReady() {
  runKubectl(['wait', '--for=condition=Ready', `pod/${pod}`, '-n', namespace, '--timeout=90s'])
}

function ensureLogFile() {
  runKubectl(['exec', '-n', namespace, pod, '-c', container, '--', 'sh', '-c', 'mkdir -p "$1" && touch "$2"', 'sh', path.posix.dirname(logPath), logPath])
}

function startKubectlTail(request) {
  if (request.namespace !== namespace || request.pod !== pod || request.container !== container) {
    throw new Error(`start_log_stream requested unexpected target ${request.namespace}/${request.pod}/${request.container}`)
  }
  if (request.filePath !== logPath) {
    throw new Error(`start_log_stream requested unexpected file path ${request.filePath}; expected ${logPath}`)
  }
  const args = [
    ...kubectlBaseArgs(), 'exec', '-n', namespace, pod, '-c', container, '--',
    'sh', '-c', 'tail -n 0 -F "$1" 2>/tmp/klogcat-live-tail.err || tail -n 0 -f "$1"', 'sh', request.filePath,
  ]
  const child = spawn('kubectl', args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
  captureProcessOutput(child, artifactDir, 'kubectl-tail')
  const reader = readline.createInterface({ input: child.stdout })
  reader.on('line', (raw) => emitTauriEvent('log://lines', { emittedAt: Date.now(), lines: [{ streamId: request.streamId, sourceType: request.sourceType, raw, receivedAt: Date.now() }] }).catch((error) => {
    fs.appendFileSync(path.join(artifactDir, 'viewer-emit-errors.log'), `${messageFor(error)}\n`)
  }))
  child.on('exit', (code, signal) => {
    fs.appendFileSync(path.join(artifactDir, 'kubectl-tail.exit.log'), `code=${code} signal=${signal ?? ''}\n`)
    void emitTauriEvent('log://exit', { streamId: request.streamId, exitCode: code, signal, requestedStop: false }).catch(() => undefined)
  })
  tailProcess = child
  return child
}

async function waitForTailReady() {
  const sentinel = `klogcat-live-tail-ready-${Date.now().toString(36)}`
  appendLineInPod(sentinel)
  await page.getByText(sentinel, { exact: false }).first().waitFor({ timeout: 20_000 })
  if (tailProcess.exitCode !== null) throw new Error(`kubectl tail exited early with code ${tailProcess.exitCode}`)
}

function appendLineInPod(line) {
  runKubectl(['exec', '-n', namespace, pod, '-c', container, '--', 'sh', '-c', 'printf "%s\\n" "$1" >> "$2"', 'sh', line, logPath])
}

async function installTauriBridge(activePage) {
  await activePage.exposeFunction('__klogcatLiveInvoke', (cmd, args) => handleTauriInvoke(cmd, args))
  await activePage.addInitScript(() => {
    globalThis.isTauri = true
    globalThis.__TAURI_E2E_CALLBACKS__ = {}
    globalThis.__TAURI_E2E_EVENTS__ = {}
    globalThis.__TAURI_E2E_NEXT_CALLBACK_ID__ = 1
    globalThis.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener(event, eventId) {
        globalThis.__TAURI_E2E_EVENTS__[event] = (globalThis.__TAURI_E2E_EVENTS__[event] || []).filter((id) => id !== eventId)
      },
    }
    globalThis.__TAURI_INTERNALS__ = {
      transformCallback(callback, once = false) {
        const id = globalThis.__TAURI_E2E_NEXT_CALLBACK_ID__++
        globalThis.__TAURI_E2E_CALLBACKS__[id] = { callback, once }
        return id
      },
      unregisterCallback(id) {
        delete globalThis.__TAURI_E2E_CALLBACKS__[id]
      },
      convertFileSrc(filePath) { return filePath },
      invoke(cmd, args) { return globalThis.__klogcatLiveInvoke(cmd, args ?? {}) },
    }
  })
}

async function handleTauriInvoke(cmd, args = {}) {
  if (cmd === 'get_settings') return { settings: liveSettings() }
  if (cmd === 'save_settings') return args.settings
  if (cmd === 'reset_settings') return liveSettings()
  if (cmd === 'get_current_context') return context || 'klogcat-live-context'
  if (cmd === 'list_contexts') return { contexts: [{ name: context || 'klogcat-live-context' }] }
  if (cmd === 'list_namespaces') return { namespaces: [{ name: namespace }] }
  if (cmd === 'list_pods') return { pods: [{ name: pod, namespace, phase: 'Running', containers: [container] }] }
  if (cmd === 'check_log_path') return { exists: args.request?.filePath === logPath }
  if (cmd === 'start_log_stream') {
    startKubectlTail(args.request)
    await emitTauriEvent('log://started', { streamId: args.request.streamId })
    return undefined
  }
  if (cmd === 'stop_log_stream' || cmd === 'stop_all_log_streams') {
    if (tailProcess && !tailProcess.killed) tailProcess.kill('SIGTERM')
    return undefined
  }
  if (cmd === 'plugin:event|listen') return registerTauriEventListener(args.event, args.handler)
  if (cmd === 'plugin:event|unlisten') return unregisterTauriEventListener(args.event, args.eventId)
  throw new Error(`unexpected Tauri invoke command in live e2e: ${cmd}`)
}

function liveSettings() {
  return {
    schemaVersion: 1,
    language: 'en',
    initialTailLines: 0,
    bufferLimit: 50_000,
    logPolicyId: 'scloud',
    logSources: {
      info: { container, filePath: logPath },
      access: { container, filePath: logPath },
      error: { container, filePath: logPath },
    },
  }
}

async function registerTauriEventListener(event, handler) {
  await page.evaluate(({ event, handler }) => {
    globalThis.__TAURI_E2E_EVENTS__[event] = globalThis.__TAURI_E2E_EVENTS__[event] || []
    globalThis.__TAURI_E2E_EVENTS__[event].push(handler)
  }, { event, handler })
  return handler
}

async function unregisterTauriEventListener(event, eventId) {
  await page.evaluate(({ event, eventId }) => {
    globalThis.__TAURI_E2E_EVENTS__[event] = (globalThis.__TAURI_E2E_EVENTS__[event] || []).filter((id) => id !== eventId)
  }, { event, eventId })
}

async function emitTauriEvent(event, payload) {
  if (!page) return
  await page.evaluate(({ event, payload }) => {
    const ids = globalThis.__TAURI_E2E_EVENTS__[event] || []
    for (const id of ids) {
      const entry = globalThis.__TAURI_E2E_CALLBACKS__[id]
      if (!entry) continue
      entry.callback({ event, id, payload })
      if (entry.once) delete globalThis.__TAURI_E2E_CALLBACKS__[id]
    }
  }, { event, payload })
}

async function chooseLiveTargetAndStart(activePage) {
  await activePage.getByRole('button', { name: 'Choose Target' }).click()
  await activePage.getByRole('dialog', { name: /select log targets/i }).waitFor()
  await activePage.getByLabel(`${context || 'klogcat-live-context'} / ${namespace} / ${pod}`).check()
  await activePage.getByRole('button', { name: 'Close' }).click()
  await activePage.getByRole('button', { name: 'Start', exact: true }).click()
  await activePage.getByText('Running', { exact: false }).first().waitFor({ timeout: 10_000 })
}

async function readRowsCount(activePage) {
  const text = await activePage.locator('body').innerText()
  const matches = [...text.matchAll(/Rows:\s*(\d+)\/(\d+)/gi)]
  if (matches.length === 0) throw new Error(`Rows count not found in page text: ${text.slice(0, 500)}`)
  const last = matches.at(-1)
  return { filtered: Number(last[1]), total: Number(last[2]) }
}

async function waitForRowsCount(activePage, predicate, description) {
  const deadline = Date.now() + 20_000
  let lastCount
  while (Date.now() < deadline) {
    try {
      lastCount = await readRowsCount(activePage)
      if (predicate(lastCount)) return lastCount
    } catch {
      // Poll while first live rows render.
    }
    await activePage.waitForTimeout(100)
  }
  throw new Error(`Timed out waiting for ${description}; last=${JSON.stringify(lastCount)}`)
}

function cleanupKubernetes() {
  try {
    if (created.pod) runKubectl(['delete', 'pod', pod, '-n', namespace, '--ignore-not-found=true', '--wait=false'])
    if (created.namespace) runKubectl(['delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=false'])
  } catch (error) {
    console.error(`[live-kubectl-e2e] cleanup warning: ${messageFor(error)}`)
  }
}

function startVite(args, logName) {
  const child = spawn(path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite'), args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
  captureProcessOutput(child, artifactDir, logName)
  return child
}

function captureProcessOutput(child, dir, name) {
  const stdout = fs.createWriteStream(path.join(dir, `${name}.stdout.log`))
  const stderr = fs.createWriteStream(path.join(dir, `${name}.stderr.log`))
  child.stdout?.pipe(stdout)
  child.stderr?.pipe(stderr)
}

async function writeBrowserArtifacts(activePage, label) {
  fs.writeFileSync(path.join(artifactDir, `${label}.html`), await activePage.content())
  fs.writeFileSync(path.join(artifactDir, `${label}.console.json`), `${JSON.stringify({ consoleEvents, pageErrors }, null, 2)}\n`)
}

async function renameRecordedVideo(label) {
  const videos = fs.readdirSync(artifactDir).filter((file) => file.endsWith('.webm'))
  if (videos.length === 0) throw new Error(`missing recorded ${label} video artifact`)
  const newest = videos.map((file) => ({ file, mtimeMs: fs.statSync(path.join(artifactDir, file)).mtimeMs })).sort((a, b) => b.mtimeMs - a.mtimeMs)[0].file
  fs.renameSync(path.join(artifactDir, newest), path.join(artifactDir, `${label}.webm`))
}

function assertCommand(command) {
  const result = spawnSync(command, ['version', '--client'], { encoding: 'utf8' })
  if (result.error?.code === 'ENOENT') throw new Error(`${command} is required for live kubectl e2e but was not found on PATH`)
}

function assertLogPath(input) {
  if (!input.startsWith('/')) throw new Error(`KLOGCAT_LIVE_LOG_PATH must be absolute, got ${input}`)
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
    server.on('error', reject)
  })
}

async function waitForHttp(url) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await httpOk(url)) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`dev server did not become ready: ${url}`)
}

async function httpOk(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume()
      resolve(response.statusCode >= 200 && response.statusCode < 500)
    })
    request.on('error', () => resolve(false))
    request.setTimeout(1500, () => {
      request.destroy()
      resolve(false)
    })
  })
}

function writeSummary(summary) {
  fs.writeFileSync(path.join(artifactDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function messageFor(error) {
  return error instanceof Error ? error.message : String(error)
}
