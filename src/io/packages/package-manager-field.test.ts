import { describe, expect, it } from 'vitest'
import { parsePackageManagerField } from './package-manager-field'

describe('parsePackageManagerField', () => {
  it('parses pnpm@9.0.0', () => {
    const result = parsePackageManagerField('pnpm@9.0.0')
    expect(result).toEqual({
      name: 'pnpm',
      version: '9.0.0',
      hash: undefined,
      raw: 'pnpm@9.0.0',
    })
  })

  it('parses npm@10.0.0+sha512.abc', () => {
    const result = parsePackageManagerField('npm@10.0.0+sha512.abc')
    expect(result).toEqual({
      name: 'npm',
      version: '10.0.0',
      hash: 'sha512.abc',
      raw: 'npm@10.0.0+sha512.abc',
    })
  })

  it('returns undefined for invalid format', () => {
    const result = parsePackageManagerField('invalid-format')
    expect(result).toBeUndefined()
  })

  it('handles all PM names: npm, pnpm, yarn, bun', () => {
    for (const pm of ['npm', 'pnpm', 'yarn', 'bun']) {
      const result = parsePackageManagerField(`${pm}@1.0.0`)
      expect(result?.name).toBe(pm)
      expect(result?.version).toBe('1.0.0')
    }
  })

  it('returns undefined for unsupported package manager name', () => {
    const result = parsePackageManagerField('deno@1.0.0')
    expect(result).toBeUndefined()
  })

  it('parses version with prerelease suffix', () => {
    const result = parsePackageManagerField('pnpm@9.0.0-beta.1')
    expect(result?.version).toBe('9.0.0-beta.1')
  })
})
