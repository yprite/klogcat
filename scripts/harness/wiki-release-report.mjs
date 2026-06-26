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
  const landingPage = renderHomePage()
  if (!fs.existsSync(homePath)) {
    fs.writeFileSync(homePath, landingPage, 'utf8')
    return
  }

  const content = fs.readFileSync(homePath, 'utf8')
  if (isManagedHome(content)) {
    fs.writeFileSync(homePath, landingPage, 'utf8')
    return
  }

  if (!content.includes('Release-Reports')) {
    fs.writeFileSync(homePath, `${content.trim()}\n\n## 운영 메뉴\n\n- [릴리즈 보고서](Release-Reports)\n`, 'utf8')
  }
}

function renderHomePage() {
  return `<!-- klogcat:managed-home -->
# klogcat

Kubernetes pod 안의 로그 파일을 빠르게 선택하고 실시간으로 tail 하는 Tauri + React 데스크톱 로그 뷰어입니다.

## 메뉴

- [릴리즈 보고서](Release-Reports) — 릴리즈마다 생성된 테스트/스트레스/품질 검증 보고서
- [설치](#설치) — GitHub에서 설치하고 처음 실행하기
- [사용 흐름](#사용-흐름) — context, namespace, pod, container, file path 선택 후 로그 스트리밍
- [문제 해결](#문제-해결) — 로그가 안 보이거나 버튼 동작이 막힐 때 확인할 것

## 주요 기능

- Kubernetes context/namespace/pod/container 선택
- pod 내부 파일 경로를 \`tail -F\`로 실시간 스트리밍
- grep 필터와 일시정지로 로그 탐색
- Start/Stop/Reset 버튼의 명확한 상태 피드백
- 터미널 진단 모드로 실제 \`kubectl exec ... tail -F ...\` 명령 확인

## 설치

Debian/Ubuntu Linux에서 처음 빌드한다면 native dependency를 먼저 설치하세요.

\`\`\`bash
sudo apt-get update
sudo apt-get install -y pkg-config libdbus-1-dev libglib2.0-dev
\`\`\`

그 다음 GitHub에서 설치합니다.

\`\`\`bash
npm install -g git+ssh://git@github.com/yprite/klogcat.git
klogcat
\`\`\`

처음 실행하면 로컬에서 Tauri native binary를 빌드한 뒤 앱을 실행합니다.

## 사용 흐름

1. \`klogcat\` 실행
2. Kubernetes context 선택
3. namespace, pod, container 선택
4. 로그 파일 경로 입력
5. **Start**로 스트리밍 시작
6. 필요하면 grep 필터, pause, reset 사용

## 문제 해결

앱은 열리지만 로그가 보이지 않으면 진단 모드로 실행하세요.

\`\`\`bash
klogcat --debug
\`\`\`

진단 모드에서는 터미널에 다음 정보가 출력됩니다.

- 실제 \`kubectl exec ... tail -F ...\` 명령
- pod 파일에서 받은 stdout 라인
- \`kubectl\` / \`tail\` stderr
- stream 종료 코드 또는 signal

## 운영/품질 리포팅

릴리즈가 발행될 때마다 Wiki의 [릴리즈 보고서](Release-Reports)에 검증 결과가 자동으로 추가됩니다.
각 보고서에는 요약 Markdown, JSON 결과, command 결과, 원본 로그 artifact 링크가 포함됩니다.
`
}

function isManagedHome(content) {
  return content.includes('<!-- klogcat:managed-home -->') || content.trim() === '# klogcat Wiki\n\n- [릴리즈 보고서](Release-Reports)'
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
