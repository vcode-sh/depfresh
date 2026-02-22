import { loadPackages } from '../../io/packages'
import { resolvePackage } from '../../io/resolve'
import { writePackage } from '../../io/write'
import type { BumpOptions, DiffType, ResolvedDepChange } from '../../types'
import { createLogger } from '../../utils/logger'
import { renderTable } from './render'

interface JsonPackage {
  name: string
  updates: Array<{
    name: string
    current: string
    target: string
    diff: string
    source: string
    deprecated?: string | boolean
  }>
}

interface JsonOutput {
  packages: JsonPackage[]
  summary: {
    total: number
    major: number
    minor: number
    patch: number
    packages: number
  }
  meta: {
    cwd: string
    mode: string
    timestamp: string
  }
}

export async function check(options: BumpOptions): Promise<number> {
  try {
    const logLevel = options.output === 'json' ? 'silent' : options.loglevel
    const logger = createLogger(logLevel)

    // Load all packages
    const packages = await loadPackages(options)

    if (packages.length === 0) {
      logger.warn('No packages found')
      if (options.output === 'json') {
        outputJsonEnvelope([], options)
      }
      return 0
    }

    let hasUpdates = false
    const jsonPackages: JsonPackage[] = []

    for (const pkg of packages) {
      options.beforePackageStart?.(pkg)

      // Resolve all dependencies
      pkg.resolved = await resolvePackage(pkg, options)

      const updates = pkg.resolved.filter((d) => d.diff !== 'none' && d.diff !== 'error')

      if (updates.length === 0) continue
      hasUpdates = true

      // Collect JSON output for later
      if (options.output === 'json') {
        jsonPackages.push(buildJsonPackage(pkg.name, updates))
      } else {
        renderTable(pkg.name, updates, options)
      }

      // Interactive mode
      if (options.interactive) {
        const { runInteractive } = await import('./interactive')
        const selected = await runInteractive(updates)
        if (selected.length === 0) continue

        if (options.write) {
          const shouldWrite = (await options.beforePackageWrite?.(pkg)) ?? true
          if (shouldWrite) {
            writePackage(pkg, selected, options.loglevel)
            options.afterPackageWrite?.(pkg)
          }
        }
      } else if (options.write) {
        const shouldWrite = (await options.beforePackageWrite?.(pkg)) ?? true
        if (shouldWrite) {
          writePackage(pkg, updates, options.loglevel)
          options.afterPackageWrite?.(pkg)
        }
      }
    }

    // Print single JSON envelope at the end
    if (options.output === 'json') {
      outputJsonEnvelope(jsonPackages, options)
    }

    if (!hasUpdates) {
      logger.success('All dependencies are up to date')
    }

    return hasUpdates && !options.write ? 1 : 0
  } catch (error) {
    const logger = createLogger(options.loglevel)
    logger.error('Check failed:', error instanceof Error ? error.message : String(error))
    return 2
  }
}

function buildJsonPackage(name: string, updates: ResolvedDepChange[]): JsonPackage {
  return {
    name,
    updates: updates.map((u) => ({
      name: u.name,
      current: u.currentVersion,
      target: u.targetVersion,
      diff: u.diff,
      source: u.source,
      ...(u.deprecated ? { deprecated: u.deprecated } : {}),
    })),
  }
}

function outputJsonEnvelope(packages: JsonPackage[], options: BumpOptions): void {
  const allUpdates = packages.flatMap((p) => p.updates)

  const count = (diff: DiffType) => allUpdates.filter((u) => u.diff === diff).length

  const output: JsonOutput = {
    packages,
    summary: {
      total: allUpdates.length,
      major: count('major'),
      minor: count('minor'),
      patch: count('patch'),
      packages: packages.length,
    },
    meta: {
      cwd: options.cwd,
      mode: options.mode,
      timestamp: new Date().toISOString(),
    },
  }

  // biome-ignore lint/suspicious/noConsole: intentional JSON output
  console.log(JSON.stringify(output, null, 2))
}
