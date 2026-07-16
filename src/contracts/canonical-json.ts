function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function assertPlainObject(value: object): asserts value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Canonical JSON only supports plain objects')
  }
}

function assertDataProperties(value: object, array: boolean): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') {
      throw new TypeError('Canonical JSON does not support symbol keys')
    }
    if (array && key === 'length') continue
    if (array && !/^(?:0|[1-9]\d*)$/u.test(key)) {
      throw new TypeError('Canonical JSON arrays cannot have named properties')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor) throw new TypeError('Canonical JSON property descriptor is unavailable')
    if (!('value' in descriptor)) {
      throw new TypeError('Canonical JSON does not support accessor properties')
    }
    if (!descriptor.enumerable) {
      throw new TypeError('Canonical JSON does not support non-enumerable data properties')
    }
  }
}

function serialize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON requires finite numbers')
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (typeof value !== 'object') {
    throw new TypeError(`Canonical JSON does not support ${typeof value}`)
  }
  if (isProxy(value)) throw new TypeError('Canonical JSON does not support proxy objects')
  if (ancestors.has(value)) throw new TypeError('Canonical JSON does not support cyclic values')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      assertDataProperties(value, true)
      const items: string[] = []
      for (let index = 0; index < value.length; index++) {
        if (!(index in value)) throw new TypeError('Canonical JSON does not support sparse arrays')
        items.push(serialize(value[index], ancestors))
      }
      return `[${items.join(',')}]`
    }

    assertPlainObject(value)
    assertDataProperties(value, false)
    const entries = Object.keys(value)
      .sort(compareCodeUnits)
      .map((key) => `${JSON.stringify(key)}:${serialize(value[key], ancestors)}`)
    return `{${entries.join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

export function canonicalJson(value: unknown): string {
  return serialize(value, new Set())
}

import { isProxy } from 'node:util/types'
