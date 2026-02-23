import { describe, expect, it } from 'vitest'
import { parseGithubSpec, parseProtocol } from './protocols'

describe('parseProtocol', () => {
  it('parses npm aliases and sets aliasName', () => {
    const result = parseProtocol('npm:lodash@^4.17.0')
    expect(result).toEqual({
      protocol: 'npm',
      aliasName: 'lodash',
      currentVersion: '^4.17.0',
    })
  })

  it('parses jsr aliases and sets aliasName', () => {
    const result = parseProtocol('jsr:@scope/pkg@^1.2.3')
    expect(result).toEqual({
      protocol: 'jsr',
      aliasName: 'jsr:@scope/pkg',
      currentVersion: '^1.2.3',
    })
  })

  it('parses github tags and normalizes currentVersion', () => {
    const result = parseProtocol('github:uNetworking/uWebSockets.js#v20.51.0')
    expect(result).toEqual({
      protocol: 'github',
      aliasName: 'github:uNetworking/uWebSockets.js',
      currentVersion: '20.51.0',
    })
  })

  it('keeps unknown formats as plain versions', () => {
    const result = parseProtocol('^1.0.0')
    expect(result).toEqual({
      currentVersion: '^1.0.0',
    })
  })
})

describe('parseGithubSpec', () => {
  it('supports refs/tags/ prefix', () => {
    const result = parseGithubSpec('github:owner/repo#refs/tags/v1.2.3')
    expect(result).toEqual({
      aliasName: 'github:owner/repo',
      currentVersion: '1.2.3',
    })
  })

  it('returns null for non-semver refs', () => {
    expect(parseGithubSpec('github:owner/repo#main')).toBeNull()
    expect(parseGithubSpec('github:owner/repo#a1b2c3d')).toBeNull()
  })
})
