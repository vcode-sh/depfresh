import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { extractSinglePackEntry } from '../scripts/pack-manifest.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  exports: Record<string, string | Record<string, string>>
  files: string[]
  version: string
}

const publicAssets = [
  'schemas/capabilities-v2.json',
  'schemas/capabilities-v1.json',
  'schemas/plan-v2.json',
  'skills/depfresh/SKILL.md',
  'skills/depfresh/recipes/runners.md',
  'skills/depfresh/recipes/manager-phases.md',
  'skills/depfresh/recipes/ci.md',
  'skills/depfresh/examples/README.md',
  'skills/depfresh/examples/catalog-policy.json',
  'skills/depfresh/examples/read-only-gate.yml',
  'skills/depfresh/examples/protected-apply.yml',
]

describe('published workflow assets', () => {
  it('pins the publishable package manifest to the 2.0.2 release candidate', () => {
    expect(packageJson.version).toBe('2.0.2')
  })

  it('allowlists dist and skills without publishing plans or scratch state', () => {
    expect(packageJson.files).toEqual(['dist', 'skills'])
    expect(packageJson.files).not.toEqual(expect.arrayContaining(['plans', '.superpowers', 'src']))
    expect(packageJson.exports['./schemas/capabilities-v1.json']).toBe(
      './dist/schemas/capabilities-v1.json',
    )
    expect(packageJson.exports['./schemas/capabilities-v2.json']).toBe(
      './dist/schemas/capabilities-v2.json',
    )
    expect(packageJson.exports['./schemas/plan-v2.json']).toBe('./dist/schemas/plan-v2.json')
    for (const asset of publicAssets.filter((entry) => entry.startsWith('skills/'))) {
      expect(packageJson.exports[`./${asset}`]).toBe(`./${asset}`)
    }
  })

  it('keeps every documented public asset present and sanitized', () => {
    for (const asset of publicAssets) expect(existsSync(join(root, asset)), asset).toBe(true)

    const skill = readFileSync(join(root, 'skills/depfresh/SKILL.md'), 'utf8')
    expect(skill).not.toContain('src/')
    expect(skill).not.toMatch(/\b(?:git add|git commit|git push|npm publish)\b/u)

    for (const filename of ['read-only-gate.yml', 'protected-apply.yml']) {
      const content = readFileSync(join(root, 'skills/depfresh/examples', filename), 'utf8')
      expect(() => parse(content)).not.toThrow()
      expect(content).not.toMatch(/\b(?:git add|git commit|git push|npm publish)\b/u)
    }
  })

  it('pins every shipped or documented Action example to one full commit SHA', () => {
    for (const path of [
      'skills/depfresh/examples/read-only-gate.yml',
      'skills/depfresh/examples/protected-apply.yml',
      'docs/integrations/github-action.md',
    ]) {
      const content = readFileSync(join(root, path), 'utf8')
      const references = [...content.matchAll(/uses:\s+vcode-sh\/depfresh@([^\s]+)/gu)]
      expect(references, path).toHaveLength(1)
      expect(references[0]?.[1], path).toMatch(/^[a-f0-9]{40}$/u)
    }
  })
})

describe('npm pack manifest compatibility', () => {
  const entry = { name: 'depfresh', version: '2.0.2' }

  it('accepts the npm 11 single-package array format', () => {
    expect(extractSinglePackEntry([entry])).toBe(entry)
  })

  it('accepts the npm 12 single-package keyed format', () => {
    expect(extractSinglePackEntry({ depfresh: entry })).toBe(entry)
  })

  it.each([
    null,
    [],
    [entry, entry],
    {},
    { depfresh: entry, other: { name: 'other' } },
    { unexpected: entry },
  ])('rejects ambiguous or malformed manifests: %j', (manifest) => {
    expect(() => extractSinglePackEntry(manifest)).toThrow()
  })
})
