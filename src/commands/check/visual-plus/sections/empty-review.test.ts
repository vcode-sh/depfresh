import { expect, it } from 'vitest'
import { stripAnsi } from '../../../../utils/format'
import { buildVisualPlusInsights } from '../insights'
import { createVisualPlusFixtureInput } from '../test-fixture'
import { renderVisualPlusHybridReview } from './hybrid'
import { renderVisualPlusReceipt } from './receipt'

function emptyReview(unresolved = 0, write = false) {
  const input = createVisualPlusFixtureInput({
    interactive: false,
    color: false,
    unicode: false,
    motion: false,
    cursorControl: false,
    width: 80,
    layout: 'medium',
  })
  return {
    ...input,
    changes: [],
    snapshot: {
      ...input.snapshot,
      write,
      counts: { ...input.snapshot.counts, unresolved, updates: 0, operations: 0, targets: 0 },
      changes: [],
      targets: [],
      exitCode: 0 as const,
    },
  }
}

it.each([false, true])('keeps a complete no-update result brief (write=%s)', (write) => {
  const input = emptyReview(0, write)
  expect(renderVisualPlusHybridReview(input, buildVisualPlusInsights(input.snapshot))).toEqual([])
  expect(renderVisualPlusReceipt(input).map(stripAnsi)).toEqual(['No updates found.'])
})

it('does not present unresolved dependencies as a complete no-update check', () => {
  const input = emptyReview(2)
  const output = renderVisualPlusReceipt(input).map(stripAnsi).join('\n')
  expect(output).toMatch(/incomplete/iu)
  expect(output).toContain('2')
  expect(output).not.toContain('No updates found.')
})
