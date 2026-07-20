import { describe, expect, it } from 'vitest'
import { observeIdentity, promoteWrapperIdentity, registerEvidenceIdentity } from './pty-runner.mjs'

const original = Object.freeze({
  parent: 200,
  group: 300,
  start: 'Sun Jul 19 13:20:31 2026',
})

function createObserved() {
  return Object.assign(new Map([[300, original]]), { ambiguous: false })
}

function createPromotionObserved() {
  return Object.assign(
    new Map([
      [
        300,
        {
          parent: 200,
          group: 250,
          start: original.start,
        },
      ],
    ]),
    {
      allowWrapperPromotion: true,
      ambiguous: false,
      authoritative: new Set<number>(),
      missing: new Set<number>(),
      provisionalGroupChanges: new Map(),
      reappeared: new Set<number>(),
    },
  )
}

const promoted = Object.freeze({ ...original, group: 300 })

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

  it.each(['cli', 'wrapper'] as const)(
    'consumes one exact provisional self-led group change from authoritative %s evidence',
    (role) => {
      const observed = createPromotionObserved()
      observeIdentity(observed, 300, promoted)

      expect(() => registerEvidenceIdentity(observed, role, 300, promoted)).not.toThrow()
      expect(observed.ambiguous).toBe(false)
      expect(observed.get(300)).toEqual(promoted)
      expect(observed.authoritative).toEqual(new Set([300]))
      expect(observed.provisionalGroupChanges.size).toBe(0)
    },
  )

  it.each(['missing', 'reappeared'] as const)(
    'rejects authoritative CLI evidence after a provisional identity was %s',
    (state) => {
      const observed = createPromotionObserved()
      observeIdentity(observed, 300, promoted)
      observed[state].add(300)

      expect(() => registerEvidenceIdentity(observed, 'cli', 300, promoted)).toThrow(
        'PTY process identity evidence changed [cli-group-only]',
      )
      expect(observed.ambiguous).toBe(true)
      expect(observed.authoritative.size).toBe(0)
      expect(observed.provisionalGroupChanges.size).toBe(1)
    },
  )

  it.each([
    ['group', { ...promoted, group: 301 }],
    ['start', { ...promoted, start: 'Sun Jul 19 13:20:32 2026' }],
  ] as const)(
    'rejects changed authoritative CLI %s evidence after a provisional change',
    (_axis, changed) => {
      const observed = createPromotionObserved()
      observeIdentity(observed, 300, promoted)

      expect(() => registerEvidenceIdentity(observed, 'cli', 300, changed)).toThrow(
        /PTY process identity evidence changed/u,
      )
      expect(observed.ambiguous).toBe(true)
      expect(observed.authoritative.size).toBe(0)
    },
  )

  it.each(['wrapper', 'known detached outer root'])(
    'promotes exactly one provisional %s change to its self-led group',
    () => {
      const observed = createPromotionObserved()

      observeIdentity(observed, 300, promoted)

      expect(observed.ambiguous).toBe(false)
      expect(promoteWrapperIdentity(observed, 300, promoted, promoted)).toBe(true)
      expect(observed.get(300)).toEqual(promoted)
      expect(observed.authoritative).toEqual(new Set([300]))
      expect(observed.provisionalGroupChanges.size).toBe(0)
    },
  )

  it.each([
    ['self-led', promoted],
    ['non-self-led', { ...promoted, group: 301 }],
  ] as const)('rejects a zero-change %s wrapper identity', (_kind, identity) => {
    const observed = Object.assign(new Map([[300, identity]]), {
      allowWrapperPromotion: true,
      ambiguous: false,
      authoritative: new Set<number>(),
      missing: new Set<number>(),
      provisionalGroupChanges: new Map(),
      reappeared: new Set<number>(),
    })

    expect(promoteWrapperIdentity(observed, 300, identity, identity)).toBe(false)
    expect(observed.ambiguous).toBe(true)
    expect(observed.authoritative.size).toBe(0)
  })

  it('rejects a provisional wrapper change to a non-self-led group', () => {
    const observed = createPromotionObserved()
    const nonSelf = { ...promoted, group: 301 }

    observeIdentity(observed, 300, nonSelf)

    expect(promoteWrapperIdentity(observed, 300, nonSelf, nonSelf)).toBe(false)
    expect(observed.ambiguous).toBe(true)
    expect(observed.authoritative.size).toBe(0)
  })

  it.each([
    ['parent', { ...promoted, parent: 201 }],
    ['start', { ...promoted, start: 'Sun Jul 19 13:20:32 2026' }],
  ] as const)('rejects changed wrapper %s at promotion', (_axis, changed) => {
    const observed = createPromotionObserved()
    observeIdentity(observed, 300, promoted)

    expect(promoteWrapperIdentity(observed, 300, changed, changed)).toBe(false)
    expect(observed.ambiguous).toBe(true)
    expect(observed.authoritative.size).toBe(0)
  })

  it.each(['missing', 'reappeared'] as const)(
    'rejects a wrapper PID recorded as %s before promotion',
    (state) => {
      const observed = createPromotionObserved()
      observeIdentity(observed, 300, promoted)
      observed[state].add(300)

      expect(promoteWrapperIdentity(observed, 300, promoted, promoted)).toBe(false)
      expect(observed.ambiguous).toBe(true)
      expect(observed.authoritative.size).toBe(0)
    },
  )

  it('requires fresh process evidence to agree with the wrapper sidecar', () => {
    const observed = createPromotionObserved()
    observeIdentity(observed, 300, promoted)

    expect(promoteWrapperIdentity(observed, 300, promoted, { ...promoted, group: 301 })).toBe(false)
    expect(observed.ambiguous).toBe(true)
    expect(observed.authoritative.size).toBe(0)
  })

  it('fails closed when the wrapper is absent from the fresh process snapshot', () => {
    const observed = createPromotionObserved()
    observeIdentity(observed, 300, promoted)

    expect(promoteWrapperIdentity(observed, 300, promoted, undefined)).toBe(false)
    expect(observed.ambiguous).toBe(true)
    expect(observed.authoritative.size).toBe(0)
  })

  it('rejects a second provisional group change', () => {
    const observed = createPromotionObserved()
    observeIdentity(observed, 300, promoted)

    observeIdentity(observed, 300, { ...promoted, group: 301 })

    expect(observed.ambiguous).toBe(true)
    expect(promoteWrapperIdentity(observed, 300, promoted, promoted)).toBe(false)
    expect(observed.authoritative.size).toBe(0)
  })

  it('rejects a group change after wrapper authority is established', () => {
    const observed = createPromotionObserved()
    observeIdentity(observed, 300, promoted)
    expect(promoteWrapperIdentity(observed, 300, promoted, promoted)).toBe(true)

    observeIdentity(observed, 300, { ...promoted, group: 301 })

    expect(observed.ambiguous).toBe(true)
    expect(observed.get(300)).toEqual(promoted)
  })

  it('never clears an unrelated ambiguity while promoting the wrapper', () => {
    const observed = createPromotionObserved()
    observeIdentity(observed, 300, promoted)
    observed.ambiguous = true

    expect(promoteWrapperIdentity(observed, 300, promoted, promoted)).toBe(false)
    expect(observed.ambiguous).toBe(true)
    expect(observed.authoritative.size).toBe(0)
    expect(observed.provisionalGroupChanges.size).toBe(1)
  })
})
