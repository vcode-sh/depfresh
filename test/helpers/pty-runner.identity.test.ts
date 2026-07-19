import { describe, expect, it } from 'vitest'
import { registerEvidenceIdentity } from './pty-runner.mjs'

const original = Object.freeze({
  parent: 200,
  group: 300,
  start: 'Sun Jul 19 13:20:31 2026',
})

function createObserved() {
  return Object.assign(new Map([[300, original]]), { ambiguous: false })
}

describe('PTY identity registration diagnostics', () => {
  it.each([
    ['cli', 'parent-only', { ...original, parent: 1 }],
    ['cli', 'start-only', { ...original, start: 'Sun Jul 19 13:20:32 2026' }],
    ['cli', 'group-only', { ...original, group: 301 }],
    ['wrapper', 'parent-only', { ...original, parent: 1 }],
    ['cli', 'parent-group', { ...original, parent: 1, group: 301 }],
    ['cli', 'parent-start', { ...original, parent: 1, start: 'Sun Jul 19 13:20:32 2026' }],
    ['cli', 'group-start', { ...original, group: 301, start: 'Sun Jul 19 13:20:32 2026' }],
    ['cli', 'parent-group-start', { parent: 1, group: 301, start: 'Sun Jul 19 13:20:32 2026' }],
  ] as const)(
    'reports only the fixed %s %s diagnostic for a changed identity',
    (role, axis, changed) => {
      const observed = createObserved()
      let caught: unknown

      try {
        registerEvidenceIdentity(observed, role, 300, changed)
      } catch (error) {
        caught = error
      }

      expect(caught).toBeInstanceOf(Error)
      expect((caught as Error).message).toBe(
        `PTY process identity evidence changed [${role}-${axis}]`,
      )
      for (const privateValue of [original.parent, original.group, original.start]) {
        expect((caught as Error).message).not.toContain(String(privateValue))
      }
      expect(observed.ambiguous).toBe(true)
    },
  )

  it('accepts unchanged CLI identity without a diagnostic', () => {
    const observed = createObserved()

    expect(() => registerEvidenceIdentity(observed, 'cli', 300, original)).not.toThrow()
    expect(observed.ambiguous).toBe(false)
  })
})
