#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

const repoRoot = process.cwd()
const reportDir = path.join(repoRoot, '.harness', 'reports')
const baselinePath = path.join(repoRoot, 'scripts', 'harness', 'metrics-baseline.json')
const architectureRulesPath = path.join(repoRoot, 'scripts', 'harness', 'architecture-rules.json')

const defaultThresholds = {
  cyclomaticComplexity: 10,
  cognitiveComplexity: 15,
  functionLines: 80,
  fileLines: 500,
  coupling: 12,
  maintainability: 60,
}

const staticQualityPolicy = {
  version: 1,
  northStarScore: 900,
  minimumGateScore: 600,
  complexFunctionBudget: 5,
  averageMaintainabilityTarget: 75,
  averageCouplingTarget: 6,
}

const args = new Set(process.argv.slice(2))
const modeArg = process.argv.find((arg) => arg.startsWith('--mode='))
const mode = modeArg ? modeArg.slice('--mode='.length) : 'prepush'
const writeBaseline = args.has('--write-baseline')

if (!['precommit', 'prepush'].includes(mode)) {
  fail(`Unknown metrics mode: ${mode}`)
}

main()

function main() {
  const baseline = readJsonIfExists(baselinePath)
  const rules = readJsonIfExists(architectureRulesPath) ?? { forbiddenImports: [] }
  const allSourceFiles = listSourceFiles()
  const selectedFiles = mode === 'precommit'
    ? getStagedSourceFiles(allSourceFiles)
    : allSourceFiles

  if (selectedFiles.length === 0) {
    console.log(`[metrics:${mode}] No source files to inspect.`)
    return
  }

  const contentByFile = new Map()
  for (const file of selectedFiles) {
    const content = mode === 'precommit'
      ? readStagedFile(file)
      : fs.readFileSync(path.join(repoRoot, file), 'utf8')
    contentByFile.set(file, content)
  }

  const analysis = analyzeFiles(selectedFiles, contentByFile, allSourceFiles, rules)
  const staticQuality = calculateStaticQuality(analysis)
  const effectiveThresholds = buildEffectiveThresholds(baseline)
  const effectiveStaticQualityGate = buildEffectiveStaticQualityGate(baseline)
  const violations = evaluateViolations(analysis, effectiveThresholds, mode, staticQuality, effectiveStaticQualityGate)

  const report = {
    mode,
    generatedAt: new Date().toISOString(),
    thresholds: effectiveThresholds,
    staticQualityGate: effectiveStaticQualityGate,
    staticQuality,
    summary: analysis.summary,
    violations,
    files: analysis.files,
    cycles: analysis.cycles,
    architectureViolations: analysis.architectureViolations,
  }

  fs.mkdirSync(reportDir, { recursive: true })
  fs.writeFileSync(
    path.join(reportDir, `metrics-${mode}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  )

  if (writeBaseline) {
    const nextBaseline = {
      version: 1,
      generatedAt: new Date().toISOString(),
      thresholds: defaultThresholds,
      staticQuality: {
        policy: staticQualityPolicy,
        score: staticQuality.score,
        phase: staticQuality.phase,
      },
      repository: analysis.summary,
    }
    fs.writeFileSync(baselinePath, `${JSON.stringify(nextBaseline, null, 2)}\n`)
    console.log(`[metrics:${mode}] Baseline written to ${relative(baselinePath)}.`)
    return
  }

  if (violations.length > 0) {
    console.error(`[metrics:${mode}] Failed with ${violations.length} violation(s).`)
    for (const violation of violations.slice(0, 30)) {
      console.error(`- ${violation.file}${violation.name ? `:${violation.name}` : ''}: ${violation.message}`)
    }
    if (violations.length > 30) {
      console.error(`- ... ${violations.length - 30} more violation(s). See ${relative(path.join(reportDir, `metrics-${mode}.json`))}.`)
    }
    process.exit(1)
  }

  console.log(`[metrics:${mode}] Passed. Report: ${relative(path.join(reportDir, `metrics-${mode}.json`))}`)
}

function analyzeFiles(files, contentByFile, allSourceFiles, rules) {
  const allFileSet = new Set(allSourceFiles)
  const fileReports = []
  const graph = new Map()

  for (const file of files) {
    const content = contentByFile.get(file)
    const report = file.endsWith('.rs')
      ? analyzeRustFile(file, content, allFileSet)
      : analyzeTypeScriptFile(file, content, allFileSet)

    fileReports.push(report)
    graph.set(file, report.imports)
  }

  const architectureViolations = findArchitectureViolations(graph, rules)
  const cycles = findCycles(graph)
  const allFunctions = fileReports.flatMap((file) => file.functions)
  const maxCyclomatic = max(allFunctions.map((fn) => fn.cyclomaticComplexity), 1)
  const maxCognitive = max(allFunctions.map((fn) => fn.cognitiveComplexity), 0)
  const maxFunctionLines = max(allFunctions.map((fn) => fn.nonBlankLines), 0)
  const maxFileLines = max(fileReports.map((file) => file.nonBlankLines), 0)
  const maxCoupling = max(fileReports.map((file) => file.coupling), 0)
  const minMaintainability = min(fileReports.map((file) => file.maintainability), 100)
  const avgMaintainability = average(fileReports.map((file) => file.maintainability))
  const avgCoupling = average(fileReports.map((file) => file.coupling))
  const overComplexFunctionCount = allFunctions.filter((fn) =>
    fn.cyclomaticComplexity > defaultThresholds.cyclomaticComplexity ||
    fn.cognitiveComplexity > defaultThresholds.cognitiveComplexity,
  ).length
  const lowMaintainabilityFileCount = fileReports.filter((file) =>
    file.maintainability < defaultThresholds.maintainability,
  ).length

  return {
    summary: {
      fileCount: fileReports.length,
      functionCount: allFunctions.length,
      maxCyclomaticComplexity: maxCyclomatic,
      maxCognitiveComplexity: maxCognitive,
      maxFunctionLines,
      maxFileLines,
      maxCoupling,
      minMaintainability,
      avgMaintainability,
      avgCoupling,
      overComplexFunctionCount,
      lowMaintainabilityFileCount,
      cycleCount: cycles.length,
      architectureViolationCount: architectureViolations.length,
    },
    files: fileReports,
    cycles,
    architectureViolations,
  }
}

function calculateStaticQuality(analysis) {
  const summary = analysis.summary
  const architectureScore = boundedScore(125 - summary.cycleCount * 75) +
    boundedScore(125 - summary.architectureViolationCount * 75)
  const maintainabilityScore =
    120 * higherBetter(summary.minMaintainability, defaultThresholds.maintainability) +
    80 * higherBetter(summary.avgMaintainability, staticQualityPolicy.averageMaintainabilityTarget)
  const complexityScore =
    90 * lowerBetter(summary.maxCyclomaticComplexity, defaultThresholds.cyclomaticComplexity) +
    110 * lowerBetter(summary.maxCognitiveComplexity, defaultThresholds.cognitiveComplexity) +
    50 * countBetter(summary.overComplexFunctionCount, staticQualityPolicy.complexFunctionBudget)
  const sizeScore =
    90 * lowerBetter(summary.maxFunctionLines, defaultThresholds.functionLines) +
    60 * lowerBetter(summary.maxFileLines, defaultThresholds.fileLines)
  const couplingScore =
    100 * lowerBetter(summary.maxCoupling, defaultThresholds.coupling) +
    50 * lowerBetter(summary.avgCoupling, staticQualityPolicy.averageCouplingTarget)
  const score = roundScore(architectureScore + maintainabilityScore + complexityScore + sizeScore + couplingScore)

  return {
    policy: staticQualityPolicy,
    score,
    northStarScore: staticQualityPolicy.northStarScore,
    phase: staticQualityPhase(score),
    components: {
      architecture: roundScore(architectureScore),
      maintainability: roundScore(maintainabilityScore),
      complexity: roundScore(complexityScore),
      size: roundScore(sizeScore),
      coupling: roundScore(couplingScore),
    },
    inputs: {
      maxCyclomaticComplexity: summary.maxCyclomaticComplexity,
      maxCognitiveComplexity: summary.maxCognitiveComplexity,
      overComplexFunctionCount: summary.overComplexFunctionCount,
      maxFunctionLines: summary.maxFunctionLines,
      maxFileLines: summary.maxFileLines,
      maxCoupling: summary.maxCoupling,
      avgCoupling: summary.avgCoupling,
      minMaintainability: summary.minMaintainability,
      avgMaintainability: summary.avgMaintainability,
      cycleCount: summary.cycleCount,
      architectureViolationCount: summary.architectureViolationCount,
    },
  }
}

function staticQualityPhase(score) {
  if (score >= staticQualityPolicy.northStarScore) return 'north-star-900'
  if (score >= 800) return 'product-hardening-800'
  if (score >= 700) return 'architecture-improvement-700'
  if (score >= staticQualityPolicy.minimumGateScore) return 'stabilization-600'
  return 'foundation-below-600'
}

function analyzeTypeScriptFile(file, content, allFileSet) {
  const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind)
  const functions = []
  const imports = new Set()

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (isTypeOnlyModuleReference(node)) {
        ts.forEachChild(node, visit)
        return
      }
      const moduleSpecifier = node.moduleSpecifier
      if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
        const resolved = resolveTypeScriptImport(file, moduleSpecifier.text, allFileSet)
        if (resolved) imports.add(resolved)
      }
    }

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [firstArg] = node.arguments
      if (firstArg && ts.isStringLiteral(firstArg)) {
        const resolved = resolveTypeScriptImport(file, firstArg.text, allFileSet)
        if (resolved) imports.add(resolved)
      }
    }

    if (isFunctionLike(node)) {
      functions.push(analyzeTypeScriptFunction(file, content, sourceFile, node))
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return buildFileReport(file, content, functions, [...imports])
}

function analyzeTypeScriptFunction(file, content, sourceFile, node) {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line
  const lines = content.split(/\r?\n/).slice(start, end + 1)
  const metrics = computeTypeScriptComplexity(node)

  return {
    file,
    name: getFunctionName(node, sourceFile, start + 1),
    startLine: start + 1,
    endLine: end + 1,
    nonBlankLines: countNonBlankLines(lines.join('\n')),
    cyclomaticComplexity: metrics.cyclomaticComplexity,
    cognitiveComplexity: metrics.cognitiveComplexity,
  }
}

function computeTypeScriptComplexity(root) {
  let cyclomaticComplexity = 1
  let cognitiveComplexity = 0

  function walk(node, nesting) {
    if (node !== root && isFunctionLike(node)) return

    let nextNesting = nesting
    if (
      ts.isIfStatement(node) ||
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isCatchClause(node) ||
      ts.isConditionalExpression(node)
    ) {
      cyclomaticComplexity += 1
      cognitiveComplexity += 1 + nesting
      nextNesting += 1
    } else if (ts.isCaseClause(node)) {
      cyclomaticComplexity += 1
      cognitiveComplexity += 1
    } else if (ts.isBinaryExpression(node) && isLogicalOperator(node.operatorToken.kind)) {
      cyclomaticComplexity += 1
      cognitiveComplexity += 1
    }

    ts.forEachChild(node, (child) => walk(child, nextNesting))
  }

  walk(root, 0)
  return { cyclomaticComplexity, cognitiveComplexity }
}

function analyzeRustFile(file, content, allFileSet) {
  const lines = content.split(/\r?\n/)
  const functions = []
  const imports = new Set()
  const sanitizeForImports = makeRustCodeSanitizer()

  for (let i = 0; i < lines.length; i += 1) {
    const codeLine = sanitizeForImports(lines[i])
    const modMatch = codeLine.match(/^\s*(?:pub\s+)?mod\s+([a-zA-Z0-9_]+)\s*;/)
    if (modMatch) {
      const resolved = resolveRustModule(file, modMatch[1], allFileSet)
      if (resolved) imports.add(resolved)
    }

    const useMatch = codeLine.match(/^\s*use\s+crate::([a-zA-Z0-9_]+)(?:::([a-zA-Z0-9_]+))?/)
    if (useMatch) {
      const resolved = resolveRustCrateUse(useMatch[1], useMatch[2], allFileSet)
      if (resolved && resolved !== file && !isRustParentModuleReference(file, resolved)) imports.add(resolved)
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const signature = lines[i].match(/\bfn\s+([a-zA-Z0-9_]+)\s*(?:<[^>]+>)?\s*\(/)
    if (!signature) continue

    const start = i
    let end = i
    let braceDepth = 0
    let seenBody = false
    const sanitizeForBody = makeRustCodeSanitizer()

    for (let j = i; j < lines.length; j += 1) {
      const line = sanitizeForBody(lines[j])
      const open = countMatches(line, /\{/g)
      const close = countMatches(line, /\}/g)
      if (open > 0) seenBody = true
      braceDepth += open - close
      end = j
      if (seenBody && braceDepth <= 0) break
    }

    const body = lines.slice(start, end + 1)
    const metrics = computeRustComplexity(body)
    functions.push({
      file,
      name: signature[1],
      startLine: start + 1,
      endLine: end + 1,
      nonBlankLines: countNonBlankLines(body.join('\n')),
      cyclomaticComplexity: metrics.cyclomaticComplexity,
      cognitiveComplexity: metrics.cognitiveComplexity,
    })
    i = end
  }

  return buildFileReport(file, content, functions, [...imports])
}

function computeRustComplexity(lines) {
  let cyclomaticComplexity = 1
  let cognitiveComplexity = 0
  let nesting = 0
  const sanitize = makeRustCodeSanitizer()

  for (const rawLine of lines) {
    const line = sanitize(rawLine)
    const decisions = countMatches(line, /\b(if|for|while|loop|match)\b|\?|&&|\|\|/g)
    if (decisions > 0) {
      cyclomaticComplexity += decisions
      cognitiveComplexity += decisions * (1 + nesting)
    }
    nesting = Math.max(0, nesting + countMatches(line, /\{/g) - countMatches(line, /\}/g))
  }

  return { cyclomaticComplexity, cognitiveComplexity }
}

function makeRustCodeSanitizer() {
  let inBlockComment = false
  return (line) => {
    let out = ''
    let inString = false
    let inChar = false
    let inRawString = false
    let rawHashes = 0
    let escaped = false

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i]
      const next = line[i + 1]

      if (inBlockComment) {
        if (char === '*' && next === '/') {
          inBlockComment = false
          i += 1
        }
        out += ' '
        continue
      }

      if (inRawString) {
        if (char === '"') {
          let hashes = 0
          while (line[i + 1 + hashes] === '#') hashes += 1
          if (hashes === rawHashes) {
            inRawString = false
            i += hashes
          }
        }
        out += ' '
        continue
      }

      if (inString) {
        if (!escaped && char === '"') inString = false
        escaped = !escaped && char === '\\'
        if (char !== '\\') escaped = false
        out += ' '
        continue
      }

      if (inChar) {
        if (!escaped && char === "'") inChar = false
        escaped = !escaped && char === '\\'
        if (char !== '\\') escaped = false
        out += ' '
        continue
      }

      if (char === '/' && next === '/') break
      if (char === '/' && next === '*') {
        inBlockComment = true
        out += ' '
        i += 1
        continue
      }
      if (char === 'r' && (next === '"' || next === '#')) {
        const rest = line.slice(i)
        const match = rest.match(/^r(#+)?"/)
        if (match) {
          inRawString = true
          rawHashes = match[1]?.length ?? 0
          out += ' '.repeat(match[0].length)
          i += match[0].length - 1
          continue
        }
      }
      if (char === '"') {
        inString = true
        escaped = false
        out += ' '
        continue
      }
      if (char === "'") {
        inChar = true
        escaped = false
        out += ' '
        continue
      }

      out += char
    }

    return out
  }
}

function buildFileReport(file, content, functions, imports) {
  const nonBlankLines = countNonBlankLines(content)
  const coupling = imports.length
  const maxCyclomatic = max(functions.map((fn) => fn.cyclomaticComplexity), 1)
  const maxCognitive = max(functions.map((fn) => fn.cognitiveComplexity), 0)
  const maintainability = calculateMaintainability(nonBlankLines, functions, coupling)

  return {
    path: file,
    nonBlankLines,
    functionCount: functions.length,
    maxCyclomaticComplexity: maxCyclomatic,
    maxCognitiveComplexity: maxCognitive,
    coupling,
    maintainability,
    imports,
    functions,
  }
}

function calculateMaintainability(nonBlankLines, functions, coupling) {
  const avgCyclomatic = functions.length === 0
    ? 1
    : functions.reduce((sum, fn) => sum + fn.cyclomaticComplexity, 0) / functions.length
  const maxCognitive = max(functions.map((fn) => fn.cognitiveComplexity), 0)
  const score = 100
    - Math.max(0, nonBlankLines - 80) * 0.04
    - avgCyclomatic * 2
    - maxCognitive * 0.8
    - coupling * 1.5

  return Math.max(0, Math.min(100, Number(score.toFixed(2))))
}

function evaluateViolations(analysis, thresholds, currentMode, staticQuality, staticQualityGate) {
  const violations = []

  for (const file of analysis.files) {
    if (file.nonBlankLines > thresholds.fileLines) {
      violations.push({
        file: file.path,
        metric: 'fileLines',
        message: `file has ${file.nonBlankLines} non-blank lines, threshold is ${thresholds.fileLines}`,
      })
    }

    if (file.coupling > thresholds.coupling) {
      violations.push({
        file: file.path,
        metric: 'coupling',
        message: `coupling score is ${file.coupling}, threshold is ${thresholds.coupling}`,
      })
    }

    if (file.maintainability < thresholds.maintainability) {
      violations.push({
        file: file.path,
        metric: 'maintainability',
        message: `maintainability score is ${file.maintainability}, threshold is ${thresholds.maintainability}`,
      })
    }

    for (const fn of file.functions) {
      if (fn.cyclomaticComplexity > thresholds.cyclomaticComplexity) {
        violations.push({
          file: fn.file,
          name: fn.name,
          metric: 'cyclomaticComplexity',
          message: `cyclomatic complexity is ${fn.cyclomaticComplexity}, threshold is ${thresholds.cyclomaticComplexity}`,
        })
      }
      if (fn.cognitiveComplexity > thresholds.cognitiveComplexity) {
        violations.push({
          file: fn.file,
          name: fn.name,
          metric: 'cognitiveComplexity',
          message: `cognitive complexity is ${fn.cognitiveComplexity}, threshold is ${thresholds.cognitiveComplexity}`,
        })
      }
      if (fn.nonBlankLines > thresholds.functionLines) {
        violations.push({
          file: fn.file,
          name: fn.name,
          metric: 'functionLines',
          message: `function has ${fn.nonBlankLines} non-blank lines, threshold is ${thresholds.functionLines}`,
        })
      }
    }
  }

  for (const violation of analysis.architectureViolations) {
    violations.push({
      file: violation.from,
      metric: 'architectureRule',
      message: `forbidden import to ${violation.to}: ${violation.reason}`,
    })
  }

  if (currentMode === 'prepush') {
    for (const cycle of analysis.cycles) {
      violations.push({
        file: cycle[0],
        metric: 'circularDependency',
        message: `circular dependency: ${cycle.join(' -> ')}`,
      })
    }

    if (staticQuality.score < staticQualityGate.minimumScore) {
      violations.push({
        file: 'repository',
        metric: 'staticQualityScore',
        message: `static quality score is ${staticQuality.score}/1000, gate is ${staticQualityGate.minimumScore}/1000, north-star is ${staticQualityGate.northStarScore}/1000`,
      })
    }
  }

  return violations
}

function buildEffectiveStaticQualityGate(baseline) {
  const baselineScore = baseline?.staticQuality?.score
  return {
    policyVersion: staticQualityPolicy.version,
    minimumScore: Math.max(staticQualityPolicy.minimumGateScore, baselineScore ?? 0),
    northStarScore: staticQualityPolicy.northStarScore,
    hardFailCycles: true,
    hardFailArchitectureViolations: true,
  }
}

function buildEffectiveThresholds(baseline) {
  const repository = baseline?.repository ?? {}
  return {
    cyclomaticComplexity: Math.max(defaultThresholds.cyclomaticComplexity, repository.maxCyclomaticComplexity ?? 0),
    cognitiveComplexity: Math.max(defaultThresholds.cognitiveComplexity, repository.maxCognitiveComplexity ?? 0),
    functionLines: Math.max(defaultThresholds.functionLines, repository.maxFunctionLines ?? 0),
    fileLines: Math.max(defaultThresholds.fileLines, repository.maxFileLines ?? 0),
    coupling: Math.max(defaultThresholds.coupling, repository.maxCoupling ?? 0),
    maintainability: Math.min(defaultThresholds.maintainability, repository.minMaintainability ?? defaultThresholds.maintainability),
  }
}

function getStagedSourceFiles(allSourceFiles) {
  const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .map(normalizePath)

  const sourceSet = new Set(allSourceFiles)
  return staged.filter((file) => sourceSet.has(file))
}

function readStagedFile(file) {
  return execFileSync('git', ['show', `:${file}`], { encoding: 'utf8' })
}

function listSourceFiles() {
  const files = []
  walk(path.join(repoRoot, 'src'), files)
  walk(path.join(repoRoot, 'src-tauri', 'src'), files)
  return files
    .map((file) => normalizePath(path.relative(repoRoot, file)))
    .filter((file) => {
      if (file === 'src/vite-env.d.ts') return false
      return /\.(ts|tsx|rs)$/.test(file)
    })
    .sort()
}

function walk(dir, files) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, files)
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }
}

function resolveTypeScriptImport(fromFile, specifier, allFileSet) {
  if (!specifier.startsWith('.')) return null

  const base = normalizePath(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier)))
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]

  return candidates.find((candidate) => allFileSet.has(candidate)) ?? null
}

function resolveRustModule(fromFile, moduleName, allFileSet) {
  const baseDir = path.posix.dirname(fromFile)
  const candidates = [
    `${baseDir}/${moduleName}.rs`,
    `${baseDir}/${moduleName}/mod.rs`,
  ].map(normalizePath)

  return candidates.find((candidate) => allFileSet.has(candidate)) ?? null
}

function resolveRustCrateUse(moduleName, childName, allFileSet) {
  if (childName) {
    const childCandidates = [
      `src-tauri/src/${moduleName}/${childName}.rs`,
      `src-tauri/src/${moduleName}/${childName}/mod.rs`,
    ]
    const childResolved = childCandidates.find((candidate) => allFileSet.has(candidate))
    if (childResolved) return childResolved
  }

  const candidates = [
    `src-tauri/src/${moduleName}.rs`,
    `src-tauri/src/${moduleName}/mod.rs`,
  ]

  return candidates.find((candidate) => allFileSet.has(candidate)) ?? null
}

function isRustParentModuleReference(fromFile, toFile) {
  if (!toFile.endsWith('/mod.rs')) return false
  const parentDir = path.posix.dirname(toFile)
  return fromFile.startsWith(`${parentDir}/`) && fromFile !== toFile
}

function findArchitectureViolations(graph, rules) {
  const violations = []
  const forbiddenImports = rules.forbiddenImports ?? []

  for (const [from, imports] of graph.entries()) {
    for (const to of imports) {
      for (const rule of forbiddenImports) {
        if (!matchesPrefix(from, rule.fromPrefix)) continue
        if ((rule.fromNotPrefix ?? []).some((prefix) => matchesPrefix(from, prefix))) continue
        if (!matchesPrefix(to, rule.toPrefix)) continue
        violations.push({ from, to, reason: rule.reason ?? 'Forbidden import.' })
      }
    }
  }

  return violations
}

function findCycles(graph) {
  const cycles = []
  const seen = new Set()
  const visiting = new Set()
  const visited = new Set()

  function visit(node, stack) {
    if (visiting.has(node)) {
      const cycle = stack.slice(stack.indexOf(node)).concat(node)
      const key = canonicalCycleKey(cycle)
      if (!seen.has(key)) {
        seen.add(key)
        cycles.push(cycle)
      }
      return
    }

    if (visited.has(node)) return

    visiting.add(node)
    const nextStack = stack.concat(node)
    for (const next of graph.get(node) ?? []) {
      if (graph.has(next)) visit(next, nextStack)
    }
    visiting.delete(node)
    visited.add(node)
  }

  for (const node of graph.keys()) {
    visit(node, [])
  }

  return cycles
}

function canonicalCycleKey(cycle) {
  const unique = cycle.slice(0, -1)
  const rotations = unique.map((_, index) => unique.slice(index).concat(unique.slice(0, index)).join('>'))
  return rotations.sort()[0]
}

function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
}

function isTypeOnlyModuleReference(node) {
  if (ts.isImportDeclaration(node)) {
    return node.importClause?.isTypeOnly === true
  }
  if (ts.isExportDeclaration(node)) {
    return node.isTypeOnly === true
  }
  return false
}

function getFunctionName(node, sourceFile, fallbackLine) {
  if (node.name) return node.name.getText(sourceFile)
  const parent = node.parent
  if (parent && ts.isVariableDeclaration(parent) && parent.name) {
    return parent.name.getText(sourceFile)
  }
  if (parent && ts.isPropertyAssignment(parent) && parent.name) {
    return parent.name.getText(sourceFile)
  }
  return `anonymous@${fallbackLine}`
}

function isLogicalOperator(kind) {
  return kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    kind === ts.SyntaxKind.BarBarToken ||
    kind === ts.SyntaxKind.QuestionQuestionToken
}

function countNonBlankLines(content) {
  return content.split(/\r?\n/).filter((line) => line.trim().length > 0).length
}

function lowerBetter(value, target) {
  if (value <= target) return 1
  return (target / value) ** 2
}

function higherBetter(value, target) {
  if (value >= target) return 1
  return (value / target) ** 2
}

function countBetter(count, budget) {
  if (count <= budget) return 1
  return (budget / count) ** 2
}

function boundedScore(value) {
  return Math.max(0, value)
}

function roundScore(value) {
  return Number(value.toFixed(1))
}

function average(values) {
  if (values.length === 0) return 0
  return roundScore(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length
}

function matchesPrefix(file, prefix) {
  return normalizePath(file).startsWith(normalizePath(prefix))
}

function normalizePath(file) {
  return file.split(path.sep).join('/')
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function relative(file) {
  return normalizePath(path.relative(repoRoot, file))
}

function max(values, fallback) {
  return values.length > 0 ? Math.max(...values) : fallback
}

function min(values, fallback) {
  return values.length > 0 ? Math.min(...values) : fallback
}

function fail(message) {
  console.error(`[metrics] ${message}`)
  process.exit(1)
}
