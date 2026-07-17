import { isContractSafeText } from '../contracts/sanitize'
import { ConfigError } from '../errors'

export interface InvocationScopeExclusions {
  workspaces: string[]
  catalogs: string[]
}

function unprovenTarget(kind: 'workspace' | 'catalog'): ConfigError {
  return new ConfigError(
    `The requested ${kind} exclusion is not a safe, proven repository target.`,
    {
      reason: 'SELECTION_TARGET_UNPROVEN',
    },
  )
}

function canonicalizeWorkspace(value: string): string {
  if (
    value.length === 0 ||
    value.length > 4096 ||
    !isContractSafeText(value) ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/u.test(value)
  ) {
    throw unprovenTarget('workspace')
  }

  const segments = value.split('/')
  if (segments.includes('..')) throw unprovenTarget('workspace')
  const canonical = segments.filter((segment) => segment !== '' && segment !== '.').join('/')
  return canonical || '.'
}

function validateCatalog(value: string): string {
  if (value.length === 0 || value.length > 1024 || !isContractSafeText(value)) {
    throw unprovenTarget('catalog')
  }
  return value
}

function addFirstSeen(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value)
}

export function parseInvocationScopeExclusions(
  rawArgs: readonly string[],
): InvocationScopeExclusions {
  const result: InvocationScopeExclusions = { workspaces: [], catalogs: [] }

  for (let index = 0; index < rawArgs.length; index++) {
    const token = rawArgs[index]
    if (!token) continue

    let kind: 'workspace' | 'catalog' | undefined
    let value: string | undefined
    if (token === '--exclude-workspace' || token === '--exclude-catalog') {
      kind = token === '--exclude-workspace' ? 'workspace' : 'catalog'
      value = rawArgs[index + 1]
      index += 1
    } else if (token.startsWith('--exclude-workspace=')) {
      kind = 'workspace'
      value = token.slice('--exclude-workspace='.length)
    } else if (token.startsWith('--exclude-catalog=')) {
      kind = 'catalog'
      value = token.slice('--exclude-catalog='.length)
    }

    if (!kind) continue
    if (value === undefined) throw unprovenTarget(kind)
    if (kind === 'workspace') {
      addFirstSeen(result.workspaces, canonicalizeWorkspace(value))
    } else {
      addFirstSeen(result.catalogs, validateCatalog(value))
    }
  }

  return result
}

export function hasInvocationScopeExclusions(selection: InvocationScopeExclusions): boolean {
  return selection.workspaces.length > 0 || selection.catalogs.length > 0
}
