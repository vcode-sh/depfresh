import { describe, expect, it } from 'vitest'
import { ConfigError } from '../../errors'
import type { depfreshOptions } from '../../types'
import {
  buildLegacyCheckJsonError,
  buildLegacyCheckJsonResult,
  type JsonExecutionState,
} from './json-output'

const timestamp = '2026-07-16T00:00:00.000Z'
const executionState: JsonExecutionState = {
  scannedPackages: 0,
  packagesWithUpdates: 0,
  plannedUpdates: 0,
  appliedUpdates: 0,
  revertedUpdates: 0,
  skippedUpdates: 0,
  conflictedUpdates: 0,
  failedWrites: 0,
  unknownWrites: 0,
  writeOutcomes: [],
  globalResults: [],
  failedResolutions: 0,
  noPackagesFound: true,
  didWrite: false,
}

describe('legacy check JSON compatibility builders', () => {
  it('retains the v1 absolute-path and timestamp compatibility fields', () => {
    const result = buildLegacyCheckJsonResult(
      [],
      {
        cwd: '/absolute/requested',
        effectiveRoot: '/absolute/root',
        mode: 'default',
      } as depfreshOptions,
      executionState,
      [],
      timestamp,
    )

    expect(result).toMatchObject({
      packages: [],
      errors: [],
      summary: { total: 0, failedResolutions: 0 },
      meta: {
        schemaVersion: 1,
        cwd: '/absolute/requested',
        effectiveRoot: '/absolute/root',
        timestamp,
        noPackagesFound: true,
      },
    })
    expect(JSON.stringify(result)).toBe(
      '{"packages":[],"errors":[],"writeOutcomes":[],"summary":{"total":0,"major":0,"minor":0,"patch":0,"packages":0,"scannedPackages":0,"packagesWithUpdates":0,"plannedUpdates":0,"appliedUpdates":0,"revertedUpdates":0,"skippedUpdates":0,"conflictedUpdates":0,"failedWrites":0,"unknownWrites":0,"failedResolutions":0},"meta":{"schemaVersion":1,"cwd":"/absolute/requested","effectiveRoot":"/absolute/root","mode":"default","timestamp":"2026-07-16T00:00:00.000Z","noPackagesFound":true,"hadResolutionErrors":false,"didWrite":false}}',
    )
  })

  it('retains the stable legacy fatal error shape and redaction', () => {
    const result = buildLegacyCheckJsonError(
      new ConfigError('token=must-not-leak', { reason: 'INVALID_CONFIG' }),
      { cwd: '/tmp/project', mode: 'default' },
      timestamp,
    )

    expect(result).toEqual({
      error: {
        code: 'ERR_CONFIG',
        reason: 'INVALID_CONFIG',
        message: 'token=[REDACTED]',
        retryable: false,
      },
      meta: { schemaVersion: 1, cwd: '/tmp/project', mode: 'default', timestamp },
    })
    expect(JSON.stringify(result)).toBe(
      '{"error":{"code":"ERR_CONFIG","reason":"INVALID_CONFIG","message":"token=[REDACTED]","retryable":false},"meta":{"schemaVersion":1,"cwd":"/tmp/project","mode":"default","timestamp":"2026-07-16T00:00:00.000Z"}}',
    )
  })
})
