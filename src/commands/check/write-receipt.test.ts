import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { WriteOutcome, WriteOutcomeReason, WriteOutcomeStatus } from '../../types'
import { buildWriteReceipt, formatWriteReceipt } from './write-receipt'

const root = '/repo'

function outcome(
  file: string,
  index: number,
  status: WriteOutcomeStatus,
  reason: WriteOutcomeReason,
): WriteOutcome {
  return {
    name: `dependency-${index}`,
    occurrence: { file, path: ['dependencies', `dependency-${index}`] },
    expectedValue: '1.0.0',
    requestedValue: '2.0.0',
    status,
    reason,
  }
}

describe('buildWriteReceipt', () => {
  it('groups a partial legacy run by physical target and exact preflight cause', () => {
    const blocked = Array.from({ length: 41 }, (_, index) =>
      outcome(join(root, 'package.json'), index, 'unknown', 'VCS_UNAVAILABLE'),
    )
    const applied = Array.from({ length: 35 }, (_, index) =>
      outcome(
        join(root, 'packages', `package-${index % 13}`, 'package.json'),
        index + 41,
        'applied',
        'APPLIED',
      ),
    )

    const receipt = buildWriteReceipt({
      outcomes: [...applied, ...blocked],
      diagnostics: [{ code: 'VCS_OUTPUT_LIMIT_EXCEEDED', path: 'package.json' }],
      cwd: root,
    })

    expect(receipt.verdict).toBe('partial')
    expect(receipt.operations).toMatchObject({ applied: 35, unknown: 41, planned: 76 })
    expect(receipt.files).toMatchObject({ planned: 14, applied: 13, blocked: 1, unknown: 1 })
    expect(receipt.groups).toHaveLength(1)
    expect(receipt.groups[0]).toMatchObject({
      file: 'package.json',
      status: 'unknown',
      occurrences: 41,
      reason: 'VCS_UNAVAILABLE',
      diagnostic: 'VCS_OUTPUT_LIMIT_EXCEEDED',
      replacementAttempted: false,
    })
    expect(receipt.groups[0]?.details).toHaveLength(41)
  })

  it('recognizes a clean preflight safety block without claiming command atomicity', () => {
    const receipt = buildWriteReceipt({
      outcomes: [outcome(join(root, 'package.json'), 0, 'unknown', 'VCS_UNAVAILABLE')],
      diagnostics: [{ code: 'VCS_NOT_REPOSITORY', path: 'package.json' }],
      cwd: root,
    })

    expect(receipt.verdict).toBe('safety-block')
    expect(receipt.noFilesChanged).toBe(true)
    expect(receipt.groups[0]?.replacementAttempted).toBe(false)

    const afterRecovery = buildWriteReceipt({
      outcomes: [
        outcome(join(root, 'package.json'), 0, 'reverted', 'RESTORE_FAILED'),
        outcome(join(root, 'other.json'), 1, 'unknown', 'VCS_UNAVAILABLE'),
      ],
      diagnostics: [{ code: 'VCS_NOT_REPOSITORY', path: 'other.json' }],
      cwd: root,
    })

    expect(afterRecovery.verdict).toBe('partial')
    expect(afterRecovery.noFilesChanged).toBe(false)
  })

  it('treats a reverted-only result as partial and reports recovery totals', () => {
    const receipt = buildWriteReceipt({
      outcomes: [
        outcome(join(root, 'package.json'), 0, 'reverted', 'WRITE_FAILED'),
        outcome(join(root, 'package.json'), 1, 'reverted', 'WRITE_FAILED'),
      ],
      diagnostics: [],
      cwd: root,
    })

    expect(receipt.verdict).toBe('partial')
    expect(receipt.files).toMatchObject({ applied: 0, reverted: 1, blocked: 0 })
    expect(formatWriteReceipt(receipt, 2)).toEqual([
      'Partial result · 0 updates applied across 0 files; 2 updates reverted across 1 file',
      'package.json · 2 updates reverted',
      'Write reverted (WRITE_FAILED)',
      'Exit 2 · inspect the changed files before rerunning',
    ])
  })

  it('reports applied, reverted, and blocked physical totals in one partial headline', () => {
    const receipt = buildWriteReceipt({
      outcomes: [
        outcome(join(root, 'applied.json'), 0, 'applied', 'APPLIED'),
        outcome(join(root, 'reverted.json'), 1, 'reverted', 'WRITE_FAILED'),
        outcome(join(root, 'blocked.json'), 2, 'unknown', 'VCS_UNAVAILABLE'),
      ],
      diagnostics: [{ code: 'VCS_NOT_REPOSITORY', path: 'blocked.json' }],
      cwd: root,
    })

    expect(receipt.verdict).toBe('partial')
    expect(formatWriteReceipt(receipt, 2)[0]).toBe(
      'Partial result · 1 update applied across 1 file; 1 update reverted across 1 file; 1 file blocked',
    )
  })

  it('sanitizes hostile labels and withholds absolute paths outside the repository', () => {
    const hostileName = `unsafe\u001B]8;;https://example.com\u0007name\nnext`
    const receipt = buildWriteReceipt({
      outcomes: [
        {
          ...outcome(join(root, `pkg-${hostileName}.json`), 0, 'failed', 'WRITE_FAILED'),
          name: hostileName,
          occurrence: {
            file: join(root, `pkg-${hostileName}.json`),
            path: ['dependencies', hostileName],
          },
        },
        outcome('/private/secret/package.json', 1, 'failed', 'WRITE_FAILED'),
        outcome('/another/private/package.json', 2, 'failed', 'WRITE_FAILED'),
      ],
      diagnostics: [],
      cwd: root,
    })

    const serialized = JSON.stringify(receipt)
    expect(serialized).not.toContain('\u001B')
    expect(serialized).not.toContain('/private/secret')
    expect(receipt.files.planned).toBe(3)
    expect(receipt.groups.filter((group) => group.file === '[outside repository]')).toHaveLength(2)
    expect(receipt.groups[0]?.details[0]).toMatchObject({
      name: 'unsafename next',
      path: ['dependencies', 'unsafename next'],
    })
  })
})

describe('formatWriteReceipt', () => {
  it('uses the actual command exit code for an otherwise complete write receipt', () => {
    const complete = buildWriteReceipt({
      outcomes: [outcome(join(root, 'package.json'), 0, 'applied', 'APPLIED')],
      diagnostics: [],
      cwd: root,
    })

    expect(formatWriteReceipt(complete, 2).at(-1)).toBe(
      'Exit 2 · inspect the errors above before rerunning',
    )
  })

  it('pluralizes partial and safety-block receipts and gives the safe next action', () => {
    const partial = buildWriteReceipt({
      outcomes: [
        outcome(join(root, 'packages', 'one.json'), 0, 'applied', 'APPLIED'),
        outcome(join(root, 'package.json'), 1, 'unknown', 'VCS_UNAVAILABLE'),
        outcome(join(root, 'package.json'), 2, 'unknown', 'VCS_UNAVAILABLE'),
      ],
      diagnostics: [{ code: 'VCS_OUTPUT_LIMIT_EXCEEDED', path: 'package.json' }],
      cwd: root,
    })

    expect(formatWriteReceipt(partial, 2)).toEqual([
      'Partial result · 1 update applied across 1 file; 1 file blocked',
      'package.json · 2 updates not attempted',
      'Preflight could not confirm Git state (VCS_UNAVAILABLE / VCS_OUTPUT_LIMIT_EXCEEDED)',
      'Exit 2 · inspect the changed files before rerunning',
    ])

    const safetyBlock = buildWriteReceipt({
      outcomes: [outcome(join(root, 'package.json'), 0, 'unknown', 'VCS_UNAVAILABLE')],
      diagnostics: [{ code: 'VCS_NOT_REPOSITORY', path: 'package.json' }],
      cwd: root,
    })

    expect(formatWriteReceipt(safetyBlock, 2)).toEqual([
      'Safety block · no files were changed',
      'package.json · 1 update not attempted',
      'Preflight could not confirm Git state (VCS_UNAVAILABLE / VCS_NOT_REPOSITORY)',
      'Exit 2 · fix the preflight evidence, then rerun',
    ])
  })
})
