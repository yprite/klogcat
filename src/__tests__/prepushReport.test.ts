// @vitest-environment node
/// <reference types="node" />
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const generatedReports: string[] = []

describe('pre-push report generator', () => {
  afterEach(() => {
    for (const reportDir of generatedReports.splice(0)) {
      fs.rmSync(reportDir, { recursive: true, force: true })
    }
  })

  it('renders a Korean summary and includes stress test results', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'klogcat-prepush-report-'))
    try {
      writeLog(tmpDir, 'test-unit.out', vitestLayerOutput('unit', 4, 12, '120ms'))
      writeLog(tmpDir, 'test-scenario.out', vitestLayerOutput('scenario', 2, 5, '80ms'))
      writeLog(tmpDir, 'test-stress.out', vitestLayerOutput('stress', 1, 5, '6.44s'))
      writeLog(tmpDir, 'test-e2e.out', `${vitestLayerOutput('e2e', 1, 3, '1.20s')}\n[browser-e2e] status=passed tests=2 artifacts=.harness/e2e-artifacts/browser-current\n[desktop-e2e] status=passed tests=1 artifacts=.harness/e2e-artifacts/desktop-current\n`)
      writeLog(tmpDir, 'rust-test.out', 'test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\n')
      writeLog(tmpDir, 'coverage.out', '[coverage] Passed. lines=90.1% statements=91.2% functions=92.3% branches=80.4%\n')
      writeLog(tmpDir, 'lint.out', 'ok\n')
      writeLog(tmpDir, 'typecheck.out', 'ok\n')
      writeLog(tmpDir, 'frontend-build.out', 'dist/assets/index.js 10.25 kB │ gzip: 3.50 kB\n✓ built in 650ms\n')

      const result = spawnSync('node', ['scripts/harness/prepush-report.mjs', '--tmp-dir', tmpDir, '--release-gate', '0'], {
        cwd: repoRoot,
        encoding: 'utf8',
      })

      expect(result.status, result.stderr || result.stdout).toBe(0)
      const match = result.stdout.match(/Report written: (docs\/reports\/\S+)/)
      expect(match).not.toBeNull()
      const reportDir = path.join(repoRoot, match?.[1] ?? '')
      generatedReports.push(reportDir)

      const summaryJson = JSON.parse(fs.readFileSync(path.join(reportDir, 'summary.json'), 'utf8'))
      expect(summaryJson.testResults.stress).toMatchObject({
        layer: 'stress',
        status: 'passed',
        filesPassed: 1,
        filesTotal: 1,
        testsPassed: 5,
        testsTotal: 5,
        duration: '6.44s',
      })

      const summaryMarkdown = fs.readFileSync(path.join(reportDir, 'summary.md'), 'utf8')
      expect(summaryMarkdown).toContain('# klogcat pre-push 보고서')
      expect(summaryMarkdown).toContain('## 테스트 지표')
      expect(summaryMarkdown).toContain('| 스트레스 | `passed` | 5 | 5 | 6.44s |')
      expect(summaryMarkdown).toContain('## 빌드 및 정적 검사')
      expect(summaryMarkdown).toContain('## 로그')
      expect(summaryMarkdown.toLowerCase()).not.toContain('n/a')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

function writeLog(dir: string, name: string, content: string) {
  fs.writeFileSync(path.join(dir, name), content, 'utf8')
}

function vitestLayerOutput(layer: string, files: number, tests: number, duration: string) {
  return `[test-layer] layer=${layer} status=running files=${files}\n Test Files  ${files} passed (${files})\n      Tests  ${tests} passed (${tests})\n   Duration  ${duration}\n[test-layer] layer=${layer} status=passed files=${files}\n`
}
