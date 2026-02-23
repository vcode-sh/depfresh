import { describe, expect, it } from 'vitest'
import { getCliCapabilities } from './capabilities'

describe('getCliCapabilities', () => {
  it('returns machine-discoverable schema with enums, defaults, and exit codes', () => {
    const capabilities = getCliCapabilities()

    expect(capabilities.schemaVersion).toBe(1)
    expect(capabilities.command).toBe('depfresh')
    expect(capabilities.enums.mode).toContain('major')
    expect(capabilities.enums.output).toEqual(['table', 'json'])
    expect(capabilities.enums.loglevel).toEqual(['silent', 'info', 'debug'])

    expect(capabilities.flags.mode?.values).toEqual(capabilities.enums.mode)
    expect(capabilities.flags.output?.values).toEqual(capabilities.enums.output)
    expect(capabilities.flags.sort?.values).toEqual(capabilities.enums.sort)
    expect(capabilities.flags.loglevel?.values).toEqual(capabilities.enums.loglevel)

    expect(capabilities.flags['help-json']?.type).toBe('boolean')
    expect(capabilities.discoverability.helpJsonFlag).toBe('depfresh --help-json')
    expect(capabilities.discoverability.capabilitiesCommand).toBe('depfresh capabilities --json')

    expect(capabilities.exitCodes['0']).toContain('Success')
    expect(capabilities.exitCodes['1']).toContain('--fail-on-outdated')
    expect(capabilities.exitCodes['2']).toContain('invalid enum flag values')
  })
})
