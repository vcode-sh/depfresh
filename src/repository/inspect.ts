import { discoverPackages, type PackageLoadObserver } from '../io/packages/discovery'
import { compilePolicy } from '../policy/compiler'
import { applyPolicyToProjection, evaluateRepositoryPolicy } from '../policy/repository'
import type { depfreshOptions, PackageMeta, PolicyDecision } from '../types'
import { DEFAULT_OPTIONS } from '../types'
import type { InspectRepositoryOptions, RepositoryModel } from '../types/repository'
import { buildRepositoryModel } from './model'

export interface RepositoryInspection {
  model: RepositoryModel
  packages: PackageMeta[]
  decisions: PolicyDecision[]
}

export async function inspectRepository(
  options: InspectRepositoryOptions,
): Promise<RepositoryModel> {
  const runtimeOptions = createInspectOptions(options)
  return (await inspectRepositoryWithProjection(runtimeOptions)).model
}

export async function inspectRepositoryWithProjection(
  options: depfreshOptions,
  observer?: PackageLoadObserver,
): Promise<RepositoryInspection> {
  const discoveryOptions = { ...options, include: undefined, exclude: undefined }
  const packages = await discoverPackages(discoveryOptions, observer)
  options.discoveryReport = discoveryOptions.discoveryReport
  options.effectiveRoot = discoveryOptions.effectiveRoot
  const root = options.effectiveRoot ?? options.cwd
  const report = options.discoveryReport
  if (!report) {
    throw new Error('Repository inspection requires a discovery report')
  }
  const model = buildRepositoryModel(
    root,
    packages,
    report,
    options.ignorePaths,
    options.repositoryVcs ?? 'probe',
  )
  const policy =
    options.compiledPolicy ??
    compilePolicy([
      { source: 'defaults', mode: DEFAULT_OPTIONS.mode ?? 'default' },
      {
        source: 'library',
        mode: options.mode,
        packageMode: options.packageMode,
        include: options.include,
        exclude: options.exclude,
        policyRules: options.policyRules,
      },
    ])
  const decisions = evaluateRepositoryPolicy(model, policy)
  return {
    model,
    packages: applyPolicyToProjection(root, packages, model, decisions),
    decisions,
  }
}

function createInspectOptions(options: InspectRepositoryOptions): depfreshOptions {
  return {
    ...(DEFAULT_OPTIONS as depfreshOptions),
    ...options,
    cwd: options.cwd,
    recursive: options.recursive ?? true,
    peer: true,
    includeLocked: true,
    includeWorkspace: true,
    ignorePaths: options.ignorePaths ?? DEFAULT_OPTIONS.ignorePaths ?? [],
    ignoreOtherWorkspaces: options.ignoreOtherWorkspaces ?? true,
    repositoryVcs: options.vcs ?? 'probe',
    write: false,
    global: false,
    globalAll: false,
    loglevel: 'silent',
  }
}
