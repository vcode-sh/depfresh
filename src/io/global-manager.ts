import { type Node as JsonNode, parseTree } from 'jsonc-parser'
import * as semver from 'semver'
import { getManagerPhaseSupport } from '../commands/apply/manager-registry'
import {
  type ExecutableHandle,
  type ProcessObservation,
  resolveExecutable,
  runResolvedProcess,
} from '../commands/apply/process-runner'
import { canonicalJson } from '../contracts/canonical-json'
import { hashExactBytes } from '../contracts/fingerprint'
import type { GlobalInventoryPackage, GlobalManagerEvidence, GlobalManagerName } from '../types'
import { isValidPackageName } from '../utils/package-name'

export interface GlobalManagerAdapter {
  manager: GlobalManagerName
  executable: string
  versionArgs: string[]
  inventoryArgs: string[]
  realmArgs?: string[]
  updateArgs(name: string, version: string): string[]
}

const ADAPTERS: Record<GlobalManagerName, GlobalManagerAdapter> = {
  npm: {
    manager: 'npm',
    executable: 'npm',
    versionArgs: ['--version'],
    inventoryArgs: ['list', '-g', '--depth=0', '--json', '--ignore-scripts'],
    realmArgs: ['root', '-g'],
    updateArgs: (name, version) => [
      'install',
      '-g',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--',
      `${name}@${version}`,
    ],
  },
  pnpm: {
    manager: 'pnpm',
    executable: 'pnpm',
    versionArgs: ['--version'],
    inventoryArgs: ['list', '-g', '--depth=0', '--json', '--ignore-scripts'],
    realmArgs: ['root', '-g'],
    updateArgs: (name, version) => [
      'add',
      '-g',
      '--ignore-scripts',
      '--ignore-pnpmfile',
      '--',
      `${name}@${version}`,
    ],
  },
  bun: {
    manager: 'bun',
    executable: 'bun',
    versionArgs: ['--version'],
    inventoryArgs: ['pm', 'ls', '-g'],
    updateArgs: (name, version) => ['add', '-g', '--ignore-scripts', `${name}@${version}`],
  },
}

export interface GlobalProcessRuntime {
  resolve(
    executable: string,
    cwd: string,
    inheritedEnv?: NodeJS.ProcessEnv,
  ): ExecutableHandle | { reason: 'EXECUTABLE_UNAVAILABLE' }
  run(
    executable: ExecutableHandle,
    args: string[],
    options: {
      cwd: string
      timeoutMs: number
      inheritedEnv?: NodeJS.ProcessEnv
      captureStdout?: boolean
    },
  ): Promise<ProcessObservation>
}

export const defaultGlobalProcessRuntime: GlobalProcessRuntime = {
  resolve: resolveExecutable,
  run: runResolvedProcess,
}

export interface InspectedGlobalManager {
  evidence: GlobalManagerEvidence
  executable?: ExecutableHandle
}

export function getGlobalManagerAdapter(manager: GlobalManagerName): GlobalManagerAdapter {
  const adapter = ADAPTERS[manager]
  return {
    ...adapter,
    versionArgs: [...adapter.versionArgs],
    inventoryArgs: [...adapter.inventoryArgs],
    ...(adapter.realmArgs ? { realmArgs: [...adapter.realmArgs] } : {}),
    updateArgs: (name, version) => [...adapter.updateArgs(name, version)],
  }
}

export function isValidGlobalPackageName(name: string): boolean {
  return isValidPackageName(name)
}

export function executableFingerprint(handle: ExecutableHandle): string {
  return hashExactBytes(
    canonicalJson({
      path: handle.path,
      dev: handle.dev.toString(),
      ino: handle.ino.toString(),
      size: handle.size.toString(),
      mtimeNs: handle.mtimeNs.toString(),
    }),
  )
}

export function parseGlobalInventory(
  manager: GlobalManagerName,
  output: string,
): GlobalInventoryPackage[] | undefined {
  let packages: GlobalInventoryPackage[] | undefined
  if (manager === 'bun') {
    packages = parseBun(output)
  } else {
    packages = parseJsonInventory(manager, output)
  }
  if (!packages) return undefined
  const identities = new Set<string>()
  for (const pkg of packages) {
    if (!isValidGlobalPackageName(pkg.name) || semver.valid(pkg.version) === null) return undefined
    if (identities.has(pkg.name)) return undefined
    identities.add(pkg.name)
  }
  return packages.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )
}

export async function inspectGlobalManager(
  manager: GlobalManagerName,
  options: { cwd: string; timeoutMs: number; inheritedEnv?: NodeJS.ProcessEnv },
  runtime: GlobalProcessRuntime = defaultGlobalProcessRuntime,
): Promise<InspectedGlobalManager> {
  const adapter = getGlobalManagerAdapter(manager)
  const executable = runtime.resolve(adapter.executable, options.cwd, options.inheritedEnv)
  if ('reason' in executable) {
    return {
      evidence: managerEvidence(manager, adapter.executable, 'unavailable', executable.reason),
    }
  }
  const versionResult = await runtime.run(executable, adapter.versionArgs, {
    ...options,
    captureStdout: true,
  })
  const managerVersion = successfulVersion(versionResult)
  if (!managerVersion) {
    return {
      evidence: successfulExit(versionResult)
        ? managerEvidence(manager, adapter.executable, 'malformed', 'MANAGER_VERSION_MALFORMED')
        : managerEvidence(
            manager,
            adapter.executable,
            observationStatus(versionResult),
            versionResult.reason,
          ),
      executable,
    }
  }
  if (!supportsManagerVersion(manager, managerVersion)) {
    return {
      evidence: {
        ...managerEvidence(manager, adapter.executable, 'unsupported', 'MANAGER_UNSUPPORTED'),
        executableFingerprint: executableFingerprint(executable),
        managerVersion,
      },
      executable,
    }
  }
  const inventoryResult = await runtime.run(executable, adapter.inventoryArgs, {
    ...options,
    captureStdout: true,
  })
  if (!successfulExit(inventoryResult)) {
    return {
      evidence: {
        ...managerEvidence(
          manager,
          adapter.executable,
          observationStatus(inventoryResult),
          inventoryResult.reason,
        ),
        executableFingerprint: executableFingerprint(executable),
        managerVersion,
      },
      executable,
    }
  }
  const packages = parseGlobalInventory(manager, inventoryResult.stdout ?? '')
  if (!packages) {
    return {
      evidence: {
        ...managerEvidence(manager, adapter.executable, 'malformed', 'INVENTORY_MALFORMED'),
        executableFingerprint: executableFingerprint(executable),
        managerVersion,
      },
      executable,
    }
  }
  const realm = await inspectRealm(
    manager,
    adapter,
    inventoryResult.stdout ?? '',
    executable,
    options,
    runtime,
  )
  if (!realm.value) {
    const failure = realm.failure
    return {
      evidence: {
        ...managerEvidence(
          manager,
          adapter.executable,
          failure ? observationStatus(failure) : 'malformed',
          failure?.reason ?? 'GLOBAL_REALM_UNAVAILABLE',
        ),
        executableFingerprint: executableFingerprint(executable),
        managerVersion,
      },
      executable,
    }
  }
  return {
    evidence: {
      manager,
      executable: adapter.executable,
      status: 'confirmed',
      reason: 'INVENTORY_CONFIRMED',
      executableFingerprint: executableFingerprint(executable),
      realmFingerprint: hashExactBytes(realm.value),
      managerVersion,
      packages,
    },
    executable,
  }
}

export function supportsManagerVersion(manager: GlobalManagerName, value: string): boolean {
  const parsed = semver.parse(value)
  if (!parsed) return false
  const support = getManagerPhaseSupport(manager)
  return support ? semver.satisfies(parsed, support.versionRange) : false
}

async function inspectRealm(
  manager: GlobalManagerName,
  adapter: GlobalManagerAdapter,
  inventoryOutput: string,
  executable: ExecutableHandle,
  options: { cwd: string; timeoutMs: number; inheritedEnv?: NodeJS.ProcessEnv },
  runtime: GlobalProcessRuntime,
): Promise<{ value?: string; failure?: ProcessObservation }> {
  if (manager === 'bun') {
    const header = inventoryOutput
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('├──') && !line.startsWith('└──'))
    return { value: validRealm(header) }
  }
  if (!adapter.realmArgs) return {}
  const result = await runtime.run(executable, adapter.realmArgs, {
    ...options,
    captureStdout: true,
  })
  if (!successfulExit(result)) return { failure: result }
  return { value: validRealm(result.stdout?.trim()) }
}

function validRealm(value: string | undefined): string | undefined {
  if (!value || value.includes('\0') || value.includes('\n') || value.includes('\r')) {
    return undefined
  }
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value) ? value : undefined
}

function managerEvidence(
  manager: GlobalManagerName,
  executable: string,
  status: GlobalManagerEvidence['status'],
  reason: string,
): GlobalManagerEvidence {
  return { manager, executable, status, reason, packages: [] }
}

function successfulExit(result: ProcessObservation): boolean {
  return (
    result.termination === 'exit' &&
    result.terminationConfirmed &&
    result.exitCode === 0 &&
    result.reason === 'PROCESS_EXITED'
  )
}

function successfulVersion(result: ProcessObservation): string | undefined {
  if (!successfulExit(result)) return undefined
  const value = result.stdout?.trim()
  return value && semver.valid(value) ? value : undefined
}

function observationStatus(
  result: ProcessObservation,
): Extract<GlobalManagerEvidence['status'], 'unavailable' | 'timeout' | 'unknown'> {
  if (result.termination === 'timeout') return 'timeout'
  if (result.termination === 'unknown' || !result.terminationConfirmed) return 'unknown'
  return 'unavailable'
}

function parseJsonInventory(
  manager: Extract<GlobalManagerName, 'npm' | 'pnpm'>,
  output: string,
): GlobalInventoryPackage[] | undefined {
  const tree = parseTree(output)
  if (!tree || hasDuplicateKeys(tree)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    return undefined
  }
  let dependencies: unknown
  if (manager === 'npm') {
    if (!isRecord(parsed)) return undefined
    dependencies = parsed.dependencies
  } else {
    if (!Array.isArray(parsed) || parsed.length !== 1 || !isRecord(parsed[0])) return undefined
    dependencies = parsed[0].dependencies
  }
  if (dependencies === undefined) return []
  if (!isRecord(dependencies)) return undefined
  const packages: GlobalInventoryPackage[] = []
  for (const [name, value] of Object.entries(dependencies)) {
    if (!isRecord(value) || typeof value.version !== 'string') return undefined
    packages.push({ name, version: value.version })
  }
  return packages
}

function hasDuplicateKeys(node: JsonNode): boolean {
  if (node.type === 'object') {
    const keys = new Set<string>()
    for (const property of node.children ?? []) {
      const key = property.children?.[0]?.value
      if (typeof key !== 'string' || keys.has(key)) return true
      keys.add(key)
    }
  }
  return (node.children ?? []).some(hasDuplicateKeys)
}

function parseBun(output: string): GlobalInventoryPackage[] | undefined {
  const packages: GlobalInventoryPackage[] = []
  const lines = output.split(/\r?\n/u)
  let sawHeader = false
  let sawEntry = false
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (!(line.startsWith('├──') || line.startsWith('└──'))) {
      if (sawHeader || sawEntry || !validRealm(line)) return undefined
      sawHeader = true
      continue
    }
    sawEntry = true
    const entry = line.slice(3).trim()
    const separator = entry.lastIndexOf('@')
    if (separator < 1) return undefined
    packages.push({ name: entry.slice(0, separator), version: entry.slice(separator + 1) })
  }
  return packages
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
