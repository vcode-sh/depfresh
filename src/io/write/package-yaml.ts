import { readFileSync, writeFileSync } from 'node:fs'
import detectIndent from 'detect-indent'
import YAML from 'yaml'
import { WriteError } from '../../errors'
import type { PackageMeta, ResolvedDepChange } from '../../types'
import type { createLogger } from '../../utils/logger'
import { detectLineEnding } from './text'
import { rebuildVersion } from './version-utils'

export function writePackageYaml(
  pkg: PackageMeta,
  changes: ResolvedDepChange[],
  logger: ReturnType<typeof createLogger>,
): void {
  let content: string
  try {
    content = readFileSync(pkg.filepath, 'utf-8')
  } catch (error) {
    throw new WriteError(`Failed to read ${pkg.filepath}`, { cause: error })
  }

  const doc = YAML.parseDocument(content)
  if (doc.errors.length > 0) {
    const details = doc.errors.map((error) => error.message).join('; ')
    throw new WriteError(`Failed to parse YAML in ${pkg.filepath}: ${details}`)
  }

  // Keep existing indentation style if detectable. YAML doesn't support tabs; fallback to 2 spaces.
  const indent = detectIndent(content).indent || pkg.indent
  const indentWidth = indent === '\t' ? 2 : Math.max(indent.length, 1)

  const bySource = new Map<string, ResolvedDepChange[]>()
  for (const change of changes) {
    const group = bySource.get(change.source) ?? []
    group.push(change)
    bySource.set(change.source, group)
  }

  for (const [source, sourceChanges] of bySource) {
    const section = getSection(doc, source)
    if (!section) continue

    for (const change of sourceChanges) {
      if (!section.has(change.name)) continue

      const currentValue = section.get(change.name, true)
      const oldVersion = getStringValue(currentValue)
      if (oldVersion === null) continue

      section.set(change.name, rebuildVersion(oldVersion, change.targetVersion))
      logger.debug(`  ${change.name}: ${oldVersion} -> ${section.get(change.name)}`)
    }
  }

  const pmChange = changes.find((c) => c.source === 'packageManager')
  if (pmChange && pkg.packageManager) {
    const newPm = pkg.packageManager.hash
      ? `${pkg.packageManager.name}@${pmChange.targetVersion}+${pkg.packageManager.hash}`
      : `${pkg.packageManager.name}@${pmChange.targetVersion}`
    doc.set('packageManager', newPm)
  }

  const lineEnding = detectLineEnding(content)
  const serialized = doc.toString({ indent: indentWidth })
  const withoutTrailing = serialized.replace(/\r?\n$/, '')
  const withTrailing = content.endsWith('\n') ? `${withoutTrailing}\n` : withoutTrailing
  const finalContent = lineEnding === '\r\n' ? withTrailing.replace(/\n/g, '\r\n') : withTrailing

  try {
    writeFileSync(pkg.filepath, finalContent, 'utf-8')
  } catch (error) {
    throw new WriteError(`Failed to write ${pkg.filepath}`, { cause: error })
  }

  logger.success(`Updated ${pkg.filepath} (${changes.length} changes)`)
}

function getSection(doc: YAML.Document, source: string): YAML.YAMLMap | null {
  const path = source.includes('.') ? source.split('.') : [source]
  const section = doc.getIn(path, true)
  if (!YAML.isMap(section)) return null
  return section
}

function getStringValue(value: unknown): string | null {
  if (YAML.isScalar(value)) {
    return typeof value.value === 'string' ? value.value : null
  }
  return typeof value === 'string' ? value : null
}
