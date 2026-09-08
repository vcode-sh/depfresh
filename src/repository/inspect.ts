import type { InvocationScopeExclusions } from '../cli/scope-exclusions'
import { discoverPackages, type PackageLoadObserver } from '../io/packages/discovery'
import { compilePolicy } from '../policy/compiler'
import { applyPolicyToProjection, evaluateRepositoryPolicy } from '../policy/repository'
import {
  attachInvocationSelectionReceipt,
  bindInvocationSelection,
  createSelectionReceipt,
  type SelectionReceipt,
} from '../selection'
import type { depfreshOptions, PackageMeta, PolicyDecision } from '../types'
import { DEFAULT_OPTIONS } from '../types'
import type { InspectRepositoryOptions, RepositoryModel } from '../types/repository'
import type { Logger } from '../utils/logger'
import { buildDependencyRepositoryModel, buildRepositoryModel } from './model'

export interface RepositoryInspection {
  model: RepositoryModel
  packages: PackageMeta[]
  decisions: PolicyDecision[]
  selection?: SelectionReceipt
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
  invocationSelection?: InvocationScopeExclusions,
  outputLogger?: Logger,
): Promise<RepositoryInspection> {
  return inspectProjection(options, observer, invocationSelection, outputLogger, true)
}

export async function inspectDependenciesWithProjection(
  options: depfreshOptions,
  observer?: PackageLoadObserver,
  invocationSelection?: InvocationScopeExclusions,
  outputLogger?: Logger,
): Promise<RepositoryInspection> {
  return inspectProjection(options, observer, invocationSelection, outputLogger, false)
}

async function inspectProjection(
  options: depfreshOptions,
  observer: PackageLoadObserver | undefined,
  invocationSelection: InvocationScopeExclusions | undefined,
  outputLogger: Logger | undefined,
  fullEvidence: boolean,
): Promise<RepositoryInspection> {
  const discoveryOptions = { ...options, include: undefined, exclude: undefined }
  const packages = await discoverPackages(discoveryOptions, observer, outputLogger)
  options.discoveryReport = discoveryOptions.discoveryReport
  options.effectiveRoot = discoveryOptions.effectiveRoot
  const root = options.effectiveRoot ?? options.cwd
  const report = options.discoveryReport
  if (!report) {
    throw new Error('Repository inspection requires a discovery report')
  }
  const basePolicy =
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
  const requiresEvidence =
    fullEvidence ||
    basePolicy.rules.some((rule) => rule.selectors.manager !== undefined) ||
    Boolean(options.signalRules?.length || options.cohorts?.length)
  const model = requiresEvidence
    ? buildRepositoryModel(
        root,
        packages,
        report,
        options.ignorePaths,
        options.repositoryVcs ?? 'probe',
      )
    : buildDependencyRepositoryModel(root, packages, report)
  const boundSelection = invocationSelection
    ? bindInvocationSelection(root, model, invocationSelection)
    : undefined
  const policy = boundSelection ? boundSelection.appendToPolicy(basePolicy) : basePolicy
  const decisions = evaluateRepositoryPolicy(model, policy)
  const selection = boundSelection
    ? createSelectionReceipt(boundSelection, model, decisions)
    : undefined
  if (selection) attachInvocationSelectionReceipt(options, selection)
  return {
    model,
    packages: applyPolicyToProjection(root, packages, model, decisions),
    decisions,
    ...(selection ? { selection } : {}),
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
    ignorePaths: [
      ...new Set([...(DEFAULT_OPTIONS.ignorePaths ?? []), ...(options.ignorePaths ?? [])]),
    ],
    ignoreOtherWorkspaces: options.ignoreOtherWorkspaces ?? true,
    repositoryVcs: options.vcs ?? 'probe',
    write: false,
    global: false,
    globalAll: false,
    loglevel: 'silent',
  }
}
