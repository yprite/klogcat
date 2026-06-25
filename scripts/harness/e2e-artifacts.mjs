import fs from 'node:fs'
import path from 'node:path'

export function createE2eArtifactDir(kind) {
  const repoRoot = process.cwd()
  const id = `${new Date().toISOString().replace(/[-:.]/g, '').replace('T', 'T').replace('Z', 'Z')}-${process.pid}-${kind}`
  const dir = path.join(repoRoot, '.harness', 'e2e-artifacts', id)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function relativeToRepo(file) {
  return path.relative(process.cwd(), file).split(path.sep).join('/')
}
