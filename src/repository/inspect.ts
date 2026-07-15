import { discoverPackages } from '../io/packages/discovery'
import type { depfreshOptions, PackageMeta } from '../types'
import { DEFAULT_OPTIONS } from '../types'
import type { InspectRepositoryOptions, RepositoryModel } from '../types/repository'
import { buildRepositoryModel } from './model'

interface RepositoryInspection {
  model: RepositoryModel
  packages: PackageMeta[]
}

export async function inspectRepository(
  options: InspectRepositoryOptions,
): Promise<RepositoryModel> {
  const runtimeOptions = createInspectOptions(options)
  return (await inspectRepositoryWithProjection(runtimeOptions)).model
}

export async function inspectRepositoryWithProjection(
  options: depfreshOptions,
): Promise<RepositoryInspection> {
  const packages = await discoverPackages(options)
  const root = options.effectiveRoot ?? options.cwd
  const report = options.discoveryReport
  if (!report) {
    throw new Error('Repository inspection requires a discovery report')
  }
  return { model: buildRepositoryModel(root, packages, report), packages }
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
    write: false,
    global: false,
    globalAll: false,
    loglevel: 'silent',
  }
}
