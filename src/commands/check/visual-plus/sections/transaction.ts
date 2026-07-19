import { sanitizeTerminalText } from '../../../../utils/format'
import type { VisualPlusSectionInput } from '../input'
import { visualPlusSectionLines, visualPlusSeparator } from '../theme'
import { renderVisualPlusCompactTransaction } from './compact'

export function renderVisualPlusTransaction(input: VisualPlusSectionInput): readonly string[] {
  if (input.run.detailLevel === 'compact') return renderVisualPlusCompactTransaction(input)
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
