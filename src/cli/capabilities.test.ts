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

  it('includes CLI version from package.json', () => {
    const capabilities = getCliCapabilities()
    expect(capabilities.version).toBeDefined()
    expect(typeof capabilities.version).toBe('string')
    expect(capabilities.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('includes 4 agent workflows', () => {
    const capabilities = getCliCapabilities()

    expect(capabilities.workflows).toBeDefined()
    expect(Object.keys(capabilities.workflows)).toEqual([
      'checkOnly',
      'safeUpdate',
      'fullUpdate',
      'selective',
    ])

    for (const workflow of Object.values(capabilities.workflows)) {
      expect(workflow.description).toBeDefined()
      expect(workflow.command).toContain('depfresh')
      expect(workflow.command).toContain('--output json')
    }
  })

  it('includes flag relationships with requires and conflicts', () => {
    const capabilities = getCliCapabilities()

    expect(capabilities.flagRelationships).toBeDefined()
    expect(capabilities.flagRelationships.install?.requires).toContain('write')
    expect(capabilities.flagRelationships.update?.requires).toContain('write')
    expect(capabilities.flagRelationships['deps-only']?.conflicts).toContain('dev-only')
    expect(capabilities.flagRelationships['dev-only']?.conflicts).toContain('deps-only')
  })

  it('includes supported config file patterns', () => {
    const capabilities = getCliCapabilities()

    expect(capabilities.configFiles).toBeDefined()
    expect(Array.isArray(capabilities.configFiles)).toBe(true)
    expect(capabilities.configFiles.length).toBeGreaterThan(0)
    expect(capabilities.configFiles).toContain('depfresh.config.ts')
    expect(capabilities.configFiles).toContain('.depfreshrc.json')
    expect(capabilities.configFiles).toContain('.depfreshrc')
  })

  it('includes JSON output schema descriptions', () => {
    const capabilities = getCliCapabilities()

    expect(capabilities.jsonOutputSchema).toBeDefined()
    expect(capabilities.jsonOutputSchema['packages[]']).toBeDefined()
    expect(capabilities.jsonOutputSchema['errors[]']).toBeDefined()
    expect(capabilities.jsonOutputSchema['summary.total']).toBeDefined()
    expect(capabilities.jsonOutputSchema['meta.schemaVersion']).toBeDefined()
    expect(capabilities.jsonOutputSchema['meta.didWrite']).toBeDefined()
  })
})
