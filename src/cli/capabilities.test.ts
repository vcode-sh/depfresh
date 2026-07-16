import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'
import { capabilitiesSchema, validateCapabilities } from '../contracts/capabilities-schema'
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

    expect(capabilities.exitCodes['0']).toContain('outdated dependencies may still be reported')
    expect(capabilities.exitCodes['1']).toContain('--fail-on-outdated')
    expect(capabilities.exitCodes['2']).toContain('invalid enum flags')
    expect(capabilities.exitCodes['2']).toContain('incomplete-write')
    expect(capabilities.exitCodes['2']).toContain('--fail-on-resolution-errors')
    expect(capabilities.exitCodes['2']).toContain('--fail-on-no-packages')
  })

  it('includes CLI version from package.json', () => {
    const capabilities = getCliCapabilities()
    expect(capabilities.version).toBeDefined()
    expect(typeof capabilities.version).toBe('string')
    expect(capabilities.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('includes inspect and plan agent workflows', () => {
    const capabilities = getCliCapabilities()

    expect(capabilities.workflows).toBeDefined()
    expect(Object.keys(capabilities.workflows)).toEqual([
      'inspect',
      'plan',
      'apply',
      'syncLockfile',
      'installAndVerifyArtifacts',
      'globalInspect',
      'globalApplyObserved',
      'readOnlyGate',
    ])

    for (const workflow of Object.values(capabilities.workflows)) {
      expect(workflow.description).toBeDefined()
      expect(workflow.command).toContain('depfresh')
      expect(workflow.command).toContain('--output json')
    }
  })

  it('is deterministic, schema-valid, and has no volatile generation fields', () => {
    const first = getCliCapabilities()
    const second = getCliCapabilities()
    const validate = new Ajv({ allErrors: true, strict: true }).compile(capabilitiesSchema)

    expect(first).toEqual(second)
    expect(first).not.toHaveProperty('generatedAt')
    expect(first.contract).toBe('depfresh.capabilities')
    expect(first.schema).toBe('depfresh/schemas/capabilities-v1.json')
    expect(validate(first), JSON.stringify(validate.errors)).toBe(true)
    expect(validateCapabilities(first)).toBe(true)
    expect(validateCapabilities({ ...first, generatedAt: new Date().toISOString() })).toBe(false)
  })

  it('publishes feature registries and pinned runner priority from product registries', () => {
    const capabilities = getCliCapabilities()

    expect(capabilities.registries.policySelectors).toEqual([
      'dependencyName',
      'workspacePath',
      'packageName',
      'catalogName',
      'catalogRole',
      'field',
      'role',
      'manager',
      'protocol',
      'currentChannel',
      'specifierStatus',
    ])
    expect(capabilities.registries.signalSelectors).toEqual([
      'family',
      'state',
      'reason',
      'dependencyName',
      'workspacePath',
      'cohortId',
    ])
    expect(capabilities.registries.applyPhases).toContain('artifact-verify')
    expect(capabilities.registries.managers).toEqual([
      {
        name: 'npm',
        versionRange: '>=10.0.0 <12.0.0',
        lockfiles: ['package-lock.json', 'npm-shrinkwrap.json'],
      },
      {
        name: 'pnpm',
        versionRange: '>=10.0.0 <12.0.0',
        lockfiles: ['pnpm-lock.yaml'],
      },
      { name: 'bun', versionRange: '>=1.2.0 <2.0.0', lockfiles: ['bun.lock'] },
    ])
    expect(capabilities.registries.artifactVerification).toEqual({
      manager: 'npm',
      versionRange: '>=11.12.0 <12.0.0',
      registry: 'https://registry.npmjs.org/',
      integrity: 'sha512',
    })
    expect(capabilities.runners).toEqual([
      {
        priority: 1,
        name: 'repository-local',
        command: 'pnpm exec depfresh',
        requirement: 'The repository lockfile pins depfresh.',
      },
      {
        priority: 2,
        name: 'exact-package',
        command: `npm exec --yes --package=depfresh@${capabilities.version} -- depfresh`,
        requirement: 'The exact package version is approved.',
      },
    ])
    expect(capabilities.assets).toEqual([
      'depfresh/schemas/capabilities-v1.json',
      'depfresh/skills/depfresh/SKILL.md',
      'depfresh/skills/depfresh/recipes/runners.md',
      'depfresh/skills/depfresh/recipes/manager-phases.md',
      'depfresh/skills/depfresh/recipes/ci.md',
      'depfresh/skills/depfresh/examples/README.md',
      'depfresh/skills/depfresh/examples/catalog-policy.json',
      'depfresh/skills/depfresh/examples/read-only-gate.yml',
      'depfresh/skills/depfresh/examples/protected-apply.yml',
    ])
  })

  it('publishes machine commands, schemas, and exit meanings', () => {
    const capabilities = getCliCapabilities()

    expect(capabilities.positional.mode_arg?.values).toEqual(
      expect.arrayContaining(['major', 'inspect', 'plan', 'apply', 'capabilities']),
    )
    expect(capabilities.commands.inspect?.schema).toBe('depfresh/schemas/inspect-v1.json')
    expect(capabilities.commands.plan?.schema).toBe('depfresh/schemas/plan-v1.json')
    expect(capabilities.commands.apply?.schema).toBe('depfresh/schemas/apply-v1.json')
    expect(capabilities.contractSchemas.error).toBe('depfresh/schemas/error-v1.json')
    expect(capabilities.commands.capabilities).toMatchObject({
      schema: 'depfresh/schemas/capabilities-v1.json',
      surface: 'cli',
    })
    expect(capabilities.commands.globalPlan).toMatchObject({
      schema: 'depfresh/schemas/global-plan-v1.json',
      surface: 'library',
    })
    expect(capabilities.contractSchemas.capabilities).toBe('depfresh/schemas/capabilities-v1.json')
    expect(capabilities.contractSchemas.globalPlan).toBe('depfresh/schemas/global-plan-v1.json')
    expect(capabilities.contractSchemas.globalApply).toBe('depfresh/schemas/global-apply-v1.json')
    expect(capabilities.machineExitCodes['0']).toContain('applied')
    expect(capabilities.machineExitCodes['1']).toContain('conflicted')
  })

  it('includes flag relationships with requires and conflicts', () => {
    const capabilities = getCliCapabilities()

    expect(capabilities.flagRelationships).toBeDefined()
    expect(capabilities.flagRelationships.install?.conflicts).toContain('sync-lockfile')
    expect(capabilities.flagRelationships['sync-lockfile']?.conflicts).toContain('install')
    expect(capabilities.flagRelationships['deps-only']?.conflicts).toContain('dev-only')
    expect(capabilities.flagRelationships['dev-only']?.conflicts).toContain('deps-only')
    expect(capabilities.invocationAuthority.write).toEqual({ grants: ['write'] })
    expect(capabilities.invocationAuthority.install).toEqual({
      requires: ['write', 'plan-file'],
      grants: ['processExecute', 'lockfileWrite', 'install'],
    })
    expect(capabilities.invocationAuthority['sync-lockfile']).toEqual({
      requires: ['write', 'plan-file'],
      grants: ['processExecute', 'lockfileWrite'],
    })
    expect(capabilities.invocationAuthority['verify-artifacts']).toEqual({
      requires: ['write', 'plan-file', 'install'],
      grants: ['artifactVerify', 'networkAccess'],
    })
    expect(capabilities.invocationAuthority.global).toEqual({
      requires: ['write'],
      grants: ['globalWrite', 'processExecute'],
    })
    expect(capabilities.configIgnoredOptions).toEqual(
      expect.arrayContaining([
        'write',
        'install',
        'syncLockfile',
        'update',
        'execute',
        'verify',
        'verifyArtifacts',
        'verifyArgv',
        'phaseTimeout',
        'verifyCommand',
      ]),
    )
    expect(capabilities.errorReasons).toContain('AUTHORITY_REQUIRED')
    expect(capabilities.errorReasons).toContain('AUTHORITY_MISMATCH')
    expect(capabilities.errorReasons).toContain('UNKNOWN_OPTION')
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
    expect(capabilities.jsonOutputSchema['summary.failedResolutions']).toBeDefined()
    expect(capabilities.jsonOutputSchema['meta.schemaVersion']).toBeDefined()
    expect(capabilities.jsonOutputSchema['meta.effectiveRoot']).toBeDefined()
    expect(capabilities.jsonOutputSchema['meta.hadResolutionErrors']).toBeDefined()
    expect(capabilities.jsonOutputSchema.discovery).toBeDefined()
    expect(capabilities.jsonOutputSchema['meta.didWrite']).toBeDefined()
  })
})
