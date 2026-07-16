import { describe, expect, it } from 'vitest'
import { canonicalJson } from './canonical-json'

describe('canonicalJson', () => {
  it('sorts object keys by code unit without changing semantic array order', () => {
    const input = {
      z: [{ beta: 2, alpha: 1 }, 'first'],
      A: true,
      a: null,
    }

    expect(canonicalJson(input)).toBe('{"A":true,"a":null,"z":[{"alpha":1,"beta":2},"first"]}')
    expect(input.z[0]).toEqual({ beta: 2, alpha: 1 })
  })

  it.each([
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1n,
    Symbol('unsafe'),
    () => undefined,
    new Date(0),
  ])('rejects values outside the deterministic JSON data model', (value) => {
    expect(() => canonicalJson(value)).toThrow()
  })

  it('rejects cycles and sparse arrays', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const sparse: unknown[] = []
    sparse.length = 2

    expect(() => canonicalJson(cyclic)).toThrow(/cyclic/i)
    expect(() => canonicalJson(sparse)).toThrow(/sparse/i)
  })

  it('rejects accessors, symbol keys, and hidden state', () => {
    const accessor = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => 'side effect',
    })
    const symbolKey = { visible: true, [Symbol('hidden')]: true }
    const hidden = Object.defineProperty({ visible: true }, 'hidden', {
      enumerable: false,
      value: true,
    })

    expect(() => canonicalJson(accessor)).toThrow(/accessor/i)
    expect(() => canonicalJson(symbolKey)).toThrow(/symbol/i)
    expect(() => canonicalJson(hidden)).toThrow(/enumerable/i)
  })

  it('rejects proxies without invoking their traps', () => {
    let traps = 0
    const value = new Proxy(
      { safe: true },
      {
        getPrototypeOf: () => {
          traps += 1
          return Object.prototype
        },
      },
    )

    expect(() => canonicalJson(value)).toThrow(/proxy/i)
    expect(traps).toBe(0)
  })
})
