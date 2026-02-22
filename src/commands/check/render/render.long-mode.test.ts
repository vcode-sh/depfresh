import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stripAnsi } from '../../../utils/format'
import { renderTable } from './index'
import { defaultOpts, makeUpdate } from './test-helpers'

describe('renderTable --long mode', () => {
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

  it('shows homepage URL when long=true and homepage exists', () => {
    const updates = [
      makeUpdate({
        name: 'cool-pkg',
        pkgData: {
          name: 'cool-pkg',
          versions: ['1.0.0', '2.0.0'],
          distTags: { latest: '2.0.0' },
          homepage: 'https://github.com/user/cool-pkg',
        },
      }),
    ]

    renderTable('test-project', updates, { ...defaultOpts, long: true })

    const stripped = lines.map(stripAnsi)
    expect(stripped.some((l) => l.includes('https://github.com/user/cool-pkg'))).toBe(true)
    expect(stripped.some((l) => l.includes('\u21B3'))).toBe(true)
  })

  it('does not show homepage when long=false', () => {
    const updates = [
      makeUpdate({
        name: 'cool-pkg',
        pkgData: {
          name: 'cool-pkg',
          versions: ['1.0.0', '2.0.0'],
          distTags: { latest: '2.0.0' },
          homepage: 'https://github.com/user/cool-pkg',
        },
      }),
    ]

    renderTable('test-project', updates, { ...defaultOpts, long: false })

    const stripped = lines.map(stripAnsi)
    expect(stripped.some((l) => l.includes('https://github.com/user/cool-pkg'))).toBe(false)
  })

  it('does not show homepage line when dep has no homepage', () => {
    const updates = [
      makeUpdate({
        name: 'no-home-pkg',
        pkgData: {
          name: 'no-home-pkg',
          versions: ['1.0.0', '2.0.0'],
          distTags: { latest: '2.0.0' },
        },
      }),
    ]

    renderTable('test-project', updates, { ...defaultOpts, long: true })

    const stripped = lines.map(stripAnsi)
    expect(stripped.some((l) => l.includes('\u21B3'))).toBe(false)
  })

  it('shows homepage for each dep that has one in long mode', () => {
    const updates = [
      makeUpdate({
        name: 'pkg-a',
        pkgData: {
          name: 'pkg-a',
          versions: ['1.0.0', '2.0.0'],
          distTags: { latest: '2.0.0' },
          homepage: 'https://pkg-a.dev',
        },
      }),
      makeUpdate({
        name: 'pkg-b',
        diff: 'minor',
        pkgData: {
          name: 'pkg-b',
          versions: ['1.0.0', '1.1.0'],
          distTags: { latest: '1.1.0' },
        },
      }),
      makeUpdate({
        name: 'pkg-c',
        diff: 'patch',
        pkgData: {
          name: 'pkg-c',
          versions: ['1.0.0', '1.0.1'],
          distTags: { latest: '1.0.1' },
          homepage: 'https://pkg-c.io',
        },
      }),
    ]

    renderTable('test-project', updates, { ...defaultOpts, long: true })

    const stripped = lines.map(stripAnsi)
    const homepageLines = stripped.filter((l) => l.includes('\u21B3'))
    expect(homepageLines).toHaveLength(2)
    expect(homepageLines[0]).toContain('https://pkg-a.dev')
    expect(homepageLines[1]).toContain('https://pkg-c.io')
  })
})
