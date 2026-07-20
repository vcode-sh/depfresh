import type { DepFieldType } from '../../../../types'
import { sanitizeTerminalText, visualLength, visualPadEnd } from '../../../../utils/format'
import { fitCell } from '../../render-layout'
import type { VisualPlusChangeMetadata, VisualPlusSectionInput } from '../input'
import { validateVisualPlusSectionInput } from '../input'
import {
  createVisualPlusTheme,
  formatVisualPlusAge,
  type VisualPlusSeverity,
  visualPlusSeparator,
  wrapVisualPlusIndented,
  wrapVisualPlusJoined,
  wrapVisualPlusText,
  wrapVisualPlusWords,
} from '../theme'

export interface VisualPlusLedgerRow {
  readonly operationId: string
  readonly displayOrder: number
  readonly owner: VisualPlusChangeMetadata['ownerGroup']
  readonly source: DepFieldType
  readonly name: string
  readonly current: string
  readonly target: string
  readonly diff: 'major' | 'minor' | 'patch'
  readonly ageMs: number | null
  readonly compatibility: VisualPlusChangeMetadata['compatibility']
  readonly catalog?: VisualPlusChangeMetadata['catalog']
}

type LedgerGeometry = 'wide' | 'medium' | 'narrow'

interface LedgerColumn {
  readonly heading: string
  readonly width: number
  readonly value: (row: VisualPlusLedgerRow) => readonly string[]
}

export class VisualPlusLedgerError extends Error {
  constructor(message: string) {
    super(`Visual+ ledger: ${message}`)
  }
}

export function createVisualPlusLedgerRows(
  input: VisualPlusSectionInput,
): readonly VisualPlusLedgerRow[] {
  validateVisualPlusSectionInput(input)
  const metadataById = new Map<string, VisualPlusChangeMetadata>()
  for (const metadata of input.changes) {
    if (metadataById.has(metadata.operationId)) invalid('change metadata membership is duplicated')
    metadataById.set(metadata.operationId, metadata)
  }
  const rows: VisualPlusLedgerRow[] = []
  const seen = new Set<string>()
  for (const change of input.snapshot.changes) {
    if (seen.has(change.id)) invalid('snapshot membership is duplicated')
    seen.add(change.id)
    const metadata = metadataById.get(change.id)
    if (metadata === undefined) invalid('change metadata membership is incomplete')
    if (!isLedgerDiff(change.diff)) invalid('ledger change severity is unsupported')
    rows.push({
      operationId: change.id,
      displayOrder: metadata.displayOrder,
      owner: { ...metadata.ownerGroup },
      source: metadata.source,
      name: sanitizeTerminalText(change.name),
      current: sanitizeTerminalText(change.current),
      target: sanitizeTerminalText(change.target),
      diff: change.diff,
      ageMs: metadata.ageMs,
      compatibility: { ...metadata.compatibility },
      ...(metadata.catalog ? { catalog: { ...metadata.catalog } } : {}),
    })
  }
  if (rows.length !== metadataById.size) invalid('snapshot membership is incomplete')
  return rows.sort(
    (left, right) =>
      left.owner.order - right.owner.order ||
      left.displayOrder - right.displayOrder ||
      compareText(left.owner.id, right.owner.id) ||
      compareText(left.operationId, right.operationId),
  )
}

export function renderVisualPlusLedger(
  input: VisualPlusSectionInput,
  rows: readonly VisualPlusLedgerRow[],
): readonly string[] {
  const expected = createVisualPlusLedgerRows(input)
  validateRows(rows, expected)
  if (rows.length === 0) return []
  const theme = createVisualPlusTheme(input.capabilities)
  const geometry = ledgerGeometry(input.capabilities.width)
  const owners = groupStable(rows, (row) => row.owner.id)
  const lines: string[] = []
  for (const ownerRows of owners.values()) {
    if (lines.length > 0) lines.push('')
    const owner = ownerRows[0]!.owner
    lines.push(
      ...wrapVisualPlusJoined(
        [owner.label, owner.physicalTarget],
        visualPlusSeparator(input.capabilities),
        input.capabilities.width,
        theme,
      ).map(theme.heading),
    )
    if (input.run.display.group) {
      const sources = groupStable(ownerRows, (row) => row.source)
      let sourceIndex = 0
      for (const [source, sourceRows] of sources) {
        if (sourceIndex > 0) lines.push('')
        lines.push(
          ...wrapVisualPlusIndented(source, input.capabilities.width, theme).map((line) =>
            theme.emphasis(line),
          ),
        )
        lines.push(...buildLedgerLayout(sourceRows, geometry, input, false))
        sourceIndex += 1
      }
    } else {
      lines.push(...buildLedgerLayout(ownerRows, geometry, input, true))
    }
  }
  return lines
}

function buildLedgerLayout(
  rows: readonly VisualPlusLedgerRow[],
  geometry: LedgerGeometry,
  input: VisualPlusSectionInput,
  showSource: boolean,
): readonly string[] {
  if (geometry === 'narrow') return renderNarrow(rows, input, showSource)
  const theme = createVisualPlusTheme(input.capabilities)
  const width = input.capabilities.width
  const timediff = input.run.display.timediff
  const columns =
    geometry === 'wide'
      ? wideColumns(rows, width, timediff, showSource, input)
      : mediumColumns(rows, width, timediff, showSource, input)
  const lines = [
    renderColumnLine(
      columns.map((column) => fitCell(column.heading, column.width)),
      columns,
    ),
    ledgerRule(columnLineWidth(columns), input.capabilities.unicode),
  ]
  for (const row of rows) {
    const { dependency, continuations } = dependencyCell(row, columns[0]!.width, input)
    const displayRow = dependency === row.name ? row : { ...row, name: dependency }
    const cells = columns.map((column) => column.value(displayRow))
    const height = Math.max(...cells.map((cell) => cell.length))
    for (let lineIndex = 0; lineIndex < height; lineIndex += 1) {
      lines.push(
        renderColumnLine(
          cells.map((cell) => cell[lineIndex] ?? ''),
          columns,
        ),
      )
    }
    for (const continuation of continuations) {
      lines.push(
        ...wrapVisualPlusIndented(continuation, width, theme).map((line) => theme.muted(line)),
      )
    }
  }
  return lines
}

function wideColumns(
  rows: readonly VisualPlusLedgerRow[],
  width: number,
  timediff: boolean,
  showSource: boolean,
  input: VisualPlusSectionInput,
): readonly LedgerColumn[] {
  const theme = createVisualPlusTheme(input.capabilities)
  const sourceWidth = showSource ? 18 : 0
  const currentWidth = boundedSemanticWidth(
    rows.map((row) => row.current),
    'current',
    12,
  )
  const targetWidth = boundedSemanticWidth(
    rows.map((row) => row.target),
    'target',
    12,
  )
  const severityWidth = 8
  const ageWidth = timediff ? 7 : 0
  const trailingWidths = [
    ...(showSource ? [sourceWidth] : []),
    currentWidth,
    targetWidth,
    severityWidth,
    ...(timediff ? [ageWidth] : []),
  ]
  const availableDependencyWidth = Math.max(
    1,
    width - trailingWidths.reduce((total, value) => total + value, 0) - trailingWidths.length * 2,
  )
  const dependencyWidth = Math.min(40, availableDependencyWidth)
  return [
    textColumn('dependency', dependencyWidth, (row) => row.name, theme),
    ...(showSource ? [textColumn('source', sourceWidth, (row) => row.source, theme)] : []),
    textColumn('current', currentWidth, (row) => row.current, theme, theme.muted),
    textColumn(
      'target',
      targetWidth,
      (row) => row.target,
      theme,
      (value, row) => theme.styleSeverity(row.diff, value),
    ),
    textColumn(
      'severity',
      severityWidth,
      (row) => capitalize(row.diff),
      theme,
      (value, row) => theme.styleSeverity(row.diff, value),
    ),
    ...(timediff
      ? [textColumn('age', ageWidth, (row) => formatVisualPlusAge(row.ageMs), theme)]
      : []),
  ]
}

function mediumColumns(
  rows: readonly VisualPlusLedgerRow[],
  width: number,
  timediff: boolean,
  showSource: boolean,
  input: VisualPlusSectionInput,
): readonly LedgerColumn[] {
  const theme = createVisualPlusTheme(input.capabilities)
  const transitionHeading = input.capabilities.unicode ? 'current → target' : 'current -> target'
  const transitionWidth = Math.min(
    25,
    Math.max(
      visualLength(transitionHeading),
      ...rows.map((row) => visualLength(`${row.current}${theme.arrow}${row.target}`)),
    ),
  )
  const severityWidth = 8
  const ageWidth = timediff ? 7 : 0
  const columnCount = 3 + (showSource ? 1 : 0) + (timediff ? 1 : 0)
  const gapsWidth = (columnCount - 1) * 2
  const sourceWidth = showSource
    ? Math.max(
        1,
        Math.min(
          15,
          width -
            transitionWidth -
            severityWidth -
            ageWidth -
            gapsWidth -
            visualLength('dependency'),
        ),
      )
    : 0
  const trailingWidths = [
    ...(showSource ? [sourceWidth] : []),
    transitionWidth,
    severityWidth,
    ...(timediff ? [ageWidth] : []),
  ]
  const dependencyWidth = Math.max(
    1,
    width - trailingWidths.reduce((total, value) => total + value, 0) - trailingWidths.length * 2,
  )
  return [
    textColumn('dependency', dependencyWidth, (row) => row.name, theme),
    ...(showSource ? [textColumn('source', sourceWidth, (row) => row.source, theme)] : []),
    {
      heading: transitionHeading,
      width: transitionWidth,
      value: (row) => {
        const plain = `${row.current}${theme.arrow}${row.target}`
        if (visualLength(plain) <= transitionWidth) {
          return [
            `${theme.muted(row.current)}${theme.arrow}${theme.styleSeverity(row.diff, row.target)}`,
          ]
        }
        return wrapVisualPlusText(plain, transitionWidth, theme).map((fragment) =>
          theme.styleSeverity(row.diff, fragment),
        )
      },
    },
    textColumn(
      'severity',
      severityWidth,
      (row) => capitalize(row.diff),
      theme,
      (value, row) => theme.styleSeverity(row.diff, value),
    ),
    ...(timediff
      ? [textColumn('age', ageWidth, (row) => formatVisualPlusAge(row.ageMs), theme)]
      : []),
  ]
}

function renderNarrow(
  rows: readonly VisualPlusLedgerRow[],
  input: VisualPlusSectionInput,
  showSource: boolean,
): readonly string[] {
  const theme = createVisualPlusTheme(input.capabilities)
  const width = input.capabilities.width
  const separator = visualPlusSeparator(input.capabilities)
  const headings = [
    'dependency',
    ...(showSource ? ['source'] : []),
    'transition',
    'severity',
    ...(input.run.display.timediff ? ['age'] : []),
  ]
  const lines = [
    ...wrapVisualPlusJoined(headings, separator, width, theme),
    ledgerRule(width, input.capabilities.unicode),
  ]
  for (const row of rows) {
    const evidence = rowEvidence(row, input)
    const name = showSource ? `${row.source}${separator}${row.name}` : row.name
    let dependency = name
    const continuations: string[] = []
    for (const item of evidence) {
      const candidate = `${dependency} [${item}]`
      if (visualLength(candidate) <= width) dependency = candidate
      else continuations.push(item)
    }
    lines.push(...wrapVisualPlusWords(dependency, width, theme))
    lines.push(...narrowTransitionLines(row, input.run.display.timediff, width, separator, theme))
    for (const continuation of continuations) {
      lines.push(
        ...wrapVisualPlusIndented(continuation, width, theme).map((line) => theme.muted(line)),
      )
    }
  }
  return lines
}

interface NarrowSemanticLine {
  plain: string
  rendered: string
}

function narrowTransitionLines(
  row: VisualPlusLedgerRow,
  timediff: boolean,
  width: number,
  separator: string,
  theme: ReturnType<typeof createVisualPlusTheme>,
): readonly string[] {
  const prefix = ' '.repeat(Math.min(2, Math.max(0, width - 1)))
  const contentWidth = Math.max(1, width - visualLength(prefix))
  const transition = `${row.current}${theme.arrow}${row.target}`
  const targetStart = row.current.length + theme.arrow.length
  const targetEnd = targetStart + row.target.length
  let transitionOffset = 0
  const lines: NarrowSemanticLine[] = wrapVisualPlusText(transition, contentWidth, theme).map(
    (fragment) => {
      const rendered = styleFragmentRange(
        fragment,
        transitionOffset,
        targetStart,
        targetEnd,
        (value) => theme.styleSeverity(row.diff, value),
      )
      transitionOffset += fragment.length
      return { plain: fragment, rendered }
    },
  )
  appendNarrowSemantic(lines, capitalize(row.diff), separator, contentWidth, theme, (fragment) =>
    theme.styleSeverity(row.diff, fragment),
  )
  if (timediff) {
    appendNarrowSemantic(lines, formatVisualPlusAge(row.ageMs), separator, contentWidth, theme)
  }
  return lines.map((line) => `${prefix}${line.rendered}`)
}

function appendNarrowSemantic(
  lines: NarrowSemanticLine[],
  value: string,
  separator: string,
  width: number,
  theme: ReturnType<typeof createVisualPlusTheme>,
  style?: (fragment: string) => string,
): void {
  const fragments = wrapVisualPlusText(value, width, theme)
  const first = fragments[0]!
  const last = lines.at(-1)!
  if (fragments.length === 1 && visualLength(`${last.plain}${separator}${first}`) <= width) {
    last.plain = `${last.plain}${separator}${first}`
    last.rendered = `${last.rendered}${separator}${style ? style(first) : first}`
    return
  }
  for (const fragment of fragments) {
    lines.push({ plain: fragment, rendered: style ? style(fragment) : fragment })
  }
}

function styleFragmentRange(
  fragment: string,
  offset: number,
  rangeStart: number,
  rangeEnd: number,
  style: (value: string) => string,
): string {
  const start = Math.max(0, rangeStart - offset)
  const end = Math.min(fragment.length, rangeEnd - offset)
  if (start >= end) return fragment
  return `${fragment.slice(0, start)}${style(fragment.slice(start, end))}${fragment.slice(end)}`
}

function textColumn(
  heading: string,
  width: number,
  plainValue: (row: VisualPlusLedgerRow) => string,
  theme: ReturnType<typeof createVisualPlusTheme>,
  style?: (value: string, row: VisualPlusLedgerRow) => string,
): LedgerColumn {
  return {
    heading,
    width,
    value: (row) =>
      wrapVisualPlusText(plainValue(row), width, theme).map((fragment) =>
        style ? style(fragment, row) : fragment,
      ),
  }
}

function dependencyCell(
  row: VisualPlusLedgerRow,
  width: number,
  input: VisualPlusSectionInput,
): { dependency: string; continuations: readonly string[] } {
  let dependency = row.name
  const continuations: string[] = []
  for (const evidence of rowEvidence(row, input)) {
    const candidate = `${dependency} [${evidence}]`
    if (visualLength(candidate) <= width) dependency = candidate
    else continuations.push(evidence)
  }
  return { dependency, continuations }
}

function rowEvidence(row: VisualPlusLedgerRow, input: VisualPlusSectionInput): readonly string[] {
  const result: string[] = []
  if (input.run.display.nodecompat && row.compatibility.status !== 'compatible') {
    result.push(
      `compat ${row.compatibility.status}${row.compatibility.detail ? `: ${row.compatibility.detail}` : ''}`,
    )
  }
  if (row.catalog) result.push(`catalog ${row.catalog.name}: ${row.catalog.sourcePath}`)
  return result
}

function renderColumnLine(values: readonly string[], columns: readonly LedgerColumn[]): string {
  return values
    .map((value, index) => visualPadEnd(value, columns[index]!.width))
    .join('  ')
    .trimEnd()
}

function ledgerRule(width: number, unicode: boolean): string {
  return (unicode ? '─' : '-').repeat(width)
}

function columnLineWidth(columns: readonly LedgerColumn[]): number {
  return columns.reduce((total, column) => total + column.width, 0) + (columns.length - 1) * 2
}

function boundedSemanticWidth(values: readonly string[], heading: string, maximum: number): number {
  return Math.min(maximum, Math.max(visualLength(heading), ...values.map(visualLength)))
}

function validateRows(
  rows: readonly VisualPlusLedgerRow[],
  expected: readonly VisualPlusLedgerRow[],
): void {
  if (rows.length !== expected.length) invalid('row membership is incomplete')
  for (let index = 0; index < expected.length; index += 1) {
    if (!sameRow(rows[index], expected[index])) invalid('row facts or order are inconsistent')
  }
}

function sameRow(
  left: VisualPlusLedgerRow | undefined,
  right: VisualPlusLedgerRow | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function groupStable<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const value of values) {
    const groupKey = key(value)
    const group = groups.get(groupKey)
    if (group) group.push(value)
    else groups.set(groupKey, [value])
  }
  return groups
}

function ledgerGeometry(width: number): LedgerGeometry {
  return width >= 100 ? 'wide' : width >= 60 ? 'medium' : 'narrow'
}

function isLedgerDiff(value: string): value is VisualPlusSeverity {
  return value === 'major' || value === 'minor' || value === 'patch'
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function invalid(message: string): never {
  throw new VisualPlusLedgerError(message)
}
