#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const repoRoot = process.cwd()
const args = parseArgs(process.argv.slice(2))
const tag = requiredArg('tag')
const safeTag = sanitizePagePart(tag)
const reportDir = path.resolve(repoRoot, args['report-dir'] ?? latestReportDir())
const wikiDir = path.resolve(repoRoot, args['wiki-dir'] ?? '.harness/wiki/klogcat.wiki')
const commit = args.commit ?? readSummaryJson(reportDir)?.git?.shortHead ?? git(['rev-parse', '--short', 'HEAD'])
const noGit = args['no-git'] === true
const wikiRemote = args.remote ?? 'git@github.com:yprite/klogcat.wiki.git'

if (!fs.existsSync(reportDir)) fail(`보고서 디렉토리를 찾을 수 없습니다: ${reportDir}`)
if (!fs.existsSync(path.join(reportDir, 'summary.md'))) fail(`summary.md를 찾을 수 없습니다: ${reportDir}`)

prepareWikiDir(wikiDir)
const artifactDir = path.join(wikiDir, 'artifacts', safeTag)
fs.rmSync(artifactDir, { recursive: true, force: true })
fs.mkdirSync(artifactDir, { recursive: true })
copyReportArtifacts(reportDir, artifactDir)

const summaryMarkdown = fs.readFileSync(path.join(reportDir, 'summary.md'), 'utf8').trim()
const summary = readSummaryJson(reportDir)
const generatedAt = summary?.generatedAt ?? new Date().toISOString()
const pageName = `Release-Report-${safeTag}`
const pagePath = path.join(wikiDir, `${pageName}.md`)

fs.writeFileSync(pagePath, renderReleasePage({ tag, safeTag, commit, generatedAt, summaryMarkdown }), 'utf8')
upsertHome(wikiDir)
upsertReleaseIndex(wikiDir, { tag, pageName, commit, generatedAt })

if (!noGit) {
  commitAndPushWiki(wikiDir, tag)
}

console.log(`Wiki release report written: ${path.relative(repoRoot, pagePath).split(path.sep).join('/')}`)

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    if (key === 'no-git') {
      parsed[key] = true
      continue
    }
    parsed[key] = argv[index + 1]
    index += 1
  }
  return parsed
}

function requiredArg(name) {
  const value = args[name]
  if (!value) fail(`필수 인자가 없습니다: --${name}`)
  return value
}

function latestReportDir() {
  const reportsRoot = path.join(repoRoot, 'docs', 'reports')
  if (!fs.existsSync(reportsRoot)) fail('docs/reports 디렉토리가 없습니다. 먼저 npm run harness:prepush를 실행하세요.')
  const entries = fs.readdirSync(reportsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(reportsRoot, entry.name))
    .sort()
  if (entries.length === 0) fail('docs/reports 아래에 보고서가 없습니다.')
  return entries.at(-1)
}

function prepareWikiDir(dir) {
  if (noGit) {
    fs.mkdirSync(dir, { recursive: true })
    return
  }
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(path.dirname(dir), { recursive: true })
    execFileSync('git', ['clone', wikiRemote, dir], { stdio: 'inherit' })
  } else if (fs.existsSync(path.join(dir, '.git'))) {
    execFileSync('git', ['pull', '--ff-only'], { cwd: dir, stdio: 'inherit' })
  } else {
    fail(`wiki-dir가 git 저장소가 아닙니다: ${dir}`)
  }
}

function copyReportArtifacts(fromDir, toDir) {
  for (const file of ['summary.md', 'summary.json', 'test-results.json', 'command-results.json', 'quality-metrics.json']) {
    const source = path.join(fromDir, file)
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(toDir, file))
  }
  for (const dir of ['logs', 'e2e-artifacts']) {
    const source = path.join(fromDir, dir)
    if (fs.existsSync(source)) fs.cpSync(source, path.join(toDir, dir), { recursive: true })
  }
}

function renderReleasePage({ tag, safeTag, commit, generatedAt, summaryMarkdown }) {
  return `# klogcat ${tag} 릴리즈 보고서

| 항목 | 값 |
| --- | --- |
| 릴리즈 태그 | \`${tag}\` |
| 커밋 | \`${commit}\` |
| 생성 시각 | \`${generatedAt}\` |
| 원본 산출물 | [artifacts/${safeTag}](artifacts/${safeTag}) |

## 원본 JSON/로그 산출물

- [summary.json](artifacts/${safeTag}/summary.json)
- [test-results.json](artifacts/${safeTag}/test-results.json)
- [command-results.json](artifacts/${safeTag}/command-results.json)
- [summary.md](artifacts/${safeTag}/summary.md)
- [logs/](artifacts/${safeTag}/logs/)

## 사전 배포 검증 보고서

${summaryMarkdown}
`
}

function upsertHome(dir) {
  const homePath = path.join(dir, 'Home.md')
  if (!fs.existsSync(homePath)) {
    fs.writeFileSync(homePath, '# klogcat Wiki\n\n- [릴리즈 보고서](Release-Reports)\n', 'utf8')
    return
  }
  const content = fs.readFileSync(homePath, 'utf8')
  if (!content.includes('Release-Reports')) {
    fs.writeFileSync(homePath, `${content.trim()}\n\n- [릴리즈 보고서](Release-Reports)\n`, 'utf8')
  }
}

function upsertReleaseIndex(dir, release) {
  const indexPath = path.join(dir, 'Release-Reports.md')
  const header = '# 릴리즈 보고서\n\n릴리즈마다 생성된 테스트/스트레스/품질 보고서입니다.\n\n'
  const existing = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : header
  const lines = existing.split(/\r?\n/).filter((line) => !line.includes(`](${release.pageName})`))
  const entry = `- [${release.tag}](${release.pageName}) — \`${release.commit}\` — ${release.generatedAt}`
  const bodyStart = lines.join('\n').trim() || header.trim()
  fs.writeFileSync(indexPath, `${bodyStart}\n${entry}\n`, 'utf8')
}

function commitAndPushWiki(dir, tag) {
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'inherit' })
  const status = git(['status', '--short'], dir)
  if (!status) {
    console.log('[wiki-release-report] 변경 사항이 없어 push를 건너뜁니다.')
    return
  }
  execFileSync('git', ['commit', '-m', `docs: add ${tag} release report`], { cwd: dir, stdio: 'inherit' })
  execFileSync('git', ['push'], { cwd: dir, stdio: 'inherit' })
}

function readSummaryJson(dir) {
  const file = path.join(dir, 'summary.json')
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function sanitizePagePart(value) {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
}

function git(argv, cwd = repoRoot) {
  return execFileSync('git', argv, { cwd, encoding: 'utf8' }).trim()
}

function fail(message) {
  console.error(`[wiki-release-report] ${message}`)
  process.exit(1)
}
