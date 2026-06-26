// @vitest-environment node
/// <reference types="node" />
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const tempDirs: string[] = []

describe('wiki release report publisher', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('renders Korean wiki pages and release artifacts from a pre-push report', () => {
    const reportDir = makeTempDir('klogcat-report-')
    const wikiDir = makeTempDir('klogcat-wiki-')
    fs.mkdirSync(path.join(reportDir, 'logs'), { recursive: true })
    fs.writeFileSync(path.join(reportDir, 'summary.md'), `# klogcat pre-push 보고서\n\n## 테스트 지표\n\n| 계층 | 상태 | 통과 | 전체 | 비고 |\n| --- | --- | ---: | ---: | --- |\n| 스트레스 | \`passed\` | 5 | 5 | 18.97s |\n`, 'utf8')
    fs.writeFileSync(path.join(reportDir, 'summary.json'), JSON.stringify({
      id: '20260626T010203+0900-prepush-adc3e04',
      generatedAt: '2026-06-26T01:02:03.000Z',
      git: { shortHead: 'adc3e04', head: 'adc3e0403d013b4a3cf83695cb7cbaceb6fb59c3' },
      testResults: { stress: { status: 'passed', testsPassed: 5, testsTotal: 5, duration: '18.97s' } },
    }, null, 2), 'utf8')
    fs.writeFileSync(path.join(reportDir, 'test-results.json'), '{"stress":{"status":"passed"}}\n', 'utf8')
    fs.writeFileSync(path.join(reportDir, 'command-results.json'), '{"test-stress":{"status":"passed"}}\n', 'utf8')
    fs.writeFileSync(path.join(reportDir, 'logs', 'test-stress.out'), 'stress log\n', 'utf8')

    const result = spawnSync('node', [
      'scripts/harness/wiki-release-report.mjs',
      '--report-dir', reportDir,
      '--wiki-dir', wikiDir,
      '--tag', 'v0.0.7',
      '--commit', 'adc3e04',
      '--no-git',
    ], { cwd: repoRoot, encoding: 'utf8' })

    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toContain('Wiki release report written')

    const page = fs.readFileSync(path.join(wikiDir, 'Release-Report-v0.0.7.md'), 'utf8')
    expect(page).toContain('# klogcat v0.0.7 릴리즈 보고서')
    expect(page).toContain('## 사전 배포 검증 보고서')
    expect(page).toContain('| 스트레스 | `passed` | 5 | 5 | 18.97s |')
    expect(page).toContain('[summary.json](artifacts/v0.0.7/summary.json)')

    const index = fs.readFileSync(path.join(wikiDir, 'Release-Reports.md'), 'utf8')
    expect(index).toContain('- [v0.0.7](Release-Report-v0.0.7) — `adc3e04`')

    const home = fs.readFileSync(path.join(wikiDir, 'Home.md'), 'utf8')
    expect(home).toContain('# klogcat')
    expect(home).toContain('Kubernetes pod 안의 로그 파일')
    expect(home).toContain('## 메뉴')
    expect(home).toContain('[릴리즈 보고서](Release-Reports)')
    expect(home).toContain('## 운영/품질 리포팅')

    expect(fs.existsSync(path.join(wikiDir, 'artifacts', 'v0.0.7', 'test-results.json'))).toBe(true)
    expect(fs.existsSync(path.join(wikiDir, 'artifacts', 'v0.0.7', 'logs', 'test-stress.out'))).toBe(true)
  })
})

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}
