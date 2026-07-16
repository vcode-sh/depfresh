import { describe, expect, it } from 'vitest'
import { assertMachineCommandSafety, normalizePlanCommandArgs } from './machine-commands'

const planArgs = {
  cwd: '.',
  recursive: true,
  mode: 'default',
  force: false,
  peer: false,
  'include-locked': false,
  concurrency: '16',
  cooldown: '0',
  'ignore-other-workspaces': true,
  'phase-timeout': '4321',
}

describe('machine phase options', () => {
  it('normalizes exact plan intent without granting apply authority', () => {
    expect(
      normalizePlanCommandArgs({
        ...planArgs,
        'sync-lockfile': true,
        'verify-argv': '["node","--test","literal;not-a-shell"]',
      }),
    ).toMatchObject({
      syncLockfile: true,
      install: false,
      verifyArgv: ['node', '--test', 'literal;not-a-shell'],
      phaseTimeout: 4321,
    })
  })

  it('rejects malformed verification argv before discovery', () => {
    expect(() => normalizePlanCommandArgs({ ...planArgs, 'verify-argv': 'node --test' })).toThrow(
      /JSON string array/u,
    )
    expect(() => normalizePlanCommandArgs({ ...planArgs, 'verify-argv': '[]' })).toThrow(
      /non-empty/u,
    )
  })

  it('allows phase intent only on plan and matching grants only on apply', () => {
    expect(() =>
      assertMachineCommandSafety(
        { ...planArgs, json: true, 'sync-lockfile': true },
        ['plan', '--json', '--sync-lockfile'],
        'plan',
      ),
    ).not.toThrow()
    expect(() =>
      assertMachineCommandSafety(
        { json: true, write: true, install: true, 'plan-file': 'plan.json' },
        ['apply', '--json', '--write', '--install', '--plan-file', 'plan.json'],
        'apply',
      ),
    ).not.toThrow()
    expect(() =>
      assertMachineCommandSafety(
        { json: true, verify: true },
        ['plan', '--json', '--verify'],
        'plan',
      ),
    ).toThrow(/not valid for the plan/u)
  })
})
