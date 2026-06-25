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
let browser

console.log(`[browser-e2e] status=running artifacts=${relativeToRepo(artifactDir)}`)

try {
  assertProductionAssets()
  const port = await findFreePort()
  preview = spawn(
    path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite'),
    ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  captureProcessOutput(preview, artifactDir, 'vite-preview')
  await waitForHttp(`http://127.0.0.1:${port}/`)

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('console', (message) => {
    const event = { type: message.type(), text: message.text() }
    consoleEvents.push(event)
  })
  page.on('pageerror', (error) => pageErrors.push({ message: error.message, stack: error.stack }))

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' })
  await page.getByText('klogcat').waitFor()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('heading', { name: 'Settings' }).waitFor()
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: 'Change Targets' }).click()
  await page.getByRole('dialog', { name: /select log targets/i }).waitFor()
  await page.getByText('No selectable pods loaded').waitFor()
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('tab', { name: 'Failed Requests' }).click()
  await page.getByText('Request-centric investigation layer').waitFor()
  await page.getByRole('tab', { name: 'Raw Logs' }).click()
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.getByText('Select namespace and pod', { exact: true }).waitFor()

  await page.screenshot({ path: path.join(artifactDir, 'browser-final.png'), fullPage: true })
  await writeBrowserArtifacts(page)

  const seriousConsoleErrors = consoleEvents.filter((event) => event.type === 'error')
  if (seriousConsoleErrors.length > 0 || pageErrors.length > 0) {
    throw new Error(`browser console/page errors detected: console=${seriousConsoleErrors.length} page=${pageErrors.length}`)
  }

  console.log(`[browser-e2e] status=passed tests=1 artifacts=${relativeToRepo(artifactDir)}`)
} catch (error) {
  try {
    if (browser) {
      const pages = browser.contexts().flatMap((context) => context.pages())
      const page = pages[0]
      if (page) {
        await page.screenshot({ path: path.join(artifactDir, 'browser-failure.png'), fullPage: true }).catch(() => undefined)
        await writeBrowserArtifacts(page).catch(() => undefined)
      }
    }
  } finally {
    console.error(`[browser-e2e] status=failed tests=1 artifacts=${relativeToRepo(artifactDir)} error=${messageFor(error)}`)
    process.exitCode = 1
  }
} finally {
  await browser?.close().catch(() => undefined)
  if (preview && !preview.killed) preview.kill('SIGTERM')
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

async function writeBrowserArtifacts(page) {
  fs.writeFileSync(path.join(artifactDir, 'console.json'), `${JSON.stringify(consoleEvents, null, 2)}\n`)
  fs.writeFileSync(path.join(artifactDir, 'page-errors.json'), `${JSON.stringify(pageErrors, null, 2)}\n`)
  fs.writeFileSync(path.join(artifactDir, 'dom.html'), await page.content())
}

function messageFor(error) {
  return error instanceof Error ? error.message : String(error)
}
