import { readFileSync } from 'node:fs'
import detectIndent from 'detect-indent'
import { basename, dirname } from 'pathe'
import YAML from 'yaml'
import type { depfreshOptions, PackageMeta } from '../../types'
import { parseDependencies } from '../dependencies'
import { parsePackageManagerField } from './package-manager-field'

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

export function loadPackage(filepath: string, options: depfreshOptions): PackageMeta {
  const filename = basename(filepath)

  if (filename === 'package.json') {
    return loadPackageJson(filepath, options)
  }

  if (filename === 'package.yaml') {
    return loadPackageYaml(filepath, options)
  }

  throw new Error(`Unsupported package manifest file: ${filepath}`)
}

function loadPackageJson(filepath: string, options: depfreshOptions): PackageMeta {
  const content = readFileSync(filepath, 'utf-8')
  const raw = asObject(JSON.parse(content))
  const indent = detectIndent(content).indent || '  '
  const deps = parseDependencies(raw, options)

  const meta: PackageMeta = {
    name: typeof raw.name === 'string' ? raw.name : dirname(filepath),
    type: 'package.json',
    filepath,
    deps,
    resolved: [],
    raw,
    indent,
  }

  if (typeof raw.packageManager === 'string') {
    meta.packageManager = parsePackageManagerField(raw.packageManager)
  }

  return meta
}

function loadPackageYaml(filepath: string, options: depfreshOptions): PackageMeta {
  const content = readFileSync(filepath, 'utf-8')
  const doc = YAML.parseDocument(content)

  if (doc.errors.length > 0) {
    const details = doc.errors.map((error) => error.message).join('; ')
    throw new Error(`Failed to parse YAML in ${filepath}: ${details}`)
  }

  const raw = asObject(doc.toJSON())
  const indent = detectIndent(content).indent || '  '
  const deps = parseDependencies(raw, options)

  const meta: PackageMeta = {
    name: typeof raw.name === 'string' ? raw.name : dirname(filepath),
    type: 'package.yaml',
    filepath,
    deps,
    resolved: [],
    raw: doc,
    indent,
  }

  if (typeof raw.packageManager === 'string') {
    meta.packageManager = parsePackageManagerField(raw.packageManager)
  }

  return meta
}
