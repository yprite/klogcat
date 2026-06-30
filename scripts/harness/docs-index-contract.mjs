import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname)
const docsRoot = path.join(repoRoot, 'docs')
const indexPath = path.join(docsRoot, 'INDEX.md')
const agentsPath = path.join(repoRoot, 'AGENTS.md')

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    if (!entry.isFile()) return []
    return [path.relative(repoRoot, full)]
  })
}

function fail(message) {
  console.error(`FAIL ${message}`)
  process.exitCode = 1
}

if (!fs.existsSync(indexPath)) fail('docs/INDEX.md is missing')
if (!fs.existsSync(agentsPath)) fail('AGENTS.md is missing')

const index = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : ''
const agents = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : ''
const docs = walk(docsRoot)
  .filter((file) => file !== 'docs/INDEX.md')
  .sort()

for (const file of docs) {
  if (!index.includes(file)) fail(`${file} is not listed in docs/INDEX.md`)
}

if (!index.includes('Agent reading protocol')) fail('docs/INDEX.md must include Agent reading protocol')
if (!index.includes('Task routing')) fail('docs/INDEX.md must include Task routing')
if (!agents.includes('docs/INDEX.md')) fail('AGENTS.md must instruct agents to read docs/INDEX.md first')

if (!process.exitCode) {
  console.log('docs-index-contract: all docs indexed')
}
