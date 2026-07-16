import { execSync } from 'node:child_process'
import * as semver from 'semver'
import { canonicalJson } from '../contracts/canonical-json'
import { hashExactBytes } from '../contracts/fingerprint'
import { ConfigError } from '../errors'
import { evaluatePolicy } from '../policy'
import type {
  CompiledPolicy,
  GlobalManagerName,
  PackageManagerName,
  PackageMeta,
  RawDep,
} from '../types'
import {
  defaultGlobalProcessRuntime,
  type GlobalProcessRuntime,
  inspectGlobalManager,
} from './global-manager'
import {
  dedupeGlobalPackageRecords,
  GLOBAL_ALL_PACKAGE_MANAGERS,
  getGlobalExpectedVersion,
  getGlobalWriteTargets,
} from './global-targets'

export interface GlobalLoadOptions {
  cwd?: string
  timeoutMs?: number
  inheritedEnv?: NodeJS.ProcessEnv
  compiledPolicy?: CompiledPolicy
}

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

export async function loadGlobalPackagesObserved(
  pm?: string,
  options: GlobalLoadOptions = {},
  runtime: GlobalProcessRuntime = defaultGlobalProcessRuntime,
): Promise<PackageMeta[]> {
  const manager = isGlobalManager(pm) ? pm : await detectObservedManager(options, runtime)
  const inspected = await inspectGlobalManager(manager, observedOptions(options), runtime)
  if (inspected.evidence.status !== 'confirmed') {
    throw new ConfigError(`Global ${manager} inventory is ${inspected.evidence.status}.`, {
      reason: 'GLOBAL_INVENTORY_UNAVAILABLE',
    })
  }
  return globalPackageMeta(
    inspected.evidence.packages.map((pkg) => ({ manager, ...pkg })),
    [inspected.evidence],
    [manager],
    options.compiledPolicy,
  )
}

export async function loadGlobalPackagesAllObserved(
  options: GlobalLoadOptions = {},
  runtime: GlobalProcessRuntime = defaultGlobalProcessRuntime,
): Promise<PackageMeta[]> {
  const evidence = []
  const records: Array<{ manager: GlobalManagerName; name: string; version: string }> = []
  for (const manager of GLOBAL_ALL_PACKAGE_MANAGERS) {
    if (!isGlobalManager(manager)) continue
    const inspected = await inspectGlobalManager(manager, observedOptions(options), runtime)
    evidence.push(inspected.evidence)
    if (inspected.evidence.status !== 'confirmed') continue
    for (const pkg of inspected.evidence.packages) records.push({ manager, ...pkg })
  }
  return globalPackageMeta(records, evidence, GLOBAL_ALL_PACKAGE_MANAGERS, options.compiledPolicy)
}

async function detectObservedManager(
  options: GlobalLoadOptions,
  runtime: GlobalProcessRuntime,
): Promise<GlobalManagerName> {
  for (const manager of ['pnpm', 'bun', 'npm'] as const) {
    const inspected = await inspectGlobalManager(manager, observedOptions(options), runtime)
    if (inspected.evidence.status === 'confirmed') return manager
  }
  throw new ConfigError('No supported global package manager inventory is available.', {
    reason: 'GLOBAL_INVENTORY_UNAVAILABLE',
  })
}

function globalPackageMeta(
  records: Array<{ manager: GlobalManagerName; name: string; version: string }>,
  evidence: unknown[],
  managers: PackageManagerName[],
  policy: CompiledPolicy | undefined,
): PackageMeta[] {
  if (records.length === 0) return []
  const deduped = dedupeGlobalPackageRecords(records)
  const sortedRecords = [...records].sort(
    (left, right) =>
      GLOBAL_ALL_PACKAGE_MANAGERS.indexOf(left.manager) -
        GLOBAL_ALL_PACKAGE_MANAGERS.indexOf(right.manager) ||
      (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
  )
  return [
    {
      name: 'Global packages',
      type: 'global',
      filepath: `global:${managers.join('+')}`,
      deps: sortedRecords.map((pkg) => globalDependency(pkg, policy)),
      resolved: [],
      raw: {
        managersByDependency: deduped.managersByDependency,
        versionsByDependency: deduped.versionsByDependency,
        managerEvidence: evidence,
      },
      indent: '  ',
    },
  ]
}

function globalDependency(
  pkg: { manager: GlobalManagerName; name: string; version: string },
  policy: CompiledPolicy | undefined,
): RawDep {
  const occurrenceId = `global-occurrence-${hashExactBytes(
    canonicalJson({ manager: pkg.manager, name: pkg.name, expectedVersion: pkg.version }),
  ).slice(0, 24)}`
  const prerelease = semver.prerelease(pkg.version)
  const policyDecision = policy
    ? evaluatePolicy(policy, {
        occurrenceId,
        dependencyName: pkg.name,
        catalogRole: 'direct',
        field: 'dependencies',
        role: 'global',
        protocol: 'semver',
        currentVersion: pkg.version,
        currentChannel: prerelease?.[0] === undefined ? 'stable' : String(prerelease[0]),
        specifierStatus: 'locked',
        manager: pkg.manager,
        managerEvidenceStatus: 'confirmed',
      })
    : undefined
  return {
    name: pkg.name,
    currentVersion: pkg.version,
    rawVersion: pkg.version,
    source: 'dependencies',
    update: policyDecision?.status !== 'skipped' && policyDecision?.status !== 'blocked',
    parents: [],
    occurrenceId,
    globalManager: pkg.manager,
    ...(policyDecision ? { policyDecision } : {}),
  }
}

function observedOptions(options: GlobalLoadOptions): {
  cwd: string
  timeoutMs: number
  inheritedEnv?: NodeJS.ProcessEnv
} {
  return {
    cwd: options.cwd ?? process.cwd(),
    timeoutMs: options.timeoutMs ?? 30_000,
    ...(options.inheritedEnv ? { inheritedEnv: options.inheritedEnv } : {}),
  }
}

function isGlobalManager(value: string | undefined): value is GlobalManagerName {
  return value === 'npm' || value === 'pnpm' || value === 'bun'
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

export { getGlobalExpectedVersion, getGlobalWriteTargets }
