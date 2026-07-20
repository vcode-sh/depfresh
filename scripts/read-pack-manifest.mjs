import { readFileSync } from 'node:fs'
import { extractSinglePackEntry } from './pack-manifest.mjs'

const [manifestPath, field, ...extraArguments] = process.argv.slice(2)

try {
  if (
    !manifestPath ||
    extraArguments.length > 0 ||
    (field !== 'filename' && field !== 'integrity')
  ) {
    throw new Error('Expected a manifest path and field')
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const value = extractSinglePackEntry(manifest)[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Expected a non-empty pack manifest field')
  }

  process.stdout.write(value)
} catch {
  process.exitCode = 1
}
