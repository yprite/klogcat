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
const e2eArtifacts = copyE2eArtifacts(reportDir, testResults.e2e)
const gitInfo = buildGitInfo()

const summary = {
  id: reportId,
  generatedAt: now.toISOString(),
  hook: 'pre-push',
  status: 'passed',
  releaseGate,
  git: gitInfo,
  qualityMetrics: metrics?.summary ?? null,
  staticQuality: metrics?.staticQuality ?? null,
  testResults,
  e2eArtifacts,
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
  const stress = parseVitestLayerOutput(logs['test-stress']?.output ?? '', 'stress')
  const e2e = parseE2eOutput(logs['test-e2e']?.output ?? '')
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
    stress,
    e2e,
    rust,
  }
}

function copyE2eArtifacts(reportDir, e2eResult) {
  const sourceRoot = path.join(repoRoot, '.harness', 'e2e-artifacts')
  const artifactPaths = [
    e2eResult?.subchecks?.browser?.artifacts,
    e2eResult?.subchecks?.desktop?.artifacts,
  ].filter(Boolean)
  if (artifactPaths.length === 0 || !fs.existsSync(sourceRoot)) return []
  const targetRoot = path.join(reportDir, 'e2e-artifacts')
  fs.mkdirSync(targetRoot, { recursive: true })
  const copied = []
  for (const artifactPath of artifactPaths) {
    const sourceDir = path.resolve(repoRoot, artifactPath)
    const relativeSource = path.relative(sourceRoot, sourceDir)
    if (relativeSource.startsWith('..') || path.isAbsolute(relativeSource) || !fs.existsSync(sourceDir)) continue
    const entryName = path.basename(sourceDir)
    const targetDir = path.join(targetRoot, entryName)
    fs.cpSync(sourceDir, targetDir, { recursive: true })
    copied.push(relative(targetDir))
  }
  return copied.sort()
}

function buildBuildResults(logs) {
  return {
    lint: { status: logs.lint ? 'passed' : 'not-run' },
    typecheck: { status: logs.typecheck ? 'passed' : 'not-run' },
    coverage: parseCoverageOutput(logs.coverage?.output ?? ''),
    frontendBuild: parseViteBuildOutput(logs['frontend-build']?.output ?? ''),
    rustClippy: { status: logs['rust-clippy'] ? 'passed' : 'not-run' },
    rustFmt: { status: logs['rust-fmt'] ? 'passed' : 'not-run' },
    securityLicense: { status: logs['security-license'] ? 'passed' : 'not-run' },
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

function parseE2eOutput(output) {
  const vitest = parseVitestLayerOutput(output, 'e2e')
  const browser = parseHarnessSubcheck(output, 'browser-e2e')
  const desktop = parseHarnessSubcheck(output, 'desktop-e2e')
  const extraChecks = [browser, desktop]
  const statuses = [vitest.status, ...extraChecks.map((check) => check.status)]
  const status = statuses.every((value) => value === 'passed' || value === 'skipped') ? 'passed' : 'unknown'
  const extraPassed = extraChecks.reduce((sum, check) => sum + (check.testsPassed ?? 0), 0)
  const extraTotal = extraChecks.reduce((sum, check) => sum + (check.testsTotal ?? 0), 0)
  return {
    ...vitest,
    status,
    testsPassed: (vitest.testsPassed ?? 0) + extraPassed,
    testsTotal: (vitest.testsTotal ?? 0) + extraTotal,
    subchecks: { vitest, browser, desktop },
  }
}

function parseHarnessSubcheck(output, marker) {
  const failed = output.match(new RegExp(`\\[${marker}\\] status=failed(?: tests=(\\d+))?(?: artifacts=([^\\s]+))?(?: error=(.+))?`))
  if (failed) {
    const total = failed[1] ? Number(failed[1]) : 1
    return {
      status: 'failed',
      testsPassed: 0,
      testsTotal: total,
      artifacts: failed[2] ?? null,
      error: failed[3] ?? null,
    }
  }
  const passed = output.match(new RegExp(`\\[${marker}\\] status=passed(?: tests=(\\d+))?(?: artifacts=([^\\s]+))?`))
  if (passed) {
    const total = passed[1] ? Number(passed[1]) : 1
    return {
      status: 'passed',
      testsPassed: total,
      testsTotal: total,
      artifacts: passed[2] ?? null,
      error: null,
    }
  }
  return {
    status: 'not-run',
    testsPassed: 0,
    testsTotal: 0,
    artifacts: null,
    error: null,
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

function parseCoverageOutput(output) {
  const passed = output.match(/\[coverage\] Passed\. lines=([^%\s]+)% statements=([^%\s]+)% functions=([^%\s]+)% branches=([^%\s]+)%/)
  if (!passed) return { status: output ? 'unknown' : 'not-run' }
  return {
    status: 'passed',
    lines: Number(passed[1]),
    statements: Number(passed[2]),
    functions: Number(passed[3]),
    branches: Number(passed[4]),
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
  const staticQuality = summary.staticQuality
  const unit = summary.testResults.unit
  const scenario = summary.testResults.scenario
  const stress = summary.testResults.stress
  const e2e = summary.testResults.e2e
  const build = summary.buildResults.frontendBuild

  return `# klogcat pre-push 보고서

| 항목 | 값 |
| --- | --- |
| 보고서 ID | \`${summary.id}\` |
| 상태 | \`${summary.status}\` |
| 생성 시각 | \`${summary.generatedAt}\` |
| 브랜치 | \`${summary.git.branch ?? '(detached)'}\` |
| HEAD | \`${summary.git.shortHead}\` |
| 릴리스 게이트 | \`${summary.releaseGate ? 'enabled' : 'skipped'}\` |

## 소프트웨어 품질 정적 지표

| 지표 | 값 |
| --- | ---: |
| 총점 | ${staticQualityScoreCell(staticQuality)} |
| 품질 단계 | ${reportValue(staticQuality?.phase)} |
| 소스 파일 | ${reportValue(quality?.fileCount)} |
| 함수 | ${reportValue(quality?.functionCount)} |
| 최대 순환 복잡도 | ${reportValue(quality?.maxCyclomaticComplexity)} |
| 최대 인지 복잡도 | ${reportValue(quality?.maxCognitiveComplexity)} |
| 최대 함수 라인 수 | ${reportValue(quality?.maxFunctionLines)} |
| 최대 파일 라인 수 | ${reportValue(quality?.maxFileLines)} |
| 최대 결합도 | ${reportValue(quality?.maxCoupling)} |
| 최소 유지보수성 | ${reportValue(quality?.minMaintainability)} |
| 순환 의존성 | ${reportValue(quality?.cycleCount)} |
| 아키텍처 위반 | ${reportValue(quality?.architectureViolationCount)} |
| 위반 항목 | ${reportValue(metrics?.violations?.length)} |

## 테스트 지표

| 계층 | 상태 | 통과 | 전체 | 비고 |
| --- | --- | ---: | ---: | --- |
| 단위 | \`${unit.status}\` | ${reportValue(unit.testsPassed)} | ${reportValue(unit.testsTotal)} | 프론트엔드 + Rust cargo 테스트 |
| 시나리오 | \`${scenario.status}\` | ${reportValue(scenario.testsPassed)} | ${reportValue(scenario.testsTotal)} | ${reportNote(scenario.reason ?? scenario.duration)} |
| 스트레스 | \`${stress.status}\` | ${reportValue(stress.testsPassed)} | ${reportValue(stress.testsTotal)} | ${reportNote(stress.reason ?? stress.duration)} |
| E2E | \`${e2e.status}\` | ${reportValue(e2e.testsPassed)} | ${reportValue(e2e.testsTotal)} | vitest + 브라우저 + 데스크톱 |

## E2E 세부 검사

| 검사 | 상태 | 통과 | 전체 | 산출물 |
| --- | --- | ---: | ---: | --- |
| Vitest 계약 | \`${e2e.subchecks?.vitest?.status ?? 'not-run'}\` | ${reportValue(e2e.subchecks?.vitest?.testsPassed)} | ${reportValue(e2e.subchecks?.vitest?.testsTotal)} | 자체 로그 |
| 실제 브라우저 | \`${e2e.subchecks?.browser?.status ?? 'not-run'}\` | ${reportValue(e2e.subchecks?.browser?.testsPassed)} | ${reportValue(e2e.subchecks?.browser?.testsTotal)} | ${artifactCell(e2e.subchecks?.browser?.artifacts)} |
| 데스크톱 바이너리 | \`${e2e.subchecks?.desktop?.status ?? 'not-run'}\` | ${reportValue(e2e.subchecks?.desktop?.testsPassed)} | ${reportValue(e2e.subchecks?.desktop?.testsTotal)} | ${artifactCell(e2e.subchecks?.desktop?.artifacts)} |

## 빌드 및 정적 검사

| 검사 | 상태 |
| --- | --- |
| ESLint | \`${summary.buildResults.lint.status}\` |
| TypeScript 타입 검사 | \`${summary.buildResults.typecheck.status}\` |
| 커버리지 라인 게이트 | \`${summary.buildResults.coverage.status}\`${summary.buildResults.coverage.lines !== undefined ? ` (${summary.buildResults.coverage.lines}% lines)` : ''} |
| 프론트엔드 빌드 | \`${build.status}\` |
| Rust fmt | \`${summary.buildResults.rustFmt.status}\` |
| Rust clippy | \`${summary.buildResults.rustClippy.status}\` |
| 보안/라이선스 | \`${summary.buildResults.securityLicense.status}\` |
| Tauri 빌드 | \`${summary.buildResults.tauriBuild.status}\` |

## 프론트엔드 빌드 산출물

| 산출물 | 크기 kB | Gzip kB |
| --- | ---: | ---: |
${buildAssetRows(build.assets)}

## 로그

${Object.entries(summary.commandResults).map(([name, result]) => {
    const logLink = `logs/${path.basename(result.log)}`
    return `- \`${name}\`: [${logLink}](${logLink})`
  }).join('\n')}
`
}

function reportValue(value) {
  return value ?? '미수집'
}

function staticQualityScoreCell(staticQuality) {
  if (!staticQuality || staticQuality.score === undefined) return '미수집'
  return `${staticQuality.score} / ${staticQuality.northStarScore ?? 900}`
}

function reportNote(value) {
  return value || '특이사항 없음'
}

function buildAssetRows(assets) {
  if (assets.length === 0) return '| 빌드 산출물 없음 | 미수집 | 미수집 |'
  return assets.map((asset) => `| \`${asset.path}\` | ${asset.sizeKb} | ${reportValue(asset.gzipKb)} |`).join('\n')
}

function artifactCell(artifactPath) {
  if (!artifactPath) return '산출물 없음'
  const base = path.basename(artifactPath)
  return `[\`${base}\`](e2e-artifacts/${base})`
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
