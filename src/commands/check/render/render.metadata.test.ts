import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stripAnsi } from '../../../utils/format'
import { renderTable } from './index'
import { defaultOpts, makeUpdate } from './test-helpers'

describe('renderTable timediff', () => {
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

  it('shows age column when timediff is true', () => {
    const updates = [
      makeUpdate({
        name: 'fresh-pkg',
        publishedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      }),
    ]

    renderTable('test-project', updates, { ...defaultOpts, timediff: true })

    const stripped = lines.map(stripAnsi)
    const headerLine = stripped.find((l) => l.includes('age'))
    expect(headerLine).toBeDefined()
    const depLine = stripped.find((l) => l.includes('fresh-pkg'))
    expect(depLine).toContain('~')
  })

  it('hides age column when timediff is false', () => {
    const updates = [makeUpdate({ name: 'fresh-pkg', publishedAt: new Date().toISOString() })]

    renderTable('test-project', updates, { ...defaultOpts, timediff: false })

    const stripped = lines.map(stripAnsi)
    const headerLine = stripped.find((l) => l.includes('age'))
    expect(headerLine).toBeUndefined()
  })
})

describe('renderTable signature-metadata warning', () => {
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

  it('shows warning when signature metadata changes from present to absent', () => {
    const updates = [
      makeUpdate({
        name: 'risky-pkg',
        currentSignaturePresence: 'present',
        signaturePresence: 'absent',
      }),
    ]

    renderTable('test-project', updates, defaultOpts)

    const stripped = lines.map(stripAnsi)
    const depLine = stripped.find((l) => l.includes('risky-pkg'))
    expect(depLine).toContain('\u26A0')
  })

  it('does not show warning when signature metadata stays present', () => {
    const updates = [
      makeUpdate({
        name: 'safe-pkg',
        currentSignaturePresence: 'present',
        signaturePresence: 'present',
      }),
    ]

    renderTable('test-project', updates, defaultOpts)

    const stripped = lines.map(stripAnsi)
    const depLine = stripped.find((l) => l.includes('safe-pkg'))
    expect(depLine).not.toContain('\u26A0')
  })

  it('does not show warning when no signature metadata is available', () => {
    const updates = [makeUpdate({ name: 'normal-pkg' })]

    renderTable('test-project', updates, defaultOpts)

    const stripped = lines.map(stripAnsi)
    const depLine = stripped.find((l) => l.includes('normal-pkg'))
    expect(depLine).not.toContain('\u26A0')
  })
})

describe('renderTable nodecompat display', () => {
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

  it('shows check mark when node is compatible', () => {
    const updates = [
      makeUpdate({
        name: 'compat-pkg',
        nodeCompatible: true,
        nodeCompat: '>=18',
      }),
    ]

    renderTable('test-project', updates, { ...defaultOpts, nodecompat: true })

    const stripped = lines.map(stripAnsi)
    const depLine = stripped.find((l) => l.includes('compat-pkg'))
    expect(depLine).toContain('\u2713')
  })

  it('shows cross mark when node is incompatible', () => {
    const updates = [
      makeUpdate({
        name: 'incompat-pkg',
        nodeCompatible: false,
        nodeCompat: '<16',
      }),
    ]

    renderTable('test-project', updates, { ...defaultOpts, nodecompat: true })

    const stripped = lines.map(stripAnsi)
    const depLine = stripped.find((l) => l.includes('incompat-pkg'))
    expect(depLine).toContain('\u2717node')
  })

  it('shows nothing when nodeCompatible is undefined', () => {
    const updates = [makeUpdate({ name: 'no-engines-pkg' })]

    renderTable('test-project', updates, { ...defaultOpts, nodecompat: true })

    const stripped = lines.map(stripAnsi)
    const depLine = stripped.find((l) => l.includes('no-engines-pkg'))
    expect(depLine).not.toContain('\u2713')
    expect(depLine).not.toContain('\u2717')
  })

  it('shows unknown when engine metadata exists without repository compatibility evidence', () => {
    const updates = [
      makeUpdate({ name: 'unknown-engine-pkg', nodeCompat: '>=20', nodeCompatible: undefined }),
    ]

    renderTable('test-project', updates, { ...defaultOpts, nodecompat: true })

    const depLine = lines.map(stripAnsi).find((line) => line.includes('unknown-engine-pkg'))
    expect(depLine).toContain('?node')
    expect(depLine).not.toContain('\u2713')
  })

  it('hides nodecompat indicators when nodecompat option is false', () => {
    const updates = [
      makeUpdate({
        name: 'compat-pkg',
        nodeCompatible: true,
        nodeCompat: '>=18',
      }),
    ]

    renderTable('test-project', updates, { ...defaultOpts, nodecompat: false })

    const stripped = lines.map(stripAnsi)
    const depLine = stripped.find((l) => l.includes('compat-pkg'))
    expect(depLine).not.toContain('\u2713')
    expect(depLine).not.toContain('\u2717')
  })
})
