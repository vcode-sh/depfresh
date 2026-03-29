import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stripAnsi } from '../../../utils/format'
import { renderResolutionErrors } from './index'
import { makeUpdate } from './test-helpers'

describe('renderResolutionErrors', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let lines: string[]

  beforeEach(() => {
    lines = []
    consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '))
    })
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('renders package name and each failed dependency', () => {
    const errors = [
      makeUpdate({
        name: 'missing-a',
        currentVersion: '^1.0.0',
        targetVersion: '^1.0.0',
        diff: 'error',
      }),
      makeUpdate({
        name: 'missing-b',
        currentVersion: '^2.0.0',
        targetVersion: '^2.0.0',
        diff: 'error',
      }),
    ]

    renderResolutionErrors('broken-app', errors)

    const stripped = lines.map(stripAnsi).join('\n')
    expect(stripped).toContain('broken-app')
    expect(stripped).toContain('resolution errors')
    expect(stripped).toContain('missing-a')
    expect(stripped).toContain('missing-b')
    expect(stripped).toContain('Failed to resolve from registry')
  })
})
