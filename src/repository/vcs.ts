import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  RepositoryEvidenceDiagnostic,
  RepositoryVcsEvidence,
  RepositoryVcsTargetState,
  RepositoryVcsTargetStateName,
} from '../types/repository'
import { createRepositoryId, toRepositoryRelativePath } from './identity'

interface VcsAdapterOptions {
  gitBinary?: string
  cleanTargetPaths?: readonly string[]
  worktreePath?: string
  diagnosticPath?: string
  environment?: NodeJS.ProcessEnv
}

interface PorcelainEntry {
  code: string
  path: string
  originalPath?: string
}

export function collectVcsEvidence(
  root: string,
  targetPaths: readonly string[],
  options: VcsAdapterOptions = {},
): RepositoryVcsEvidence {
  const worktreePath = options.worktreePath ?? root
  const diagnosticPath = options.diagnosticPath ?? '.'
  if (!(existsSync(root) && existsSync(worktreePath))) {
    return unavailableVcs('VCS_PROBE_FAILED', diagnosticPath)
  }
  let canonicalRoot: string
  let canonicalWorktree: string
  try {
    canonicalRoot = realpathSync.native(root)
    canonicalWorktree = realpathSync.native(worktreePath)
  } catch {
    return unavailableVcs('VCS_PROBE_FAILED', diagnosticPath)
  }
  const binary = options.gitBinary ?? 'git'
  const common = [
    '--no-optional-locks',
    '-C',
    canonicalWorktree,
    '-c',
    'core.preloadindex=false',
    '-c',
    'core.fscache=false',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.untrackedCache=false',
    '-c',
    'gc.auto=0',
    '-c',
    'maintenance.auto=false',
    '-c',
    'status.relativePaths=false',
    '-c',
    'status.submoduleSummary=false',
    '-c',
    'status.renames=true',
  ]
  const env = createGitEnvironment(options.environment ?? process.env)
  const repository = spawnSync(binary, [...common, 'rev-parse', '--show-toplevel'], {
    cwd: canonicalRoot,
    env,
    encoding: 'utf-8',
  })

  if (repository.error) {
    const code = isMissingExecutable(repository.error)
      ? 'VCS_EXECUTABLE_MISSING'
      : 'VCS_PROBE_FAILED'
    return unavailableVcs(code, diagnosticPath)
  }
  if (repository.status !== 0) {
    return unavailableVcs(
      repository.status === 128 && !hasGitMarker(canonicalWorktree)
        ? 'VCS_NOT_REPOSITORY'
        : 'VCS_PROBE_FAILED',
      diagnosticPath,
    )
  }

  const gitRoot = stripFinalLineEnding(repository.stdout)
  if (!gitRoot) return unavailableVcs('VCS_PROBE_FAILED', diagnosticPath)
  const shallowProbe = spawnSync(binary, [...common, 'rev-parse', '--is-shallow-repository'], {
    cwd: canonicalRoot,
    env,
    encoding: 'utf-8',
  })
  if (shallowProbe.error || shallowProbe.status !== 0) {
    return unavailableVcs(
      shallowProbe.error && isMissingExecutable(shallowProbe.error)
        ? 'VCS_EXECUTABLE_MISSING'
        : 'VCS_PROBE_FAILED',
      diagnosticPath,
    )
  }
  const shallow = stripFinalLineEnding(shallowProbe.stdout) === 'true'
  const status = spawnSync(
    binary,
    [
      ...common,
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--ignored=no',
      '--ignore-submodules=dirty',
      '--find-renames=50%',
    ],
    { cwd: canonicalRoot, env, encoding: 'buffer' },
  )
  if (status.error || status.status !== 0 || !Buffer.isBuffer(status.stdout)) {
    return unavailableVcs(
      status.error && isMissingExecutable(status.error)
        ? 'VCS_EXECUTABLE_MISSING'
        : 'VCS_PROBE_FAILED',
      diagnosticPath,
    )
  }

  const entries = parsePorcelain(status.stdout).flatMap((entry) => {
    const path = gitPathToRepositoryPath(canonicalRoot, gitRoot, entry.path)
    const originalPath = entry.originalPath
      ? gitPathToRepositoryPath(canonicalRoot, gitRoot, entry.originalPath)
      : undefined
    if (!(path || originalPath)) return []
    return [{ ...entry, ...(path ? { path } : {}), ...(originalPath ? { originalPath } : {}) }]
  })
  const explicitTargets = new Set(targetPaths)
  const cleanTargets = new Set(options.cleanTargetPaths ?? targetPaths)
  const trackedTargets = collectTrackedTargets(binary, common, env, canonicalRoot, gitRoot)
  if (!trackedTargets) return unavailableVcs('VCS_PROBE_FAILED', diagnosticPath)
  const ignoredTargets = collectIgnoredTargets(binary, common, env, canonicalRoot, gitRoot, [
    ...cleanTargets,
  ])
  if (!ignoredTargets) return unavailableVcs('VCS_PROBE_FAILED', diagnosticPath)
  const targetFiles: RepositoryVcsTargetState[] = []
  const dirtyTargets = new Set<string>()
  const unrelatedDirtyPaths = new Set<string>()

  for (const entry of entries) {
    const target = explicitTargets.has(entry.path)
    const originalTarget =
      entry.originalPath !== undefined && explicitTargets.has(entry.originalPath)
    if (!(target || originalTarget)) {
      unrelatedDirtyPaths.add(entry.path)
      if (entry.originalPath) unrelatedDirtyPaths.add(entry.originalPath)
      continue
    }
    if (target) dirtyTargets.add(entry.path)
    if (originalTarget) dirtyTargets.add(entry.originalPath!)
    targetFiles.push({
      path: entry.path,
      state: classifyStatus(entry.code),
      ...(entry.originalPath ? { originalPath: entry.originalPath } : {}),
    })
  }

  for (const path of cleanTargets) {
    if (dirtyTargets.has(path)) continue
    if (ignoredTargets.has(path)) targetFiles.push({ path, state: 'ignored' })
    else if (trackedTargets.has(path)) targetFiles.push({ path, state: 'clean' })
  }

  targetFiles.sort(compareTargetStates)
  return {
    status: 'confirmed',
    shallow,
    targetFiles: deduplicateTargetStates(targetFiles),
    unrelatedDirtyPaths: [...unrelatedDirtyPaths].sort((a, b) => a.localeCompare(b)),
    diagnostics: [],
  }
}

function unavailableVcs(
  code: RepositoryEvidenceDiagnostic['code'],
  path: string,
): RepositoryVcsEvidence {
  return {
    status: 'unavailable',
    targetFiles: [],
    unrelatedDirtyPaths: [],
    diagnostics: [createDiagnostic(code, path)],
  }
}

function createDiagnostic(
  code: RepositoryEvidenceDiagnostic['code'],
  path: string,
): RepositoryEvidenceDiagnostic {
  return {
    id: createRepositoryId('evidence-diagnostic', `${code}\0${path}`),
    code,
    path,
  }
}

function isMissingExecutable(error: Error): boolean {
  return 'code' in error && error.code === 'ENOENT'
}

function createGitEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(source)) {
    if (!key.toUpperCase().startsWith('GIT_')) env[key] = value
  }
  env.GIT_OPTIONAL_LOCKS = '0'
  env.GIT_TERMINAL_PROMPT = '0'
  env.LC_ALL = 'C'
  env.LANG = 'C'
  return env
}

function stripFinalLineEnding(value: string): string {
  if (value.endsWith('\r\n')) return value.slice(0, -2)
  if (value.endsWith('\n')) return value.slice(0, -1)
  return value
}

function hasGitMarker(start: string): boolean {
  let current = start
  while (true) {
    if (existsSync(join(current, '.git'))) return true
    const parent = dirname(current)
    if (parent === current) return false
    current = parent
  }
}

function collectIgnoredTargets(
  binary: string,
  common: string[],
  env: NodeJS.ProcessEnv,
  root: string,
  gitRoot: string,
  targetPaths: string[],
): Set<string> | undefined {
  const gitPaths = targetPaths.flatMap((path) => {
    const gitPath = relative(gitRoot, resolve(root, path))
    if (gitPath === '..' || gitPath.startsWith(`..${sep}`) || isAbsolute(gitPath)) return []
    return [gitPath.split(sep).join('/')]
  })
  if (gitPaths.length === 0) return new Set()
  const result = spawnSync(binary, [...common, 'check-ignore', '-z', '--stdin'], {
    cwd: root,
    env,
    input: Buffer.from(`${gitPaths.join('\0')}\0`),
    encoding: 'buffer',
  })
  if (
    result.error ||
    (result.status !== 0 && result.status !== 1) ||
    !Buffer.isBuffer(result.stdout)
  ) {
    return undefined
  }
  return new Set(
    result.stdout
      .toString('utf-8')
      .split('\0')
      .flatMap((path) => {
        if (!path) return []
        const repositoryPath = gitPathToRepositoryPath(root, gitRoot, path)
        return repositoryPath ? [repositoryPath] : []
      }),
  )
}

function collectTrackedTargets(
  binary: string,
  common: string[],
  env: NodeJS.ProcessEnv,
  root: string,
  gitRoot: string,
): Set<string> | undefined {
  const result = spawnSync(binary, [...common, 'ls-files', '-z', '--cached', '--full-name'], {
    cwd: root,
    env,
    encoding: 'buffer',
  })
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) return undefined
  return new Set(
    result.stdout
      .toString('utf-8')
      .split('\0')
      .flatMap((path) => {
        if (!path) return []
        const repositoryPath = gitPathToRepositoryPath(root, gitRoot, path)
        return repositoryPath ? [repositoryPath] : []
      }),
  )
}

function parsePorcelain(output: Buffer): PorcelainEntry[] {
  const fields = output.toString('utf-8').split('\0')
  const entries: PorcelainEntry[] = []
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]
    if (!field || field.length < 4) continue
    const code = field.slice(0, 2)
    const path = field.slice(3)
    if (code.includes('R') || code.includes('C')) {
      const originalPath = fields[index + 1]
      index += 1
      entries.push({ code, path, ...(originalPath ? { originalPath } : {}) })
    } else {
      entries.push({ code, path })
    }
  }
  return entries
}

function gitPathToRepositoryPath(
  root: string,
  gitRoot: string,
  gitPath: string,
): string | undefined {
  return toRepositoryRelativePath(root, resolve(gitRoot, gitPath))
}

function classifyStatus(code: string): RepositoryVcsTargetStateName {
  if (code === '??') return 'untracked'
  if (/^(?:DD|AU|UD|UA|DU|AA|UU)$/u.test(code)) return 'conflicted'
  const index = code[0] ?? ' '
  const worktree = code[1] ?? ' '
  if (index === 'R' || worktree === 'R') return 'renamed'
  if (index === 'A') return 'added'
  if (index === 'D' || worktree === 'D') return 'deleted'
  if (index !== ' ' && worktree !== ' ') return 'staged-plus-unstaged'
  if (index !== ' ') return 'staged'
  return 'unstaged'
}

function compareTargetStates(
  left: RepositoryVcsTargetState,
  right: RepositoryVcsTargetState,
): number {
  return (
    left.path.localeCompare(right.path) ||
    left.state.localeCompare(right.state) ||
    (left.originalPath ?? '').localeCompare(right.originalPath ?? '')
  )
}

function deduplicateTargetStates(states: RepositoryVcsTargetState[]): RepositoryVcsTargetState[] {
  const seen = new Set<string>()
  return states.filter((state) => {
    const key = `${state.path}\0${state.state}\0${state.originalPath ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
