import { describe, expect, it } from 'vitest'
import { findRawMachineCommand, normalizeCliRawArgs } from './raw-args'

describe('findRawMachineCommand', () => {
  it.each([
    [['plan', '--json'], 'plan'],
    [['--exclude-workspace=', 'plan', '--json'], 'plan'],
    [['-ojson', 'inspect'], 'inspect'],
    [['-o', 'json', 'apply'], 'apply'],
    [['--cwd', 'plan', 'inspect'], 'inspect'],
    [['--exclude-catalog', 'plan', '--json'], undefined],
    [['--no-exclude-workspace', 'plan', '--json'], 'plan'],
    [['--unknown', 'plan'], undefined],
  ])('finds only an actual positional machine command in %j', (rawArgs, expected) => {
    expect(findRawMachineCommand(rawArgs)).toBe(expected)
  })
})

describe('normalizeCliRawArgs', () => {
  it('keeps non-help args unchanged', () => {
    expect(normalizeCliRawArgs(['major', '-w'])).toEqual(['major', '-w'])
  })

  it('maps `help` to `--help`', () => {
    expect(normalizeCliRawArgs(['help'])).toEqual(['--help'])
  })

  it('maps `help` to `--help` and preserves trailing args', () => {
    expect(normalizeCliRawArgs(['help', '--help-json'])).toEqual(['--help', '--help-json'])
  })

  it.each([
    [['--unknown'], 'Unknown option: --unknown'],
    [['--mode'], 'Missing value for --mode'],
    [['--include', '--write'], 'Missing value for --include'],
    [['major', 'minor'], 'Unexpected positional argument: minor'],
    [['--write=maybe'], 'Invalid boolean value for --write'],
    [['--no-mode'], 'Option --mode is not boolean'],
    [['--no-r'], 'Unknown option: --no-r'],
  ])('rejects malformed argv %j', (rawArgs, message) => {
    expect(() => normalizeCliRawArgs(rawArgs)).toThrow(message)
  })

  it.each([
    ['--mode', 'major', '--mode', 'minor'],
    ['--write', '--no-write'],
    ['major', '--mode', 'minor'],
  ])('rejects conflicting singleton occurrences in %j', (...rawArgs) => {
    expect(() => normalizeCliRawArgs(rawArgs)).toThrow('Conflicting values for')
  })

  it('normalizes exact boolean assignments before citty parses them', () => {
    expect(normalizeCliRawArgs(['--write=false', '--recursive=true'])).toEqual([
      '--no-write',
      '--recursive',
    ])
  })

  it('allows repeated singleton values when they agree', () => {
    expect(normalizeCliRawArgs(['--mode', 'minor', '-mminor', '--write', '-w'])).toEqual([
      '--mode',
      'minor',
      '-mminor',
      '--write',
      '-w',
    ])
  })

  it('allows different repeated workspace and catalog exclusion values', () => {
    const rawArgs = [
      '--exclude-workspace',
      'apps/admin',
      '--exclude-workspace=packages/legacy',
      '--exclude-catalog',
      'mobile,v2',
      '--exclude-catalog=-preview',
    ]

    expect(normalizeCliRawArgs(rawArgs)).toEqual(rawArgs)
  })

  it('keeps a machine command distinct from its range mode', () => {
    expect(normalizeCliRawArgs(['plan', '--mode', 'minor', '--json'])).toEqual([
      'plan',
      '--mode',
      'minor',
      '--json',
    ])
  })

  it('passes negative numeric values to numeric validation', () => {
    expect(normalizeCliRawArgs(['--cooldown', '-1'])).toEqual(['--cooldown', '-1'])
  })

  it('does not echo an unknown option inline value', () => {
    expect(() => normalizeCliRawArgs(['--api-key=top-secret'])).toThrow('Unknown option: --api-key')
    try {
      normalizeCliRawArgs(['--api-key=top-secret'])
    } catch (error) {
      expect(String(error)).not.toContain('top-secret')
    }
  })

  it.each([
    ['-wI', '--mode', 'minor'],
    ['-mminor', '--output=json'],
    ['-C/tmp/project', '--include=--write'],
    ['--no-group', '--no-timediff'],
    ['capabilities', '--json'],
  ])('preserves supported valid argv shape %j', (...rawArgs) => {
    expect(normalizeCliRawArgs(rawArgs)).toEqual(rawArgs)
  })
})
