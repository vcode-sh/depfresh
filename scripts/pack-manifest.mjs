export function extractSinglePackEntry(manifest) {
  if (Array.isArray(manifest)) {
    if (manifest.length !== 1) throw new Error('Expected one packed package')
    return manifest[0]
  }

  if (!isRecord(manifest)) throw new Error('Expected one packed package')
  const entries = Object.entries(manifest)
  if (entries.length !== 1) throw new Error('Expected one packed package')

  const [packageName, entry] = entries[0]
  if (!isRecord(entry) || entry.name !== packageName) {
    throw new Error('Invalid npm pack manifest')
  }
  return entry
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
