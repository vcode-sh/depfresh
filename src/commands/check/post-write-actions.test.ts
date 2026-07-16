import c from 'ansis'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { visualLength } from '../../utils/format'
import { renderUpToDate } from './post-write-actions'

const originalIsTTY = process.stdout.isTTY
const originalColumns = process.stdout.columns

describe('renderUpToDate', () => {
  afterAll(() => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: originalIsTTY })
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: originalColumns })
  })

  it('sanitizes and truncates a package title to the terminal width', () => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 20 })
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      renderUpToDate('very-long-package-name\x1B[2J\nowned')
      const title = String(consoleSpy.mock.calls[1]![0])

      expect(title).not.toContain('\x1B[2J')
      expect(visualLength(c.strip(title))).toBeLessThanOrEqual(20)
    } finally {
      consoleSpy.mockRestore()
    }
  })
})
