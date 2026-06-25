#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const repoRoot = process.cwd()
const args = parseArgs(process.argv.slice(2))
const tmpDir = path.resolve(repoRoot, args['tmp-dir'] ?? '')
const releaseGate = args['release-gate'] === '1'
const reportsRoot = path.join(repoRoot, 'docs', 'reports')
const metricsReportPath = path.join(repoRoot, '.harness', 'reports', 'metrics-prepush.json')

if (!tmpDir || !fs.existsSync(tmpDir)) {
  fail(`missing --tmp-dir: ${tmpDir}`)
}

const now = new Date()
const shortSha = git(['rev-parse', '--short', 'HEAD'])
const reportId = `${timestampForId(now)}-prepush-${shortSha}`
const reportDir = path.join(reportsRoot, reportId)

fs.mkdirSync(reportDir, { recursive: true })
fs.mkdirSync(path.join(reportDir, 'logs'), { recursive: true })

const commandLogs = copyCommandLogs(tmpDir, path.join(reportDir, 'logs'))
const metrics = readJsonIfExists(metricsReportPath)
if (metrics) {
  fs.copyFileSync(metricsReportPath, path.join(reportDir, 'quality-metrics.json'))
}

const commandResults = buildCommandResults(commandLogs)
const testResults = buildTestResults(commandLogs)
const buildResults = buildBuildResults(commandLogs)
const gitInfo = buildGitInfo()

const summary = {
  id: reportId,
  generatedAt: now.toISOString(),
  hook: 'pre-push',
  status: 'passed',
  releaseGate,
  git: gitInfo,
  qualityMetrics: metrics?.summary ?? null,
  testResults,
  buildResults,
  commandResults,
}

fs.writeFileSync(path.join(reportDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
fs.writeFileSync(path.join(reportDir, 'test-results.json'), `${JSON.stringify(testResults, null, 2)}\n`)
fs.writeFileSync(path.join(reportDir, 'command-results.json'), `${JSON.stringify(commandResults, null, 2)}\n`)
fs.writeFileSync(path.join(reportDir, 'summary.md'), renderSummaryMarkdown(summary, metrics), 'utf8')

console.log(`[harness:pre-push] Report written: ${relative(reportDir)}`)

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const [key, inlineValue] = arg.slice(2).split('=')
    parsed[key] = inlineValue ?? argv[index + 1]
    if (inlineValue === undefined) index += 1
  }
  return parsed
}

function copyCommandLogs(fromDir, toDir) {
  const logs = {}
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.out')) continue
    const source = path.join(fromDir, entry.name)
    const target = path.join(toDir, entry.name)
    fs.copyFileSync(source, target)
    logs[entry.name.replace(/\.out$/, '')] = {
      path: relative(target),
      output: fs.readFileSync(source, 'utf8'),
    }
  }
  return logs
}

function buildCommandResults(logs) {
  return Object.fromEntries(Object.entries(logs).map(([name, log]) => [name, {
    status: 'passed',
    log: log.path,
  }]))
}

function buildTestResults(logs) {
  const unitFrontend = parseVitestLayerOutput(logs['test-unit']?.output ?? '', 'unit')
  const scenario = parseVitestLayerOutput(logs['test-scenario']?.output ?? '', 'scenario')
  const e2e = parseVitestLayerOutput(logs['test-e2e']?.output ?? '', 'e2e')
  const rust = parseRustTestOutput(logs['rust-test']?.output ?? '')

  return {
    unit: {
      status: combinedStatus([unitFrontend.status, rust.status]),
      frontend: unitFrontend,
      rust,
      testsPassed: (unitFrontend.testsPassed ?? 0) + rust.passed,
      testsTotal: (unitFrontend.testsTotal ?? 0) + rust.passed + rust.failed,
    },
    scenario,
    e2e,
    rust,
  }
}

function buildBuildResults(logs) {
  return {
    typecheck: { status: logs.typecheck ? 'passed' : 'not-run' },
    frontendBuild: parseViteBuildOutput(logs['frontend-build']?.output ?? ''),
    rustClippy: { status: logs['rust-clippy'] ? 'passed' : 'not-run' },
    rustFmt: { status: logs['rust-fmt'] ? 'passed' : 'not-run' },
    tauriBuild: releaseGate
      ? { status: logs['tauri-build'] ? 'passed' : 'not-run' }
      : { status: 'skipped' },
  }
}

function buildGitInfo() {
  return {
    branch: git(['branch', '--show-current']) || null,
    head: git(['rev-parse', 'HEAD']),
    shortHead: git(['rev-parse', '--short', 'HEAD']),
    status: git(['status', '--short']).split(/\r?\n/).filter(Boolean),
  }
}

function parseVitestLayerOutput(output, layer) {
  const marker = output.match(new RegExp(`\\[test-layer\\] layer=${layer} status=(\\w+)(?: files=(\\d+))?(?: tests=(\\d+))?(?: reason=([^\\s]+))?`))
  if (marker?.[1] === 'skipped') {
    return {
      layer,
      status: 'skipped',
      filesPassed: 0,
      filesTotal: 0,
      testsPassed: 0,
      testsTotal: 0,
      duration: null,
      reason: marker[4] ?? null,
    }
  }

  const files = output.match(/Test Files\s+(\d+)\s+passed\s+\((\d+)\)/)
  const tests = output.match(/Tests\s+(\d+)\s+passed\s+\((\d+)\)/)
  const duration = output.match(/Duration\s+(.+)$/m)
  return {
    layer,
    status: output.includes('Test Files') ? 'passed' : 'unknown',
    filesPassed: files ? Number(files[1]) : null,
    filesTotal: files ? Number(files[2]) : null,
    testsPassed: tests ? Number(tests[1]) : null,
    testsTotal: tests ? Number(tests[2]) : null,
    duration: duration ? duration[1].trim() : null,
  }
}

function combinedStatus(statuses) {
  if (statuses.some((status) => status === 'unknown' || status === 'failed')) return 'unknown'
  if (statuses.every((status) => status === 'skipped')) return 'skipped'
  return 'passed'
}

function parseRustTestOutput(output) {
  const results = [...output.matchAll(/test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out/g)]
  const totals = results.reduce((acc, match) => {
    acc.passed += Number(match[1])
    acc.failed += Number(match[2])
    acc.ignored += Number(match[3])
    acc.measured += Number(match[4])
    acc.filteredOut += Number(match[5])
    return acc
  }, { passed: 0, failed: 0, ignored: 0, measured: 0, filteredOut: 0 })
  return {
    status: results.length > 0 && totals.failed === 0 ? 'passed' : 'unknown',
    suites: results.length,
    ...totals,
  }
}

function parseViteBuildOutput(output) {
  const assets = [...output.matchAll(/^\s*(dist\/\S+)\s+([0-9.]+)\s+kB(?:\s+│\s+gzip:\s+([0-9.]+)\s+kB)?/gm)]
    .map((match) => ({
      path: match[1],
      sizeKb: Number(match[2]),
      gzipKb: match[3] ? Number(match[3]) : null,
    }))
  const duration = output.match(/built in ([^\n]+)/)
  return {
    status: output.includes('✓ built in') ? 'passed' : 'unknown',
    assets,
    duration: duration ? duration[1].trim() : null,
  }
}

function renderSummaryMarkdown(summary, metrics) {
  const quality = summary.qualityMetrics
  const unit = summary.testResults.unit
  const scenario = summary.testResults.scenario
  const e2e = summary.testResults.e2e
  const build = summary.buildResults.frontendBuild

  return `# klogcat pre-push report

| Field | Value |
| --- | --- |
| Report ID | \`${summary.id}\` |
| Status | \`${summary.status}\` |
| Generated at | \`${summary.generatedAt}\` |
| Branch | \`${summary.git.branch ?? '(detached)'}\` |
| HEAD | \`${summary.git.shortHead}\` |
| Release gate | \`${summary.releaseGate ? 'enabled' : 'skipped'}\` |

## Software quality static metrics

| Metric | Value |
| --- | ---: |
| Source files | ${quality?.fileCount ?? 'n/a'} |
| Functions | ${quality?.functionCount ?? 'n/a'} |
| Max cyclomatic complexity | ${quality?.maxCyclomaticComplexity ?? 'n/a'} |
| Max cognitive complexity | ${quality?.maxCognitiveComplexity ?? 'n/a'} |
| Max function lines | ${quality?.maxFunctionLines ?? 'n/a'} |
| Max file lines | ${quality?.maxFileLines ?? 'n/a'} |
| Max coupling | ${quality?.maxCoupling ?? 'n/a'} |
| Min maintainability | ${quality?.minMaintainability ?? 'n/a'} |
| Circular dependencies | ${quality?.cycleCount ?? 'n/a'} |
| Architecture violations | ${quality?.architectureViolationCount ?? 'n/a'} |
| Violations | ${metrics?.violations?.length ?? 'n/a'} |

## Test metrics

| Layer | Status | Passed | Total | Notes |
| --- | --- | ---: | ---: | --- |
| Unit | \`${unit.status}\` | ${unit.testsPassed ?? 'n/a'} | ${unit.testsTotal ?? 'n/a'} | frontend + Rust cargo tests |
| Scenario | \`${scenario.status}\` | ${scenario.testsPassed ?? 'n/a'} | ${scenario.testsTotal ?? 'n/a'} | ${scenario.reason ?? ''} |
| E2E | \`${e2e.status}\` | ${e2e.testsPassed ?? 'n/a'} | ${e2e.testsTotal ?? 'n/a'} | ${e2e.reason ?? ''} |

## Build and static checks

| Check | Status |
| --- | --- |
| TypeScript typecheck | \`${summary.buildResults.typecheck.status}\` |
| Frontend build | \`${build.status}\` |
| Rust fmt | \`${summary.buildResults.rustFmt.status}\` |
| Rust clippy | \`${summary.buildResults.rustClippy.status}\` |
| Tauri build | \`${summary.buildResults.tauriBuild.status}\` |

## Frontend build assets

| Asset | Size kB | Gzip kB |
| --- | ---: | ---: |
${build.assets.map((asset) => `| \`${asset.path}\` | ${asset.sizeKb} | ${asset.gzipKb ?? 'n/a'} |`).join('\n') || '| n/a | n/a | n/a |'}

## Logs

${Object.entries(summary.commandResults).map(([name, result]) => {
    const logLink = `logs/${path.basename(result.log)}`
    return `- \`${name}\`: [${logLink}](${logLink})`
  }).join('\n')}
`
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function timestampForId(date) {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absOffset = Math.abs(offsetMinutes)
  const offset = `${sign}${pad(Math.floor(absOffset / 60))}${pad(absOffset % 60)}`
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${offset}`
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function relative(file) {
  return path.relative(repoRoot, file).split(path.sep).join('/')
}

function fail(message) {
  console.error(`[harness:pre-push] ${message}`)
  process.exit(1)
}
