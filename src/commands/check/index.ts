import c from 'ansis'
import { createSqliteCache } from '../../cache/index'
import { loadPackages } from '../../io/packages'
import { resolvePackage } from '../../io/resolve'
import { writePackage } from '../../io/write'
import type { BumpOptions, DiffType, ResolvedDepChange } from '../../types'
import { createLogger } from '../../utils/logger'
import { loadNpmrc } from '../../utils/npmrc'
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
    publishedAt?: string
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

    // Create cache and npmrc once for all packages
    const cache = createSqliteCache()
    const npmrc = loadNpmrc(options.cwd)

    // Collect workspace package names to skip private/internal deps
    const workspacePackageNames = new Set(packages.map((p) => p.name).filter(Boolean))

    // Progress indicator — only in TTY mode with table output
    const showProgress =
      process.stdout.isTTY && options.output !== 'json' && options.loglevel !== 'silent'
    const totalDeps = packages.reduce((sum, p) => sum + p.deps.filter((d) => d.update).length, 0)
    let resolvedCount = 0

    // Preserve any existing user callback
    const userOnResolved = options.onDependencyResolved
    if (showProgress && totalDeps > 0) {
      options.onDependencyResolved = (pkg, dep) => {
        resolvedCount++
        process.stdout.write(`\rResolving dependencies... ${resolvedCount}/${totalDeps}`)
        return userOnResolved?.(pkg, dep)
      }
    }

    try {
      for (const pkg of packages) {
        options.beforePackageStart?.(pkg)

        // Resolve all dependencies
        pkg.resolved = await resolvePackage(pkg, options, cache, npmrc, workspacePackageNames)

        const updates = pkg.resolved.filter((d) => d.diff !== 'none' && d.diff !== 'error')

        if (updates.length === 0) {
          // --all: show packages even when up to date
          if (options.all) {
            if (options.output === 'json') {
              jsonPackages.push(buildJsonPackage(pkg.name, []))
            } else {
              renderUpToDate(pkg.name)
            }
          }
          continue
        }
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
    } finally {
      // Clear progress line
      if (showProgress && totalDeps > 0) {
        process.stdout.write(`\r${' '.repeat(40)}\r`)
        // Restore the original callback
        options.onDependencyResolved = userOnResolved
      }

      const stats = cache.stats()
      cache.close()
      logger.debug(`Cache stats: ${stats.hits} hits, ${stats.misses} misses, ${stats.size} entries`)
    }

    // Print single JSON envelope at the end
    if (options.output === 'json') {
      outputJsonEnvelope(jsonPackages, options)
    }

    if (!hasUpdates) {
      logger.success('All dependencies are up to date')
    }

    // Contextual tips (table output only)
    if (hasUpdates && options.output === 'table') {
      if (options.mode === 'default') {
        logger.info(c.gray('Tip: Run `bump major` to check for major updates'))
      }
      if (!options.write) {
        logger.info(c.gray('Tip: Add `-w` to write changes to package files'))
      }
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
      ...(u.publishedAt ? { publishedAt: u.publishedAt } : {}),
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

function renderUpToDate(packageName: string): void {
  // biome-ignore lint/suspicious/noConsole: intentional output
  const log = console.log
  log()
  log(c.cyan.bold(packageName))
  log(`  ${c.green('All dependencies are up to date')}`)
  log()
}
