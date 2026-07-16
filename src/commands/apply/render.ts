import detectIndent from 'detect-indent'
import YAML from 'yaml'
import type { ApplyOperation } from './types'

export type ApplySourceFormat = 'json' | 'yaml'

export interface RenderedFile {
  bytes: Buffer
  values: Map<string, string | undefined>
}

export function renderFile(
  original: Buffer,
  format: ApplySourceFormat,
  operations: readonly ApplyOperation[],
  fallbackIndent: string,
): RenderedFile {
  const text = original.toString('utf8')
  const rendered =
    format === 'json'
      ? renderJson(text, operations, fallbackIndent)
      : renderYaml(text, operations, fallbackIndent)
  return {
    bytes: Buffer.from(rendered),
    values: observeValues(Buffer.from(rendered), format, operations),
  }
}

export function observeValues(
  bytes: Buffer,
  format: ApplySourceFormat,
  operations: readonly ApplyOperation[],
): Map<string, string | undefined> {
  const parsed = parseDocument(bytes, format)
  return new Map(
    operations.map((operation) => [operation.id, getOwnStringAtPath(parsed, operation.path)]),
  )
}

function parseDocument(bytes: Buffer, format: ApplySourceFormat): unknown {
  const text = bytes.toString('utf8')
  if (format === 'json') return JSON.parse(text)
  const document = YAML.parseDocument(text)
  if (document.errors.length > 0) throw new TypeError('YAML source is not parseable')
  return document.toJS()
}

function renderJson(
  content: string,
  operations: readonly ApplyOperation[],
  fallbackIndent: string,
): string {
  const raw: unknown = JSON.parse(content)
  for (const operation of operations) {
    if (!setOwnStringAtPath(raw, operation.path, operation.requestedValue)) {
      throw new TypeError('Planned JSON occurrence is not a writable own string property')
    }
  }
  const indent = detectIndent(content).indent || fallbackIndent
  const serialized = JSON.stringify(raw, null, indent)
  return restoreTextShape(content, serialized)
}

function renderYaml(
  content: string,
  operations: readonly ApplyOperation[],
  fallbackIndent: string,
): string {
  const document = YAML.parseDocument(content)
  if (document.errors.length > 0) throw new TypeError('YAML source is not parseable')
  for (const operation of operations) {
    const current = document.getIn(operation.path, true)
    const value = YAML.isScalar(current) ? current.value : current
    if (typeof value !== 'string') {
      throw new TypeError('Planned YAML occurrence is not a writable string scalar')
    }
    document.setIn(operation.path, operation.requestedValue)
  }
  const detected = detectIndent(content).indent || fallbackIndent
  const width = detected === '\t' ? 2 : Math.max(detected.length, 1)
  const serialized = document.toString({ indent: width }).replace(/\r?\n$/u, '')
  return restoreTextShape(content, serialized)
}

function restoreTextShape(original: string, serialized: string): string {
  const withTrailing = original.endsWith('\n') ? `${serialized}\n` : serialized
  return original.includes('\r\n') ? withTrailing.replace(/\n/g, '\r\n') : withTrailing
}

function getOwnStringAtPath(value: unknown, path: readonly string[]): string | undefined {
  let current = value
  for (const segment of path) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current as object, segment)) {
      return undefined
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return typeof current === 'string' ? current : undefined
}

function setOwnStringAtPath(value: unknown, path: readonly string[], replacement: string): boolean {
  if (path.length === 0) return false
  let current = value
  for (const segment of path.slice(0, -1)) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current as object, segment)) {
      return false
    }
    current = (current as Record<string, unknown>)[segment]
  }
  const key = path.at(-1)
  if (
    !(key && current) ||
    typeof current !== 'object' ||
    !Object.hasOwn(current as object, key) ||
    typeof (current as Record<string, unknown>)[key] !== 'string'
  ) {
    return false
  }
  ;(current as Record<string, unknown>)[key] = replacement
  return true
}
