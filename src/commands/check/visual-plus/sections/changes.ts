import { sanitizeTerminalText, visualLength } from '../../../../utils/format'
import type { VisualPlusSectionInput } from '../input'
import {
  createVisualPlusTheme,
  formatVisualPlusAge,
  visualPlusSectionLines,
  visualPlusSeparator,
  wrapVisualPlusText,
} from '../theme'

interface ChangeColumn {
  readonly label: string
  readonly value: string
}

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
      const compatibilityText = `Compatibility ${compatibility.status}${compatibility.detail ? ` (${sanitizeTerminalText(compatibility.detail)})` : ''}`
      if (input.capabilities.layout === 'wide' || input.capabilities.layout === 'medium') {
        logical.push(...renderChangeColumns(input, metadata, change, compatibilityText))
      } else {
        logical.push(
          `Operation ID ${sanitizeTerminalText(metadata.operationId)}`,
          `Dependency ${sanitizeTerminalText(change.name)}`,
          `Current ${sanitizeTerminalText(change.current)}`,
          `Target ${sanitizeTerminalText(change.target)}`,
          `Diff ${change.diff}`,
          `Age ${formatVisualPlusAge(metadata.ageMs)}`,
          compatibilityText,
        )
      }
      if (metadata.catalog) {
        const catalog = sanitizeTerminalText(metadata.catalog.name)
        const source = sanitizeTerminalText(metadata.catalog.sourcePath)
        if (input.capabilities.layout === 'wide' || input.capabilities.layout === 'medium') {
          logical.push(
            ...renderColumns(input, [
              { label: 'Catalog', value: catalog },
              { label: 'Source', value: source },
            ]),
          )
        } else {
          logical.push(`Catalog ${catalog}${separator}Source ${source}`)
        }
      }
    }
  }
  if (metadataById.size !== input.snapshot.changes.length) {
    throw new Error('Visual+ input: change metadata is incomplete')
  }
  return visualPlusSectionLines(input, logical)
}

function renderChangeColumns(
  input: VisualPlusSectionInput,
  metadata: VisualPlusSectionInput['changes'][number],
  change: VisualPlusSectionInput['snapshot']['changes'][number],
  compatibilityText: string,
): readonly string[] {
  const firstRow: readonly ChangeColumn[] =
    input.capabilities.layout === 'wide'
      ? [
          { label: 'Operation ID', value: sanitizeTerminalText(metadata.operationId) },
          { label: 'Dependency', value: sanitizeTerminalText(change.name) },
          { label: 'Current', value: sanitizeTerminalText(change.current) },
          { label: 'Target', value: sanitizeTerminalText(change.target) },
        ]
      : [
          { label: 'Operation ID', value: sanitizeTerminalText(metadata.operationId) },
          { label: 'Dependency', value: sanitizeTerminalText(change.name) },
        ]
  const rows = [renderColumns(input, firstRow)]
  if (input.capabilities.layout === 'medium') {
    rows.push(
      renderColumns(input, [
        { label: 'Current', value: sanitizeTerminalText(change.current) },
        { label: 'Target', value: sanitizeTerminalText(change.target) },
      ]),
    )
  }
  rows.push(
    renderColumns(input, [
      { label: 'Diff', value: change.diff },
      { label: 'Age', value: formatVisualPlusAge(metadata.ageMs) },
      { label: 'Compatibility', value: compatibilityText.slice('Compatibility '.length) },
    ]),
  )
  return rows.flat()
}

function renderColumns(
  input: VisualPlusSectionInput,
  columns: readonly ChangeColumn[],
): readonly string[] {
  const separatorWidth = 3 * (columns.length - 1)
  const available = input.capabilities.width - separatorWidth
  const baseWidth = Math.floor(available / columns.length)
  const remainder = available % columns.length
  const widths = columns.map((_column, index) => baseWidth + (index < remainder ? 1 : 0))
  const theme = createVisualPlusTheme(input.capabilities)
  const cells = columns.map((column, index) => {
    const width = widths[index]!
    const valueWidth = Math.max(1, width - visualLength(column.label) - 1)
    return wrapVisualPlusText(column.value, valueWidth, theme).map(
      (fragment) => `${column.label} ${fragment}`,
    )
  })
  const height = Math.max(...cells.map((cell) => cell.length))
  return Array.from({ length: height }, (_, lineIndex) =>
    cells
      .map((cell, columnIndex) => {
        const label = columns[columnIndex]!.label
        const content = cell[lineIndex] ?? `${label} `
        return `${content}${' '.repeat(widths[columnIndex]! - visualLength(content))}`
      })
      .join(' | '),
  )
}
