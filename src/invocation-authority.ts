import { ConfigError } from './errors'
import type { depfreshOptions, InvocationAuthority } from './types'

export function createInvocationAuthority(options: Partial<depfreshOptions>): InvocationAuthority {
  const write = options.write === true
  return Object.freeze({
    write,
    install: options.install === true,
    update: options.update === true,
    execute: typeof options.execute === 'string' && options.execute.length > 0,
    verifyCommand: typeof options.verifyCommand === 'string' && options.verifyCommand.length > 0,
    globalWrite: write && (options.global === true || options.globalAll === true),
  })
}

export function snapshotInvocationAuthority(authority: InvocationAuthority): InvocationAuthority {
  return Object.freeze({
    write: authority.write === true,
    install: authority.install === true,
    update: authority.update === true,
    execute: authority.execute === true,
    verifyCommand: authority.verifyCommand === true,
    globalWrite: authority.globalWrite === true,
  })
}

export function validateInvocationAuthority(
  options: depfreshOptions,
  authority: InvocationAuthority,
): void {
  const required: Array<[boolean, boolean, string]> = [
    [options.write, authority.write, 'write'],
    [options.install, authority.install, 'install'],
    [options.update, authority.update, 'update'],
    [Boolean(options.execute), authority.execute, 'execute'],
    [Boolean(options.verifyCommand), authority.verifyCommand, 'verify-command'],
    [
      options.write && (options.global || options.globalAll === true),
      authority.globalWrite,
      'global-write',
    ],
  ]

  for (const [requested, granted, capability] of required) {
    if (requested && !granted) {
      throw new ConfigError(
        `The ${capability} capability requires explicit invocation authority.`,
        { reason: 'AUTHORITY_REQUIRED' },
      )
    }
  }
}
