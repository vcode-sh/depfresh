import { readFileSync, writeFileSync } from 'node:fs'
import detectIndent from 'detect-indent'
import type { PackageMeta, ResolvedDepChange } from '../types'
import { createLogger } from '../utils/logger'

/**
 * Single-writer architecture: reads once, applies all mutations, writes once.
 * Never allow independent writers to clobber each other.
 */
export function writePackage(
  pkg: PackageMeta,
  changes: ResolvedDepChange[],
  loglevel: 'silent' | 'info' | 'debug' = 'info',
): void {
  const logger = createLogger(loglevel)

  if (changes.length === 0) return

  if (pkg.type === 'package.json') {
    writePackageJson(pkg, changes, logger)
  }

  // TODO: package.yaml writer
  // TODO: catalog writers (pnpm, bun, yarn)
}

function writePackageJson(
  pkg: PackageMeta,
  changes: ResolvedDepChange[],
  logger: ReturnType<typeof createLogger>,
): void {
  // Read fresh content for formatting detection
  const content = readFileSync(pkg.filepath, 'utf-8')
  const indent = detectIndent(content).indent || pkg.indent
  const raw = JSON.parse(content)

  // Group changes by source field
  const bySource = new Map<string, ResolvedDepChange[]>()
  for (const change of changes) {
    const group = bySource.get(change.source) ?? []
    group.push(change)
    bySource.set(change.source, group)
  }

  // Apply all mutations to the single parsed object
  for (const [source, sourceChanges] of bySource) {
    const section = getSection(raw, source)
    if (!section) continue

    for (const change of sourceChanges) {
      if (change.name in section) {
        const oldVersion = section[change.name]
        section[change.name] = rebuildVersion(oldVersion, change.targetVersion)
        logger.debug(`  ${change.name}: ${oldVersion} -> ${section[change.name]}`)
      }
    }
  }

  // Handle packageManager field
  const pmChange = changes.find((c) => c.source === 'packageManager')
  if (pmChange && pkg.packageManager) {
    const newPm = pkg.packageManager.hash
      ? `${pkg.packageManager.name}@${pmChange.targetVersion}+${pkg.packageManager.hash}`
      : `${pkg.packageManager.name}@${pmChange.targetVersion}`
    raw.packageManager = newPm
  }

  // Preserve key order by serializing with the original key order
  const newContent = JSON.stringify(raw, null, indent)
  const finalContent = content.endsWith('\n') ? `${newContent}\n` : newContent

  writeFileSync(pkg.filepath, finalContent, 'utf-8')
  logger.success(`Updated ${pkg.filepath} (${changes.length} changes)`)
}

function getSection(raw: Record<string, unknown>, source: string): Record<string, string> | null {
  if (source.includes('.')) {
    const parts = source.split('.')
    let current: unknown = raw
    for (const part of parts) {
      if (!current || typeof current !== 'object') return null
      current = (current as Record<string, unknown>)[part]
    }
    return current as Record<string, string> | null
  }
  return (raw[source] as Record<string, string>) ?? null
}

function rebuildVersion(original: string, newVersion: string): string {
  // Preserve protocol prefixes like npm:@scope/name@
  const npmMatch = original.match(/^(npm:.+@)/)
  if (npmMatch) return `${npmMatch[1]}${newVersion}`

  const jsrMatch = original.match(/^(jsr:.+@)/)
  if (jsrMatch) return `${jsrMatch[1]}${newVersion}`

  return newVersion
}
