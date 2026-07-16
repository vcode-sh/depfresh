import { describe, expect, it } from 'vitest'
import { createInvocationAuthority } from './invocation-authority'

describe('createInvocationAuthority', () => {
  it('returns an immutable snapshot that cannot widen after option mutation', () => {
    const options = {
      write: true,
      install: true,
      execute: 'pnpm test',
      global: true,
    }
    const authority = createInvocationAuthority(options)

    options.write = false
    options.install = false
    options.execute = ''
    options.global = false

    expect(Object.isFrozen(authority)).toBe(true)
    expect(authority).toEqual({
      write: true,
      install: true,
      update: false,
      execute: true,
      processExecute: true,
      lockfileWrite: true,
      verifyCommand: false,
      globalWrite: true,
      artifactVerify: false,
      networkAccess: false,
    })
    expect(() => Object.assign(authority, { write: false })).toThrow(TypeError)
  })

  it('keeps manager execution, lockfile mutation, install, and verification as separate grants', () => {
    expect(
      createInvocationAuthority({
        write: true,
        syncLockfile: true,
        verify: true,
      }),
    ).toMatchObject({
      write: true,
      processExecute: true,
      lockfileWrite: true,
      install: false,
      verifyCommand: true,
      artifactVerify: false,
      networkAccess: false,
    })
  })

  it('grants artifact verification and network separately from install configuration', () => {
    expect(createInvocationAuthority({ install: true, verifyArtifacts: true })).toMatchObject({
      install: true,
      processExecute: true,
      artifactVerify: true,
      networkAccess: true,
    })
    expect(createInvocationAuthority({ install: true })).toMatchObject({
      artifactVerify: false,
      networkAccess: false,
    })
  })

  it('does not grant global write without explicit write authority', () => {
    expect(createInvocationAuthority({ global: true })).toMatchObject({
      write: false,
      globalWrite: false,
    })
  })

  it('grants process execution only for an explicitly requested global write', () => {
    expect(createInvocationAuthority({ write: true, globalAll: true })).toMatchObject({
      globalWrite: true,
      processExecute: true,
      lockfileWrite: false,
    })
    expect(createInvocationAuthority({ globalAll: true })).toMatchObject({
      globalWrite: false,
      processExecute: false,
    })
  })
})
