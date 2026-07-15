import { execFileSync, execSync } from 'node:child_process'
import * as semver from 'semver'
import type { PackageManagerName, PackageMeta, RawDep } from '../types'
import { createLogger } from '../utils/logger'
import {
  dedupeGlobalPackageRecords,
  GLOBAL_ALL_PACKAGE_MANAGERS,
  getGlobalExpectedVersion,
  getGlobalWriteTargets,
} from './global-targets'

export function detectGlobalPackageManager(pm?: string): PackageManagerName {
  if (pm && (pm === 'npm' || pm === 'pnpm' || pm === 'bun')) {
    return pm
  }

  // Try pnpm first, then bun, fallback to npm
  try {
    execSync('pnpm --version', { stdio: 'ignore' })
    return 'pnpm'
  } catch {}

  try {
    execSync('bun --version', { stdio: 'ignore' })
    return 'bun'
  } catch {}

  return 'npm'
}

export function parseNpmGlobalList(json: string): Array<{ name: string; version: string }> {
  try {
    const data = JSON.parse(json)
    if (!data.dependencies || typeof data.dependencies !== 'object') {
      return []
    }
    return Object.entries(data.dependencies).flatMap(([name, info]) => {
      const version = (info as { version?: unknown } | undefined)?.version
      if (typeof version !== 'string' || semver.valid(version) === null) {
        return []
      }

      return [{ name, version }]
    })
  } catch {
    return []
  }
}

export function parsePnpmGlobalList(json: string): Array<{ name: string; version: string }> {
  try {
    const data = JSON.parse(json)
    if (!Array.isArray(data) || data.length === 0) {
      return []
    }
    const deps = data[0]?.dependencies
    if (!deps || typeof deps !== 'object') {
      return []
    }
    return Object.entries(deps).flatMap(([name, info]) => {
      const version = (info as { version?: unknown } | undefined)?.version
      if (typeof version !== 'string' || semver.valid(version) === null) {
        return []
      }

      return [{ name, version }]
    })
  } catch {
    return []
  }
}

export function parseBunGlobalList(output: string): Array<{ name: string; version: string }> {
  const results: Array<{ name: string; version: string }> = []
  const lines = output.split('\n')

  for (const line of lines) {
    const match = line.match(/[├└]──\s+(.+)@(\d.+)/)
    if (match) {
      results.push({ name: match[1]!, version: match[2]! })
    }
  }

  return results
}

export function listGlobalPackages(
  pm: PackageManagerName,
): Array<{ name: string; version: string }> {
  try {
    switch (pm) {
      case 'npm': {
        const output = execSync('npm list -g --depth=0 --json', { encoding: 'utf-8' })
        return parseNpmGlobalList(output)
      }
      case 'pnpm': {
        const output = execSync('pnpm list -g --json', { encoding: 'utf-8' })
        return parsePnpmGlobalList(output)
      }
      case 'bun': {
        const output = execSync('bun pm ls -g', { encoding: 'utf-8' })
        return parseBunGlobalList(output)
      }
      case 'yarn':
        return []
    }
  } catch {
    return []
  }
}

export function loadGlobalPackages(pm?: string): PackageMeta[] {
  const detectedPm = detectGlobalPackageManager(pm)
  const packages = listGlobalPackages(detectedPm)

  if (packages.length === 0) {
    return []
  }

  const deps: RawDep[] = packages.map((pkg) => ({
    name: pkg.name,
    currentVersion: pkg.version,
    rawVersion: pkg.version,
    source: 'dependencies' as const,
    update: true,
    parents: [],
  }))

  return [
    {
      name: 'Global packages',
      type: 'global',
      filepath: `global:${detectedPm}`,
      deps,
      resolved: [],
      raw: {
        managersByDependency: Object.fromEntries(packages.map((pkg) => [pkg.name, [detectedPm]])),
        versionsByDependency: Object.fromEntries(
          packages.map((pkg) => [pkg.name, { [detectedPm]: pkg.version }]),
        ),
      },
      indent: '  ',
    },
  ]
}

export function loadGlobalPackagesAll(): PackageMeta[] {
  const records = GLOBAL_ALL_PACKAGE_MANAGERS.flatMap((manager) =>
    listGlobalPackages(manager).map((pkg) => ({
      manager,
      name: pkg.name,
      version: pkg.version,
    })),
  )

  if (records.length === 0) {
    return []
  }

  const deduped = dedupeGlobalPackageRecords(records)
  const deps: RawDep[] = deduped.packages.map((pkg) => ({
    name: pkg.name,
    currentVersion: pkg.version,
    rawVersion: pkg.version,
    source: 'dependencies' as const,
    update: true,
    parents: [],
  }))

  return [
    {
      name: 'Global packages',
      type: 'global',
      filepath: `global:${GLOBAL_ALL_PACKAGE_MANAGERS.join('+')}`,
      deps,
      resolved: [],
      raw: {
        managersByDependency: deduped.managersByDependency,
        versionsByDependency: deduped.versionsByDependency,
      },
      indent: '  ',
    },
  ]
}

const NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

export function isValidGlobalWriteTarget(name: string, version: string): boolean {
  if (!NPM_NAME_RE.test(name)) return false
  const bare = version.replace(/^[\^~]/, '')
  return semver.valid(bare) !== null
}

export interface GlobalPackageObservation {
  known: boolean
  version?: string
}

export function observeGlobalPackageVersion(
  pm: PackageManagerName,
  name: string,
): GlobalPackageObservation {
  try {
    let packages: Array<{ name: string; version: string }>
    switch (pm) {
      case 'npm': {
        const output = execSync('npm list -g --depth=0 --json', { encoding: 'utf-8' })
        JSON.parse(output)
        packages = parseNpmGlobalList(output)
        break
      }
      case 'pnpm': {
        const output = execSync('pnpm list -g --json', { encoding: 'utf-8' })
        JSON.parse(output)
        packages = parsePnpmGlobalList(output)
        break
      }
      case 'bun': {
        const output = execSync('bun pm ls -g', { encoding: 'utf-8' })
        packages = parseBunGlobalList(output)
        break
      }
      case 'yarn':
        return { known: false }
    }
    return { known: true, version: packages.find((pkg) => pkg.name === name)?.version }
  } catch {
    return { known: false }
  }
}

export function writeGlobalPackage(pm: PackageManagerName, name: string, version: string): boolean {
  const logger = createLogger('info')

  if (!isValidGlobalWriteTarget(name, version)) {
    logger.warn(`Skipped global update for ${name}: invalid package name or version`)
    return false
  }

  const spec = `${name}@${version}`
  switch (pm) {
    case 'npm':
      execFileSync('npm', ['install', '-g', spec], { stdio: 'inherit' })
      break
    case 'pnpm':
      execFileSync('pnpm', ['add', '-g', spec], { stdio: 'inherit' })
      break
    case 'bun':
      execFileSync('bun', ['add', '-g', spec], { stdio: 'inherit' })
      break
    case 'yarn':
      logger.warn('Yarn global packages not supported')
      return false
  }
  return true
}

export { getGlobalExpectedVersion, getGlobalWriteTargets }
