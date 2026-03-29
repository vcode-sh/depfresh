import { describe, expect, it } from 'vitest'
import type { ResolvedDepChange } from '../../../../types'
import { stripAnsi } from '../../../../utils/format'
import { createInitialState } from '../state'
import { colorAge, fitLine, getDepItems } from './common'

function makeDep(name: string): ResolvedDepChange {
  return {
    name,
    currentVersion: '^1.0.0',
    source: 'dependencies',
    update: true,
    parents: [],
    targetVersion: '^2.0.0',
    diff: 'major',
    pkgData: {
      name,
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
    },
  }
}

describe('colorAge', () => {
  it('returns empty string when age is missing', () => {
    expect(colorAge(undefined)).toBe('')
  })

  it('supports green, yellow, and red age colors', () => {
    expect(stripAnsi(colorAge({ text: '~2d', color: 'green' }))).toBe('~2d')
    expect(stripAnsi(colorAge({ text: '~14d', color: 'yellow' }))).toBe('~14d')
    expect(stripAnsi(colorAge({ text: '~90d', color: 'red' }))).toBe('~90d')
  })
})

describe('fitLine', () => {
  it('returns the original line when terminal width is non-positive', () => {
    expect(fitLine('abcdef', 0)).toBe('abcdef')
    expect(fitLine('abcdef', -1)).toBe('abcdef')
  })

  it('keeps lines that already fit', () => {
    expect(fitLine('abc', 10)).toBe('abc')
  })

  it('truncates by visible width rather than ansi length', () => {
    const line = '\u001B[31mabcdefghijk\u001B[39m'
    const fitted = fitLine(line, 6)

    expect(stripAnsi(fitted).length).toBeLessThanOrEqual(6)
  })
})

describe('getDepItems', () => {
  it('filters out non-dependency rows', () => {
    const state = createInitialState([makeDep('alpha'), makeDep('beta')], {
      termRows: 20,
      termCols: 80,
    })

    expect(state.items.some((item) => item.type === 'group-header')).toBe(true)
    expect(getDepItems(state).map((item) => item.dep.name)).toEqual(['alpha', 'beta'])
  })
})
