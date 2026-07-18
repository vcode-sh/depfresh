import { sanitizeTerminalText } from '../../../../utils/format'
import type { VisualPlusSectionInput } from '../input'
import { formatVisualPlusAge, visualPlusSectionLines, visualPlusSeparator } from '../theme'

export function renderVisualPlusChanges(input: VisualPlusSectionInput): readonly string[] {
  const metadataById = new Map(input.changes.map((metadata) => [metadata.operationId, metadata]))
  const separator = visualPlusSeparator(input.capabilities)
  const changesById = new Map(input.snapshot.changes.map((change) => [change.id, change]))
  const groups = new Map<string, typeof input.changes>()
  for (const metadata of input.changes) {
    const current = groups.get(metadata.ownerGroup.id)
    if (current) groups.set(metadata.ownerGroup.id, [...current, metadata])
    else groups.set(metadata.ownerGroup.id, [metadata])
  }
  const orderedGroups = [...groups.values()].sort((left, right) => {
    const leftOwner = left[0]!.ownerGroup
    const rightOwner = right[0]!.ownerGroup
    return leftOwner.order - rightOwner.order || leftOwner.id.localeCompare(rightOwner.id)
  })
  const logical: string[] = ['Complete change list']
  for (const group of orderedGroups) {
    const owner = group[0]!.ownerGroup
    logical.push(
      `Owner ${sanitizeTerminalText(owner.label)}${separator}${sanitizeTerminalText(owner.physicalTarget)}`,
    )
    for (const metadata of group) {
      const change = changesById.get(metadata.operationId)!
      const compatibility = metadata.compatibility
      const compatibilityText = `compat ${compatibility.status}${compatibility.detail ? ` (${sanitizeTerminalText(compatibility.detail)})` : ''}`
      const catalog = metadata.catalog
        ? `  catalog ${sanitizeTerminalText(metadata.catalog.name)}${separator}${sanitizeTerminalText(metadata.catalog.sourcePath)}`
        : ''
      if (input.capabilities.layout === 'wide' || input.capabilities.layout === 'medium') {
        logical.push(
          `${sanitizeTerminalText(change.name)}  ${sanitizeTerminalText(change.current)} -> ${sanitizeTerminalText(change.target)}  ${change.diff}  age ${formatVisualPlusAge(metadata.ageMs)}  ${compatibilityText}${catalog}`,
        )
      } else {
        logical.push(
          `dependency ${sanitizeTerminalText(change.name)}${separator}current ${sanitizeTerminalText(change.current)}${separator}target ${sanitizeTerminalText(change.target)}${separator}diff ${change.diff}${separator}age ${formatVisualPlusAge(metadata.ageMs)}${separator}${compatibilityText}${catalog}`,
        )
      }
    }
  }
  if (metadataById.size !== input.snapshot.changes.length) {
    throw new Error('Visual+ input: change metadata is incomplete')
  }
  return visualPlusSectionLines(input, logical)
}
