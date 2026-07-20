import { sanitizeTerminalText } from '../../../../utils/format'
import type { VisualPlusSectionInput } from '../input'
import { visualPlusMapSymbols, visualPlusSectionLines, visualPlusSeparator } from '../theme'
import { isStrictVisualPlusWriteSuccess } from './receipt'

export function requiresVisualPlusDetailedTransaction(input: VisualPlusSectionInput): boolean {
  if (input.snapshot.exitCode === null) return false
  return !(
    (!input.snapshot.write && input.snapshot.exitCode === 0) ||
    isStrictVisualPlusWriteSuccess(input)
  )
}

export function renderVisualPlusTransaction(input: VisualPlusSectionInput): readonly string[] {
  if (input.run.detailLevel === 'compact') {
    return requiresVisualPlusDetailedTransaction(input)
      ? renderVisualPlusDetailedCompactTransaction(input)
      : []
  }
  const results = new Map(input.snapshot.results.targets.map((result) => [result.path, result]))
  const operations = new Map(
    input.snapshot.results.operations.map((result) => [result.operationId, result]),
  )
  const separator = visualPlusSeparator(input.capabilities)
  const logical = [input.snapshot.write ? 'Apply transaction' : 'Reviewed physical targets']
  for (const target of input.snapshot.targets) {
    const result = results.get(target.path)
    const status = result?.outcome ?? 'pending'
    logical.push(
      `Target ${sanitizeTerminalText(target.path)}${separator}${target.operationIds.length} ${target.operationIds.length === 1 ? 'update' : 'updates'}${separator}${status}`,
    )
    const groups = new Map<
      string,
      {
        result: (typeof input.snapshot.results.operations)[number] | undefined
        operationIds: string[]
      }
    >()
    for (const operationId of target.operationIds) {
      const operation = operations.get(operationId)
      const key = operation
        ? JSON.stringify([
            operation.outcome,
            operation.blocked,
            operation.notAttempted,
            operation.unknown,
            operation.reason ?? null,
          ])
        : 'pending'
      const group = groups.get(key)
      if (group) {
        group.operationIds.push(operationId)
      } else {
        groups.set(key, { result: operation, operationIds: [operationId] })
      }
    }
    for (const group of groups.values()) {
      const details = group.result
        ? `${separator}blocked ${group.result.blocked}${separator}not attempted ${group.result.notAttempted}${separator}unknown ${group.result.unknown}`
        : ''
      const reason = group.result?.reason
        ? `${separator}reason ${sanitizeTerminalText(group.result.reason)}`
        : ''
      logical.push(
        `Operations${separator}outcome ${group.result?.outcome ?? 'pending'}${details}${reason}${separator}IDs ${group.operationIds.map(sanitizeTerminalText).join(', ')}`,
      )
    }
  }
  return visualPlusSectionLines(input, logical)
}

function renderVisualPlusDetailedCompactTransaction(
  input: VisualPlusSectionInput,
): readonly string[] {
  const targetResults = new Map(
    input.snapshot.results.targets.map((result) => [result.path, result]),
  )
  const operationResults = new Map(
    input.snapshot.results.operations.map((result) => [result.operationId, result]),
  )
  const changes = new Map(input.snapshot.changes.map((change) => [change.id, change]))
  const restored = new Set(input.snapshot.recovery.restoredPaths)
  const unrecovered = new Set(input.snapshot.recovery.unrecoveredPaths)
  const { arrow, separator } = visualPlusMapSymbols(input.capabilities)
  const logical = [input.snapshot.write ? 'Apply transaction' : 'Reviewed physical targets']
  for (const target of input.snapshot.targets) {
    const result = targetResults.get(target.path)
    const recovery = restored.has(target.path)
      ? `${separator}restored`
      : unrecovered.has(target.path)
        ? `${separator}unrecovered`
        : ''
    const safety = result
      ? `${separator}blocked ${result.blocked}${separator}not attempted ${result.notAttempted}${separator}unknown ${result.unknown}`
      : ''
    logical.push(
      `Target ${sanitizeTerminalText(target.path)}${separator}${target.operationIds.length} ${target.operationIds.length === 1 ? 'update' : 'updates'}${separator}${result?.outcome ?? 'pending'}${safety}${recovery}`,
    )
    for (const operationId of target.operationIds) {
      const change = changes.get(operationId)
      const operation = operationResults.get(operationId)
      if (!change) continue
      const flags = operation
        ? `${separator}blocked ${operation.blocked}${separator}not attempted ${operation.notAttempted}${separator}unknown ${operation.unknown}`
        : ''
      const reason = operation?.reason
        ? `${separator}reason ${sanitizeTerminalText(operation.reason)}`
        : ''
      logical.push(
        `Update ${sanitizeTerminalText(change.name)}${separator}${sanitizeTerminalText(change.current)}${arrow}${sanitizeTerminalText(change.target)}${separator}outcome ${operation?.outcome ?? 'pending'}${flags}${reason}`,
      )
    }
  }
  return visualPlusSectionLines(input, logical)
}
