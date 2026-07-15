import { createHash } from 'node:crypto'
import { relative, sep } from 'node:path'
import { REPOSITORY_MODEL_SCHEMA_VERSION } from '../types/repository'

export function hashSourceBytes(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

export function createRepositoryId(kind: string, identity: string): string {
  const input = `${REPOSITORY_MODEL_SCHEMA_VERSION}\0${kind}\0${identity}`
  return `${kind}:${createHash('sha256').update(input).digest('hex').slice(0, 24)}`
}

export function toRepositoryRelativePath(root: string, filepath: string): string | undefined {
  const value = relative(root, filepath)
  if (value === '..' || value.startsWith(`..${sep}`)) return undefined
  if (value === '') return '.'
  return value.split(sep).join('/')
}
