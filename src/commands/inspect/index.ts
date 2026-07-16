import { version } from '../../../package.json' with { type: 'json' }
import { assertPlainDataInput } from '../../contracts/input'
import {
  compareDiagnostics,
  projectDiagnostic,
  projectEvidence,
  projectLockfiles,
  projectOccurrences,
  projectRepository,
  projectRepositoryRisks,
  projectVcs,
} from '../../contracts/repository-projection'
import type { InspectResult } from '../../contracts/schemas'
import { assertInspectResult } from '../../contracts/validate'
import { ConfigError } from '../../errors'
import { inspectRepository } from '../../repository/inspect'
import type { InspectRepositoryOptions } from '../../types'

export type InspectOptions = Omit<InspectRepositoryOptions, 'vcs'>

export async function inspect(options: InspectOptions): Promise<InspectResult> {
  try {
    assertPlainDataInput(options)
  } catch {
    throw new ConfigError('Inspect options must be plain JSON data.', {
      reason: 'INVALID_CONFIG',
    })
  }
  const model = await inspectRepository({ ...options, vcs: 'disabled' })
  const result = {
    contract: 'depfresh.inspect',
    schemaVersion: 1,
    toolVersion: version,
    repository: projectRepository(model),
    occurrences: projectOccurrences(model),
    evidence: projectEvidence(model),
    lockfiles: projectLockfiles(model),
    vcs: projectVcs(model),
    diagnostics: model.diagnostics.map(projectDiagnostic).sort(compareDiagnostics),
    risks: projectRepositoryRisks(model),
    errors: [],
    requiredCapabilities: ['filesystem-read'],
  }
  assertInspectResult(result)
  return result
}
