import { isProxy } from 'node:util/types'

export function assertPlainDataInput(value: unknown): void {
  assertValue(value, new Set())
}

function assertValue(value: unknown, ancestors: Set<object>): void {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Input numbers must be finite')
    return
  }
  if (typeof value !== 'object') throw new TypeError('Input must contain data values only')
  if (isProxy(value)) throw new TypeError('Input must not contain proxy objects')
  if (ancestors.has(value)) throw new TypeError('Input must not contain cycles')

  const array = Array.isArray(value)
  const prototype = Object.getPrototypeOf(value)
  if (!array && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Input objects must be plain')
  }
  ancestors.add(value)
  try {
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === 'length') continue
      if (typeof key === 'symbol') throw new TypeError('Input must not contain symbol keys')
      if (array && !/^(?:0|[1-9]\d*)$/u.test(key)) {
        throw new TypeError('Input arrays must not contain named properties')
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!(descriptor?.enumerable && 'value' in descriptor)) {
        throw new TypeError('Input must contain enumerable data properties only')
      }
      assertValue(descriptor.value, ancestors)
    }
    if (array) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError('Input arrays must be dense')
      }
    }
  } finally {
    ancestors.delete(value)
  }
}
