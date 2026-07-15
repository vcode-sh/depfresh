import { describe, expect, it } from 'vitest'
import { normalizeCliRawArgs } from './raw-args'

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
