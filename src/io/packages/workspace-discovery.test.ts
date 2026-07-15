import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getWorkspaceManifestPatterns } from './workspace-discovery'

describe('getWorkspaceManifestPatterns containment', () => {
  let rootDir: string

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'depfresh-workspace-patterns-'))
  })

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true })
  })

  it('keeps safe patterns and blocks traversal and absolute patterns', () => {
    const absolutePattern = join(rootDir, '..', 'external', '*')
    writeFileSync(
      join(rootDir, 'package.json'),
      JSON.stringify({
        name: 'root',
        workspaces: [
          'packages/*',
          '../external/*',
          'packages/../private/*',
          absolutePattern,
          'C:\\external\\*',
          '!../excluded/*',
        ],
      }),
    )

    const result = getWorkspaceManifestPatterns(rootDir)

    expect(result.patterns).toEqual([
      'package.json',
      'package.yaml',
      'packages/*/package.json',
      'packages/*/package.yaml',
    ])
    expect(result.blockedPatterns).toEqual([
      { pattern: '../external/*', reason: 'PARENT_TRAVERSAL' },
      { pattern: 'packages/../private/*', reason: 'PARENT_TRAVERSAL' },
      { pattern: absolutePattern, reason: 'ABSOLUTE_PATTERN' },
      { pattern: 'C:\\external\\*', reason: 'ABSOLUTE_PATTERN' },
      { pattern: '!../excluded/*', reason: 'PARENT_TRAVERSAL' },
    ])
  })
})
