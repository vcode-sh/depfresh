import { version } from '../../package.json' with { type: 'json' }
import { getSafeErrorDetails } from '../utils/redact'
import type { MachineCommandError } from './schemas'
import { assertMachineCommandError } from './validate'

const RETRYABLE_CODES = new Set(['ERR_REGISTRY', 'ERR_CACHE'])

export function buildMachineCommandError(
  command: 'inspect' | 'plan',
  error: unknown,
): MachineCommandError {
  const details = getSafeErrorDetails(error)
  const result = {
    contract: 'depfresh.error',
    schemaVersion: 1,
    toolVersion: version,
    command,
    errors: [
      {
        code: details.code,
        reason: details.reason,
        message: `The ${command} command could not produce a trustworthy result.`,
        retryable: RETRYABLE_CODES.has(details.code),
        fatal: true,
      },
    ],
  }
  assertMachineCommandError(result)
  return result
}
