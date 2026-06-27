#!/usr/bin/env node
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from '@playwright/test'
import { createE2eArtifactDir, relativeToRepo } from './e2e-artifacts.mjs'

const repoRoot = process.cwd()
const artifactDir = createE2eArtifactDir('browser')
const consoleEvents = []
const pageErrors = []
let preview
let devServer
let browser

const label = {
  settings: /^(Settings|설정)$/,
  save: /^(Save|저장)$/,
  changeTargets: /^(Change Targets|대상 변경)$/,
  chooseTarget: /^(Choose Target|대상 선택)$/,
  selectLogTargets: /^(Select Log Targets|로그 대상 선택)$/,
  noSelectablePodsLoaded: /^(No selectable pods loaded|선택 가능한 Pod를 불러오지 못함)$/,
  close: /^(Close|닫기)$/,
  failedRequests: /^(Failed Requests|실패 요청)$/,
  rawLogs: /^(Raw Logs|원본 로그)$/,
  start: /^(Start|시작)$/,
  startUnavailable: /Start: unavailable \(Select namespace and pod\)|시작: 사용 불가 \(Namespace와 Pod 선택\)/,
  filterUrl: /^(Filter url|필터 url)$/,
  filterStatus: /^(Filter status|필터 status)$/,
  filterTrId: /^(Filter trId|필터 trId)$/,
}

console.log(`[browser-e2e] status=running artifacts=${relativeToRepo(artifactDir)}`)

try {
  assertProductionAssets()
  const port = await findFreePort()
  preview = startVite(['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], 'vite-preview')
  await waitForHttp(`http://127.0.0.1:${port}/`)

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('console', (message) => {
    const event = { type: message.type(), text: message.text(), source: 'production-smoke' }
    consoleEvents.push(event)
  })
  page.on('pageerror', (error) => pageErrors.push({ message: error.message, stack: error.stack, source: 'production-smoke' }))

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' })
  await page.getByText('klogcat').waitFor()
  await page.getByRole('button', { name: label.settings }).click()
  await page.getByRole('heading', { name: label.settings }).waitFor()
  await page.getByRole('button', { name: label.save }).click()
  const chooseTarget = page.getByRole('button', { name: label.chooseTarget })
  const changeTargets = page.getByRole('button', { name: label.changeTargets })
  if (await chooseTarget.count()) await chooseTarget.first().click()
  else await changeTargets.click()
  await page.getByRole('dialog', { name: label.selectLogTargets }).waitFor()
  await page.getByText(label.noSelectablePodsLoaded).waitFor()
  await page.getByRole('button', { name: label.close }).click()
  const failedRequestsTabCount = await page.getByRole('tab', { name: label.failedRequests }).count()
  if (failedRequestsTabCount !== 0) throw new Error('Failed Requests should not be a core production tab')
  await page.getByRole('tab', { name: label.rawLogs }).waitFor()
  await page.getByRole('button', { name: label.start }).waitFor({ state: 'visible' })
  await page.getByText(label.startUnavailable).waitFor()

  await page.screenshot({ path: path.join(artifactDir, 'browser-final.png'), fullPage: true })
  await writeBrowserArtifacts(page, 'production')

  await runMockStreamingBrowserE2e(browser)

  const seriousConsoleErrors = consoleEvents.filter((event) => event.type === 'error')
  if (seriousConsoleErrors.length > 0 || pageErrors.length > 0) {
    throw new Error(`browser console/page errors detected: console=${seriousConsoleErrors.length} page=${pageErrors.length}`)
  }

  console.log(`[browser-e2e] status=passed tests=2 artifacts=${relativeToRepo(artifactDir)}`)
} catch (error) {
  try {
    if (browser) {
      const pages = browser.contexts().flatMap((context) => context.pages())
      const page = pages[0]
      if (page) {
        await page.screenshot({ path: path.join(artifactDir, 'browser-failure.png'), fullPage: true }).catch(() => undefined)
        await writeBrowserArtifacts(page, 'failure').catch(() => undefined)
      }
    }
  } finally {
    console.error(`[browser-e2e] status=failed tests=2 artifacts=${relativeToRepo(artifactDir)} error=${messageFor(error)}`)
    process.exitCode = 1
  }
} finally {
  await browser?.close().catch(() => undefined)
  if (preview && !preview.killed) preview.kill('SIGTERM')
  if (devServer && !devServer.killed) devServer.kill('SIGTERM')
}

function startVite(args, logName) {
  const child = spawn(
    path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite'),
    args,
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  captureProcessOutput(child, artifactDir, logName)
  return child
}

async function runMockStreamingBrowserE2e(activeBrowser) {
  const devPort = await findFreePort()
  devServer = startVite(['--host', '127.0.0.1', '--port', String(devPort), '--strictPort'], 'vite-dev')
  await waitForHttp(`http://127.0.0.1:${devPort}/`)

  const context = await activeBrowser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: artifactDir, size: { width: 1440, height: 900 } },
  })
  const page = await context.newPage()
  page.on('console', (message) => {
    const event = { type: message.type(), text: message.text(), source: 'mock-streaming' }
    consoleEvents.push(event)
  })
  page.on('pageerror', (error) => pageErrors.push({ message: error.message, stack: error.stack, source: 'mock-streaming' }))

  await page.goto(`http://127.0.0.1:${devPort}/`, { waitUntil: 'networkidle' })
  await page.getByText('klogcat').waitFor()

  await injectMockLogStream(page)
  await waitForRowsCount(page, (count) => count.total > 0, 'mock rows to start streaming')
  const earlyCount = await readRowsCount(page)
  await waitForRowsCount(page, (count) => count.total > earlyCount.total, 'mock rows to continue streaming')
  await waitForRowsCount(page, (count) => count.total === 80 && count.filtered === 80, 'all mock rows to stream')
  await page.getByLabel(label.filterUrl).waitFor()
  await assertCompactRowSpacing(page)
  await page.screenshot({ path: path.join(artifactDir, 'mock-stream-rows.png'), fullPage: true })

  await assertAutoScrolledToBottom(page)

  await page.getByLabel(label.filterUrl).fill('/api/')
  const urlFiltered = await waitForRowsCount(page, (count) => count.filtered > 0 && count.filtered < count.total, 'url column filter to narrow rows')

  await page.getByLabel(label.filterStatus).fill('2')
  await waitForRowsCount(page, (count) => count.total === urlFiltered.total && count.filtered > 0 && count.filtered < urlFiltered.filtered, 'status column filter to narrow rows further')

  await page.getByLabel(label.filterStatus).fill('')
  await waitForRowsCount(page, (count) => count.filtered === urlFiltered.filtered && count.total === urlFiltered.total, 'status filter clear to restore url-filtered rows')

  await page.getByLabel(label.filterTrId).fill('mock-tr-1')
  await waitForRowsCount(page, (count) => count.total === urlFiltered.total && count.filtered > 0 && count.filtered < urlFiltered.filtered, 'trId column filter to narrow rows')

  await page.screenshot({ path: path.join(artifactDir, 'mock-stream-filtered.png'), fullPage: true })
  await writeBrowserArtifacts(page, 'mock-stream')
  await context.close()
  await renameRecordedVideo('mock-streaming')
}

async function injectMockLogStream(page) {
  await page.evaluate(async () => {
    const storeMod = await import('/src/stores/logStore.ts')
    const mockMod = await import('/src/utils/mockLogStream.ts')
    const streamId = 'browser-e2e-mock-access-stream'
    const meta = {
      streamId,
      sourceId: `mock/${streamId}/access`,
      sourceType: 'access',
      context: 'ctx-e2e',
      namespace: 'mock-ns',
      pod: 'mock-api-7d9c8f6b8d-x2abc',
      container: 'app',
      filePath: '/scloud/mock-ns/logs/mock-api-7d9c8f6b8d-x2abc/mock-ns_ACC.log',
      initialTailLines: 50,
    }
    const store = storeMod.useLogStore.getState()
    store.prepareStarting(meta)
    store.markRunning(streamId)
    const batch = mockMod.generateMockLogStreamBatch({ streamId, sourceType: 'access', count: 80, seed: 7 })
    let index = 0
    window.__browserE2eMockInterval = window.setInterval(() => {
      const next = batch.lines.slice(index, index + 4)
      index += next.length
      if (next.length > 0) storeMod.useLogStore.getState().appendLines(next)
      if (index >= batch.lines.length) window.clearInterval(window.__browserE2eMockInterval)
    }, 100)
  })
}

async function readRowsCount(page) {
  const text = await page.locator('body').innerText()
  const matches = [...text.matchAll(/Rows:\s*(\d+)\/(\d+)/gi)]
  if (matches.length === 0) throw new Error(`Rows count not found in page text: ${text.slice(0, 500)}`)
  const last = matches.at(-1)
  return { filtered: Number(last[1]), total: Number(last[2]) }
}

async function waitForRowsCount(page, predicate, description) {
  const deadline = Date.now() + 10_000
  let lastCount
  while (Date.now() < deadline) {
    try {
      lastCount = await readRowsCount(page)
      if (predicate(lastCount)) return lastCount
    } catch {
      // Keep polling while the log viewer is still empty and has not rendered row counters.
    }
    await page.waitForTimeout(100)
  }
  throw new Error(`Timed out waiting for ${description}; last=${JSON.stringify(lastCount)}`)
}

async function assertAutoScrolledToBottom(page) {
  const atBottom = await page.getByTestId('log-scroll').evaluate((element) => {
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    return distance >= 0 && distance < 80
  })
  if (!atBottom) throw new Error('log viewer did not auto-scroll to the streamed row bottom')
}

async function assertCompactRowSpacing(page) {
  const spacing = await page.locator('[data-testid^="log-row-"]').evaluateAll((nodes) => {
    const rows = nodes.slice(0, 20).map((node) => {
      const rect = node.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom, height: rect.height }
    }).filter((row) => row.height > 0)
    const gaps = rows.slice(1).map((row, index) => row.top - rows[index].bottom)
    return { rows: rows.length, gaps, minGap: gaps.length ? Math.min(...gaps) : 0, maxGap: gaps.length ? Math.max(...gaps) : 0 }
  })
  if (spacing.rows < 2) throw new Error(`not enough rendered log rows for spacing check: ${JSON.stringify(spacing)}`)
  if (spacing.minGap < -1 || spacing.maxGap > 1) throw new Error(`log rows have incorrect vertical spacing: ${JSON.stringify(spacing)}`)
}

async function renameRecordedVideo(label) {
  const videos = fs.readdirSync(artifactDir).filter((file) => file.endsWith('.webm'))
  if (videos.length === 0) throw new Error(`missing recorded ${label} video artifact`)
  const newest = videos
    .map((file) => ({ file, mtimeMs: fs.statSync(path.join(artifactDir, file)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0].file
  fs.renameSync(path.join(artifactDir, newest), path.join(artifactDir, `${label}.webm`))
}

function assertProductionAssets() {
  const index = path.join(repoRoot, 'dist', 'index.html')
  if (!fs.existsSync(index)) throw new Error('missing production dist/index.html; run npm run build first')
}

function captureProcessOutput(child, dir, name) {
  const stdout = fs.createWriteStream(path.join(dir, `${name}.stdout.log`))
  const stderr = fs.createWriteStream(path.join(dir, `${name}.stderr.log`))
  child.stdout?.pipe(stdout)
  child.stderr?.pipe(stderr)
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
  throw new Error(`preview server did not become ready: ${url}`)
}

async function httpOk(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve(Boolean(res.statusCode && res.statusCode < 500))
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function writeBrowserArtifacts(page, prefix) {
  fs.writeFileSync(path.join(artifactDir, 'console.json'), `${JSON.stringify(consoleEvents, null, 2)}\n`)
  fs.writeFileSync(path.join(artifactDir, 'page-errors.json'), `${JSON.stringify(pageErrors, null, 2)}\n`)
  fs.writeFileSync(path.join(artifactDir, `${prefix}-dom.html`), await page.content())
}

function messageFor(error) {
  return error instanceof Error ? error.message : String(error)
}
