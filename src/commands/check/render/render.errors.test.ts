import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stripAnsi, visualLength } from '../../../utils/format'
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

  it('truncates resolution error output to terminal width', () => {
    const originalIsTTY = process.stdout.isTTY
    const originalColumns = process.stdout.columns
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 50 })

    try {
      const errors = [
        makeUpdate({
          name: 'missing-package-with-a-very-long-name',
          currentVersion: '^1.0.0-very-long-range-specifier',
          targetVersion: '^1.0.0-very-long-range-specifier',
          diff: 'error',
        }),
      ]

      renderResolutionErrors('broken-app-with-an-even-longer-name-than-usual', errors)

      const stripped = lines.map(stripAnsi)
      const resolutionLines = stripped.filter((line) => line.trim().length > 0)

      for (const line of resolutionLines) {
        expect(visualLength(line)).toBeLessThanOrEqual(50)
      }
      expect(stripped.join('\n')).toContain('resolution errors')
      expect(stripped.join('\n')).toContain('Failed …')
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: originalIsTTY })
      Object.defineProperty(process.stdout, 'columns', {
        configurable: true,
        value: originalColumns,
      })
    }
  })
})
