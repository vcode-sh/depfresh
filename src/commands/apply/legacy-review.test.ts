import * as fs from 'node:fs'
import { expect, it, vi } from 'vitest'
import * as vcs from '../../repository/vcs'
import type { PackageMeta, ResolvedDepChange } from '../../types'
import { createLegacyReviewEvidence } from './legacy-plan'

vi.mock('node:fs', { spy: true })
vi.mock('../../repository/vcs', { spy: true })

it.each(['manifest', 'catalog'] as const)(
  'reviews loaded %s occurrences without filesystem or Git probes',
  (kind) => {
    vi.clearAllMocks()
    const pkg: PackageMeta = {
      name: 'example',
      type: 'package.json',
      filepath: '/missing-review/package.json',
      deps: [],
      resolved: [],
      raw: {},
      indent: '  ',
    }
    const change: ResolvedDepChange = {
      name: 'dependency',
      currentVersion: '1.0.0',
      rawVersion: '1.0.0',
      source: 'dependencies',
      update: true,
      parents: [],
      targetVersion: '2.0.0',
      diff: 'major',
      pkgData: { name: 'dependency', versions: ['1.0.0', '2.0.0'], distTags: { latest: '2.0.0' } },
    }
    if (kind === 'catalog') {
      change.source = 'catalog'
      pkg.type = 'bun-workspace'
      pkg.catalogs = [
        {
          type: 'bun',
          name: 'default',
          filepath: pkg.filepath,
          deps: [change],
          raw: {},
          indent: '  ',
        },
      ]
    }
    const result = createLegacyReviewEvidence('/missing-review', [
      { packageIndex: 0, pkg, changes: [change] },
    ])
    expect(result).toMatchObject({
      status: 'ready',
      evidence: {
        operations: [
          {
            name: 'dependency',
            current: '1.0.0',
            target: '2.0.0',
            physicalTarget: 'package.json',
            owner: { label: kind === 'catalog' ? 'default' : 'example' },
          },
        ],
        targets: [{ path: 'package.json' }],
      },
    })
    expect(fs.realpathSync).not.toHaveBeenCalled()
    expect(fs.lstatSync).not.toHaveBeenCalled()
    expect(fs.readFileSync).not.toHaveBeenCalled()
    expect(vcs.collectVcsEvidence).not.toHaveBeenCalled()
  },
)
