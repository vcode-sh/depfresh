import { expect, it } from 'vitest'
import type { ResolvedDepChange } from '../../../types'
import { collectUpdateWarnings } from './update-warnings'

function update(overrides: Partial<ResolvedDepChange> = {}): ResolvedDepChange {
  return {
    name: 'example',
    currentVersion: '^1.0.0',
    targetVersion: '^1.1.0',
    source: 'dependencies',
    parents: [],
    update: true,
    diff: 'minor',
    pkgData: { name: 'example', versions: ['1.0.0', '1.1.0'], distTags: {} },
    ...overrides,
  }
}

it('reports observed requirement changes without claiming the installed environment is incompatible', () => {
  const change = update()
  change.pkgData.engines = { '1.0.0': '>=20', '1.1.0': '>=24' }
  change.pkgData.peerDependencies = {
    '1.0.0': { react: '^18', optional: '^1', unchanged: '^1' },
    '1.1.0': { react: '^19', optional: '^1', unchanged: '^1', added: '^2', optionalNew: '^1' },
  }
  change.pkgData.optionalPeerDependencies = { '1.0.0': ['optional'], '1.1.0': ['optionalNew'] }
  const [line] = collectUpdateWarnings([{ owner: 'web', updates: [change] }])
  expect(line).toContain('Node requirement changed: >=20 → >=24')
  expect(line).toContain('Required peer changed: react ^18 → ^19')
  expect(line).toContain('Peer now required: optional ^1')
  expect(line).toContain('Required peer added: added ^2')
  expect(line).not.toMatch(/unchanged|optionalNew|incompatible/iu)
})

it('does not infer changes from missing current metadata or unchanged requirements', () => {
  const change = update()
  change.pkgData.engines = { '1.1.0': '>=24' }
  change.pkgData.peerDependencies = { '1.1.0': { react: '^19' } }
  expect(collectUpdateWarnings([{ owner: 'web', updates: [change] }])).toEqual([])
  change.pkgData.engines['1.0.0'] = '>=24'
  change.pkgData.peerDependencies['1.0.0'] = { react: '^19' }
  expect(collectUpdateWarnings([{ owner: 'web', updates: [change] }])).toEqual([])
})

it('distinguishes confirmed absent requirements from unavailable metadata', () => {
  const change = update()
  change.pkgData.engines = { '1.1.0': '>=24' }
  change.pkgData.peerDependencies = { '1.1.0': { react: '^19' } }
  change.pkgData.engineMetadata = { '1.0.0': 'absent' }
  change.pkgData.peerMetadata = { '1.0.0': 'absent' }
  const [line] = collectUpdateWarnings([{ owner: 'web', updates: [change] }])
  expect(line).toContain('Node requirement added: >=24')
  expect(line).toContain('Required peer added: react ^19')
})

it('groups duplicate transitions across owners and sanitizes registry-controlled text', () => {
  const change = update({ name: 'example\u001b[2J' })
  change.pkgData.deprecated = { '1.1.0': 'Use replacement\u001b[2J' }
  const lines = collectUpdateWarnings([
    { owner: 'web', updates: [change, change] },
    { owner: 'catalog\u001b[2J', updates: [change] },
  ])
  expect(lines).toHaveLength(1)
  expect(lines[0]).toContain('(web, catalog)')
  expect(lines[0]).toContain('Deprecated: Use replacement')
  expect(lines[0]).not.toContain('\u001b')
})

it.each([
  'javascript:alert(1)',
  'https://user:secret@example.com/releases',
  'https://example.com/releases?token=secret',
  'https://example.com/\u001b[2J',
])('does not emit unsafe project URLs: %s', (repository) => {
  const change = update({ diff: 'major', targetVersion: '^2.0.0' })
  change.pkgData.repository = repository
  change.pkgData.homepage = 'https://example.com/releases'
  const [line] = collectUpdateWarnings([{ owner: 'web', updates: [change] }])
  expect(line).toContain('Major update may require code changes')
  expect(line).toContain('Project info: https://example.com/releases')
  expect(line).not.toMatch(/secret|javascript:/u)
  expect(line).not.toContain('\u001b')
})

it('does not claim peers are required when their optionality metadata is unknown', () => {
  const change = update()
  change.pkgData.peerDependencies = { '1.0.0': {}, '1.1.0': { react: '^19' } }
  change.pkgData.peerMetadata = { '1.0.0': 'absent', '1.1.0': 'unknown' }
  expect(collectUpdateWarnings([{ owner: 'web', updates: [change] }])).toEqual([])
})
