import { accessSync, constants, lstatSync, realpathSync } from 'node:fs'
import {
  canonicalExistingRegularFile,
  readStableRegularFile,
} from './visual-plus-replay-failure.mjs'
import { classifyRawTerminalTransport } from '../test/helpers/pty-runner.mjs'

export function observeBunx(path, maxBytes) {
  const lexical = lstatSync(path)
  accessSync(path, constants.X_OK)
  if (!lexical.isFile() && !lexical.isSymbolicLink()) {
    throw new Error('Resolved bunx entry is unsafe')
  }
  const realpath = canonicalExistingRegularFile(
    realpathSync.native(path),
    'Resolved bunx executable',
  )
  const target = readStableRegularFile(realpath, {
    label: 'Resolved bunx executable',
    maxBytes,
  })
  const afterLexical = lstatSync(path)
  if (
    !sameIdentity(pathIdentity(lexical), pathIdentity(afterLexical)) ||
    realpathSync.native(path) !== realpath
  ) {
    throw new Error('Resolved bunx entry changed while being inspected')
  }
  return {
    path,
    realpath,
    sha256: target.identity.sha256,
    pathIdentity: pathIdentity(lexical),
    targetIdentity: target.identity,
  }
}

export function requireBunxIdentity(expected, maxBytes) {
  let actual
  try {
    actual = observeBunx(expected.path, maxBytes)
  } catch {
    throw new Error('Resolved bunx executable identity changed')
  }
  if (
    actual.realpath !== expected.realpath ||
    actual.sha256 !== expected.sha256 ||
    !sameIdentity(actual.pathIdentity, expected.pathIdentity) ||
    !sameIdentity(actual.targetIdentity, expected.targetIdentity)
  ) {
    throw new Error('Resolved bunx executable identity changed')
  }
}

export function requireBoundBunxIdentity(expected, maxBytes) {
  const actual = observeBunx(expected.path, maxBytes)
  if (
    actual.realpath !== expected.realpath ||
    actual.sha256 !== expected.sha256 ||
    !sameFileCore(actual.targetIdentity, expected.targetIdentity) ||
    !sameFileCore(actual.pathIdentity, expected.pathIdentity)
  ) {
    throw new Error('Resolved bunx executable changed while binding its launcher')
  }
  return actual
}

export function requireExecutionIdentity(bunx, bunGlobal, expectedCliSha256, maxBytes) {
  requireBunxIdentity(bunx, maxBytes)
  let linkStats
  try {
    const binStats = lstatSync(bunGlobal.binRealpath)
    if (!sameIdentity(pathIdentity(binStats), bunGlobal.binIdentity)) throw new Error()
    linkStats = lstatSync(bunGlobal.depfreshLink)
    if (!linkStats.isSymbolicLink()) throw new Error()
  } catch {
    throw new Error('Bun global depfresh identity changed')
  }
  const targetPath = realpathSync.native(bunGlobal.depfreshLink)
  if (
    targetPath !== bunGlobal.depfreshLinkTarget ||
    !sameIdentity(pathIdentity(linkStats), bunGlobal.linkIdentity)
  ) {
    throw new Error('Bun global depfresh identity changed')
  }
  const target = readStableRegularFile(targetPath, {
    label: 'Bun global depfresh CLI',
    maxBytes,
  })
  if (
    !sameIdentity(pathIdentity(lstatSync(bunGlobal.binRealpath)), bunGlobal.binIdentity) ||
    !sameIdentity(pathIdentity(lstatSync(bunGlobal.depfreshLink)), bunGlobal.linkIdentity) ||
    realpathSync.native(bunGlobal.depfreshLink) !== bunGlobal.depfreshLinkTarget ||
    target.identity.sha256 !== expectedCliSha256 ||
    !sameIdentity(target.identity, bunGlobal.targetIdentity)
  ) {
    throw new Error('Bun global depfresh identity changed')
  }
}

export function analyzeHybridRun(result, columns, argv, repositoryName) {
  requireSuccessfulPty(result, columns)
  const screen = result.transcript
  const lines = screen.trimEnd().split('\n')
  const context = lines.findIndex(
    (line) =>
      line.includes(repositoryName) &&
      /\bbun(?:\s|\b)/u.test(line) &&
      line.includes('major') &&
      line.includes('read-only'),
  )
  const topologyPattern =
    /^([0-9]+) packages (?:·|-) ([0-9]+) declared (?:·|-) ([0-9]+) eligible (?:·|-) ([0-9]+) updates (?:·|-) ([0-9]+) files$/u
  const severityPattern =
    /^Major ([0-9]+) (?:·|-) Minor ([0-9]+) (?:·|-) Patch ([0-9]+)$/u
  const topology = lines.findIndex((line) => topologyPattern.test(line))
  const severity = lines.findIndex((line) => severityPattern.test(line))
  const breaking = lines.findIndex((line) => line === 'Breaking changes')
  const ledger = lines.findIndex((line, index) => index > breaking && isLedgerHeader(line))
  const indexes = [context, topology, severity, breaking, ledger]
  if (
    indexes.some((index) => index < 0) ||
    indexes.some((value, index) => index > 0 && value <= indexes[index - 1])
  ) {
    throw new Error('Live Visual+ hierarchy is incomplete')
  }
  const topologyMatch = topologyPattern.exec(lines[topology])
  const severityMatch = severityPattern.exec(lines[severity])
  const topologyCounts = topologyMatch?.slice(1).map(Number) ?? []
  const severityCounts = severityMatch?.slice(1).map(Number) ?? []
  const declared = topologyCounts[3]
  const topologyFiles = topologyCounts[4]
  const receiptIndex = lines.findIndex(
    (line, index) => index > ledger && /^Review complete\b/u.test(line),
  )
  if (!Number.isSafeInteger(declared) || declared < 1 || receiptIndex < 0) {
    throw new Error('Live Visual+ update membership is incomplete')
  }
  const rows = parseLedgerRows(lines.slice(breaking + 1, receiptIndex))
  const distinctRows = new Set(rows.map(semanticLedgerRowKey))
  const receiptMatch = /^Review complete (?:·|-) ([0-9]+) updates across ([0-9]+) files? (?:·|-) write not attempted$/u.exec(
    lines[receiptIndex],
  )
  const receiptUpdates = Number(receiptMatch?.[1])
  const receiptFiles = Number(receiptMatch?.[2])
  const physicalFiles = new Set(rows.map(({ file }) => file))
  const rowSeverity = {
    major: rows.filter(({ severity }) => severity === 'Major').length,
    minor: rows.filter(({ severity }) => severity === 'Minor').length,
    patch: rows.filter(({ severity }) => severity === 'Patch').length,
  }
  if (
    topologyCounts.length !== 5 ||
    severityCounts.length !== 3 ||
    [...topologyCounts, ...severityCounts, receiptUpdates, receiptFiles].some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    ) ||
    declared < 1 ||
    rows.length !== declared ||
    distinctRows.size !== declared ||
    rows.some((row) => !hasCompleteCatalogContext(row)) ||
    receiptUpdates !== declared ||
    topologyFiles !== physicalFiles.size ||
    receiptFiles !== physicalFiles.size ||
    severityCounts[0] !== rowSeverity.major ||
    severityCounts[1] !== rowSeverity.minor ||
    severityCounts[2] !== rowSeverity.patch
  ) {
    throw new Error('Live Visual+ update membership differs from the summary')
  }
  if (
    /Lifecycle|Update preview|audit preview|Operation ID|Owner ID|Dependency ID|Package ID|Source ID/iu.test(
      screen,
    )
  ) {
    throw new Error('Live Visual+ default output contains forbidden audit details')
  }
  return {
    columns,
    argv,
    exitCode: result.exitCode,
    signal: result.signal,
    finalCursorVisible: result.finalCursorVisible,
    controls: result.controls,
    rawControl: classifyRawTerminalTransport(result.rawTerminal),
    operationRows: {
      declared,
      rendered: rows.length,
      files: physicalFiles.size,
      severity: rowSeverity,
      complete: true,
    },
    hierarchyTokens: ['context', 'topology', 'severity', 'breaking-changes', 'update-ledger'],
    finalScreen: screen,
  }
}

export function analyzeLongRun(result, columns, argv, expectedOperations) {
  requireSuccessfulPty(result, columns)
  const screen = result.transcript
  requireUniqueOrderedSections(screen, [
    'Risk focus',
    'Owner impact',
    'Shared dependencies',
    'Complete change list',
    'Reviewed physical targets',
    'Review complete',
  ])
  const topology = exactSectionLine(screen, /\b([0-9]+) updates (?:→|->) ([0-9]+) files?\b/u)
  const ownerSection = exactSection(screen, 'Owner impact', 'Shared dependencies')
  const sharedSection = exactSection(screen, 'Shared dependencies', 'Complete change list')
  const operationSection = exactSection(
    screen,
    'Complete change list',
    'Reviewed physical targets',
  )
  const targetSection = exactSection(screen, 'Reviewed physical targets', 'Review complete')
  const riskSection = exactSection(screen, 'Risk focus', 'Owner impact')
  const owners = parseOwnerMembership(ownerSection)
  const shared = parseSharedMembership(sharedSection)
  const operations = reviewOperationFields(operationSection)
  const majorCards = parseMajorMembership(riskSection)
  const targets = parseTargetMembership(targetSection)
  const receipt = /^([0-9]+) updates reviewed across ([0-9]+) targets?\.$/mu.exec(
    screen.slice(screen.indexOf('Review complete\n') + 'Review complete\n'.length),
  )
  const membership = {
    dependencies: shared.dependencies.length,
    majorCards: majorCards.length,
    occurrences: shared.occurrences.length,
    operations: operations.operationIds.length,
    owners: owners.length,
    targets: targets.length,
  }
  const ownerTargets = aggregateCounts(owners, ({ target }) => target, ({ updates }) => updates)
  const reviewedTargets = aggregateCounts(targets, ({ path }) => path, ({ updates }) => updates)
  const ownerGroups = aggregateCounts(
    owners,
    ({ label, target }) => JSON.stringify([label, target]),
    ({ updates }) => updates,
  )
  const operationGroups = aggregateCounts(
    operations.groups,
    ({ label, target }) => JSON.stringify([label, target]),
    ({ updates }) => updates,
  )
  const operationDependencies = aggregateCounts(operations.dependencies, (value) => value)
  const expectedSharedDependencies = new Map(
    [...operationDependencies].filter(([, count]) => count > 1),
  )
  const sharedDependencies = aggregateCounts(
    shared.occurrences,
    ({ dependency }) => dependency,
  )
  const sharedNames = new Set(shared.dependencies.map(({ name }) => name))
  const expectedSharedPairs = aggregateCounts(
    operations.records.filter(({ dependency }) => sharedNames.has(dependency)),
    ({ dependency, owner }) => JSON.stringify([dependency, owner]),
  )
  const sharedPairs = aggregateCounts(
    shared.occurrences,
    ({ dependency, owner }) => JSON.stringify([dependency, owner]),
  )
  const ownerSeverities = aggregateCounts(
    owners.flatMap(({ distribution, label, target }) =>
      Object.entries(distribution).flatMap(([severity, count]) =>
        count > 0 ? [{ count, label, severity, target }] : [],
      ),
    ),
    ({ label, severity, target }) => JSON.stringify([label, target, severity]),
    ({ count }) => count,
  )
  const operationSeverities = aggregateCounts(
    operations.records,
    ({ diff, owner, target }) => JSON.stringify([owner, target, diff]),
  )
  const riskMajorDependencies = aggregateCounts(
    majorCards,
    ({ dependency }) => dependency,
    ({ occurrences }) => occurrences,
  )
  const operationMajorDependencies = aggregateCounts(
    operations.records.filter(({ diff }) => diff === 'major'),
    ({ dependency }) => dependency,
  )
  const allFields = [
    ...owners.flatMap(({ id, label, target }) => [id, label, target]),
    ...shared.dependencies.flatMap(({ id, name }) => [id, name]),
    ...shared.occurrences.flatMap(({ dependency, owner, source, path }) => [
      dependency,
      owner,
      source,
      path,
    ]),
    ...operations.operationIds,
    ...operations.dependencies,
    ...operations.records.map(({ diff }) => diff),
    ...operations.groups.flatMap(({ label, target }) => [label, target]),
    ...targets.map(({ path }) => path),
    ...majorCards.map(({ dependency }) => dependency),
  ]
  if (
    Number(topology[1]) !== expectedOperations ||
    Number(topology[2]) !== targets.length ||
    membership.operations !== expectedOperations ||
    membership.occurrences < 1 ||
    membership.occurrences > membership.operations ||
    membership.owners < 1 ||
    membership.targets < 1 ||
    sum(owners.map(({ updates }) => updates)) !== expectedOperations ||
    sum(targets.map(({ updates }) => updates)) !== expectedOperations ||
    Number(receipt?.[1]) !== expectedOperations ||
    Number(receipt?.[2]) !== targets.length ||
    !allNonEmpty(allFields) ||
    !allDistinct(owners.map(({ id }) => id)) ||
    !allDistinct(owners.map(({ label }) => label)) ||
    !allDistinct(shared.dependencies.map(({ id }) => id)) ||
    !allDistinct(shared.dependencies.map(({ name }) => name)) ||
    !allDistinct(shared.occurrences.map((occurrence) => JSON.stringify(occurrence))) ||
    !allDistinct(operations.operationIds) ||
    !allDistinct(targets.map(({ path }) => path)) ||
    new Set(majorCards.map(({ dependency }) => dependency)).size !== majorCards.length ||
    !sameCountMap(ownerTargets, reviewedTargets) ||
    !sameCountMap(ownerGroups, operationGroups) ||
    !sameCountMap(expectedSharedDependencies, sharedDependencies) ||
    !sameCountMap(expectedSharedPairs, sharedPairs) ||
    !sameCountMap(ownerSeverities, operationSeverities) ||
    !isSubset(
      shared.occurrences.map(({ owner }) => owner),
      owners.map(({ label }) => label),
    ) ||
    !sameCountMap(riskMajorDependencies, operationMajorDependencies) ||
    !isSubset(
      shared.dependencies.map(({ name }) => name),
      operations.dependencies,
    )
  ) {
    throw new Error('Live Visual+ long membership is incomplete')
  }
  return {
    columns,
    argv,
    exitCode: result.exitCode,
    signal: result.signal,
    finalCursorVisible: result.finalCursorVisible,
    controls: result.controls,
    rawControl: classifyRawTerminalTransport(result.rawTerminal),
    membership,
    finalScreen: screen,
  }
}

export function pathIdentity(stats) {
  return {
    device: String(stats.dev),
    inode: String(stats.ino),
    mode: stats.mode,
    links: stats.nlink,
    bytes: stats.size,
  }
}

function sameFileCore(left, right) {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.mode === right.mode &&
    left.bytes === right.bytes
  )
}

function sameIdentity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function parseLedgerRows(lines) {
  const rows = []
  let owner = ''
  let file = ''
  let source = ''
  let lastRow
  let paragraphStart = 0
  let rowSection = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === '') {
      paragraphStart = index + 1
      lastRow = undefined
      rowSection = false
      continue
    }
    if (/^  (?:dependencies|devDependencies|optionalDependencies|peerDependencies|catalog)$/u.test(line)) {
      const ownerLines = lines.slice(paragraphStart, index).filter((value) => value !== '')
      if (ownerLines.length > 0) {
        const context = parseLedgerOwner(ownerLines.join(''))
        owner = context.owner
        file = context.file
      }
      source = line.slice(2)
      lastRow = undefined
      paragraphStart = index + 1
      rowSection = false
      continue
    }
    if (isLedgerHeader(line)) {
      if (owner === '' || file === '' || source === '') {
        throw new Error('Live Visual+ ledger context is incomplete')
      }
      rowSection = true
      continue
    }
    if (!rowSection) continue
    const row = parseLedgerRow(line)
    if (row) {
      lastRow = { context: [], file, owner, source, ...row }
      rows.push(lastRow)
    } else if (lastRow && line.startsWith('  ')) {
      lastRow.context.push(line.trim())
    }
  }
  return rows
}

function semanticLedgerRowKey(row) {
  return JSON.stringify([
    row.owner,
    row.file,
    row.source,
    row.dependency,
    row.current,
    row.target,
    row.severity,
    row.context,
  ])
}

function hasCompleteCatalogContext(row) {
  if (row.source !== 'catalog') return true
  const expected = `catalog ${row.owner}: ${row.file}`
  const evidence = parseTypedLedgerEvidence(row)
  const catalogs = evidence?.filter((value) => value.startsWith('catalog ')) ?? []
  return catalogs.length === 1 && catalogs[0] === expected
}

function parseTypedLedgerEvidence(row) {
  const evidence = [...row.dependency.matchAll(/\[([^\]\n]+)\]/gu)].map((match) => match[1])
  for (const fragment of row.context) {
    if (/^(?:catalog|compat) /u.test(fragment)) {
      evidence.push(fragment)
    } else if (evidence.length > 0) {
      evidence[evidence.length - 1] += ` ${fragment}`
    } else {
      return undefined
    }
  }
  return evidence
}

function parseLedgerOwner(value) {
  const unicode = value.lastIndexOf(' · ')
  const ascii = value.lastIndexOf(' - ')
  const separatorIndex = Math.max(unicode, ascii)
  if (separatorIndex < 1) throw new Error('Live Visual+ ledger owner is incomplete')
  const owner = value.slice(0, separatorIndex)
  const file = value.slice(separatorIndex + 3)
  if (owner === '' || file === '') throw new Error('Live Visual+ ledger owner is incomplete')
  return { file, owner }
}

function isLedgerHeader(line) {
  return /^dependency\s{2,}current\s+(?:(?:→|->)\s+)?target\s{2,}severity\s{2,}age$/u.test(
    line,
  )
}

function parseLedgerRow(line) {
  const medium = /^(.+?)\s{2,}(\S+)\s+(?:→|->)\s+(\S+)\s{2,}(Major|Minor|Patch)\s{2,}(\S+)$/u.exec(
    line,
  )
  const wide = /^(.+?)\s{2,}(\S+)\s{2,}(\S+)\s{2,}(Major|Minor|Patch)\s{2,}(\S+)$/u.exec(
    line,
  )
  const row = medium ?? wide
  if (!row) return undefined
  return {
    dependency: row[1].trim(),
    current: row[2],
    target: row[3],
    severity: row[4],
    age: row[5],
  }
}

function exactSection(screen, start, end) {
  const startToken = `${start}\n`
  const endToken = `${end}\n`
  const startIndex = screen.indexOf(startToken)
  const endIndex = screen.indexOf(endToken, startIndex + startToken.length)
  if (startIndex < 0 || endIndex < 0) throw new Error('Live Visual+ long sections are incomplete')
  return screen.slice(startIndex + startToken.length, endIndex)
}

function exactSectionLine(screen, pattern) {
  const match = screen.split('\n').find((line) => pattern.test(line))?.match(pattern)
  if (!match) throw new Error('Live Visual+ long topology is incomplete')
  return match
}

function parseMajorMembership(input) {
  const lines = input.split('\n')
  const starts = fieldStarts(lines, (line) => line === 'Major card')
  if (starts.length === 0) {
    if (lines.filter((line) => line === 'No major updates').length === 1) return []
    throw new Error('Live Visual+ major membership is incomplete')
  }
  return starts.map((start, position) => {
    const block = lines.slice(start, starts[position + 1] ?? lines.length)
    const dependencyIndex = block.findIndex((line) => line.startsWith('Dependency '))
    const transitionIndex = block.findIndex(
      (line, index) => index > dependencyIndex && line.startsWith('Transition '),
    )
    const occurrenceLines = block.flatMap((line) => {
      const match = /^Occurrences ([0-9]+)$/u.exec(line)
      return match ? [Number(match[1])] : []
    })
    if (
      dependencyIndex !== 1 ||
      transitionIndex <= dependencyIndex ||
      occurrenceLines.length !== 1 ||
      !Number.isSafeInteger(occurrenceLines[0]) ||
      occurrenceLines[0] < 1
    ) {
      throw new Error('Live Visual+ major membership is incomplete')
    }
    return {
      dependency: joinField(block, dependencyIndex, transitionIndex, 'Dependency '),
      occurrences: occurrenceLines[0],
    }
  })
}

function parseOwnerMembership(input) {
  const lines = input.split('\n')
  const starts = fieldStarts(lines, (line) => line.startsWith('Owner ID '))
  return starts.map((start, position) => {
    const block = lines.slice(start, starts[position + 1] ?? lines.length)
    const ownerIndex = block.findIndex(
      (line, index) => index > 0 && line.startsWith('Owner ') && !line.startsWith('Owner ID '),
    )
    const targetIndex = block.findIndex((line, index) => index > ownerIndex && line.startsWith('Target '))
    const updatesIndex = block.findIndex(
      (line, index) => index > targetIndex && stripMapConnector(line).startsWith('Updates '),
    )
    if (ownerIndex < 1 || targetIndex <= ownerIndex || updatesIndex <= targetIndex) {
      throw new Error('Live Visual+ owner membership is incomplete')
    }
    const id = joinField(block, 0, ownerIndex, 'Owner ID ')
    const label = joinField(block, ownerIndex, targetIndex, 'Owner ')
    const target = joinField(block, targetIndex, updatesIndex, 'Target ')
    const distribution = [
      stripMapConnector(block[updatesIndex]),
      ...block.slice(updatesIndex + 1),
    ].join('')
    const match = /^Updates ([0-9]+) (?:·|\|) Major ([0-9]+) (?:·|\|) Minor ([0-9]+) (?:·|\|) Patch ([0-9]+)$/u.exec(
      distribution,
    )
    const values = match?.slice(1).map(Number) ?? []
    if (
      values.length !== 4 ||
      values.some((value) => !Number.isSafeInteger(value)) ||
      values[0] !== sum(values.slice(1))
    ) {
      throw new Error('Live Visual+ owner distribution is incomplete')
    }
    return {
      distribution: { major: values[1], minor: values[2], patch: values[3] },
      id,
      label,
      target,
      updates: values[0],
    }
  })
}

function parseSharedMembership(input) {
  const lines = input.split('\n')
  const starts = fieldStarts(lines, (line) => line.startsWith('Dependency ID '))
  const dependencies = []
  const occurrences = []
  for (const [position, start] of starts.entries()) {
    const block = lines.slice(start, starts[position + 1] ?? lines.length)
    const dependencyIndex = block.findIndex(
      (line, index) =>
        index > 0 && line.startsWith('Dependency ') && !line.startsWith('Dependency ID '),
    )
    const occurrenceStarts = fieldStarts(block, (line) => line === 'Occurrence').filter(
      (index) => index > dependencyIndex,
    )
    if (dependencyIndex < 1 || occurrenceStarts.length < 2) {
      throw new Error('Live Visual+ shared dependency membership is incomplete')
    }
    const dependency = {
      id: joinField(block, 0, dependencyIndex, 'Dependency ID '),
      name: joinField(block, dependencyIndex, occurrenceStarts[0], 'Dependency '),
    }
    dependencies.push(dependency)
    for (const [occurrencePosition, occurrenceStart] of occurrenceStarts.entries()) {
      const occurrenceBlock = block.slice(
        occurrenceStart + 1,
        occurrenceStarts[occurrencePosition + 1] ?? block.length,
      )
      const ownerIndex = occurrenceBlock.findIndex((line) =>
        stripMapConnector(line).startsWith('Owner '),
      )
      const sourceIndex = occurrenceBlock.findIndex(
        (line, index) => index > ownerIndex && stripMapConnector(line).startsWith('Source '),
      )
      const pathIndex = occurrenceBlock.findIndex(
        (line, index) => index > sourceIndex && stripMapConnector(line).startsWith('Path '),
      )
      if (ownerIndex !== 0 || sourceIndex <= ownerIndex || pathIndex <= sourceIndex) {
        throw new Error('Live Visual+ shared occurrence membership is incomplete')
      }
      occurrences.push({
        dependency: dependency.name,
        owner: joinMapField(occurrenceBlock, ownerIndex, sourceIndex, 'Owner '),
        source: joinMapField(occurrenceBlock, sourceIndex, pathIndex, 'Source '),
        path: joinMapField(occurrenceBlock, pathIndex, occurrenceBlock.length, 'Path '),
      })
    }
  }
  return { dependencies, occurrences }
}

function fieldStarts(lines, predicate) {
  return lines.flatMap((line, index) => (predicate(line) ? [index] : []))
}

function joinField(lines, start, end, prefix) {
  return [lines[start].slice(prefix.length), ...lines.slice(start + 1, end)].join('')
}

function joinMapField(lines, start, end, prefix) {
  const first = stripMapConnector(lines[start])
  return [first.slice(prefix.length), ...lines.slice(start + 1, end)].join('')
}

function stripMapConnector(line) {
  return line.replace(/^(?:[├└│-] )/u, '')
}

function reviewOperationFields(review) {
  const lines = review.split('\n')
  const starts = operationStarts(lines)
  const groupRanges = parseOperationGroups(lines)
  const groups = groupRanges.map(({ label, target, updates }) => ({ label, target, updates }))
  const groupedOperations = sum(groups.map(({ updates }) => updates))
  if (groupedOperations !== starts.length) {
    throw new Error('Live Visual+ operation owner membership is incomplete')
  }
  const operationIds = []
  const dependencies = []
  const records = []
  for (const [position, start] of starts.entries()) {
    const block = lines.slice(start, starts[position + 1] ?? lines.length)
    let id
    let dependency
    if (block[0]?.includes('| Dependency ')) {
      const idParts = []
      const dependencyParts = []
      for (const line of block.filter((candidate) => candidate.startsWith('Operation ID '))) {
        const match = /^Operation ID (.*?)\s+\| Dependency(?: (.*?))?(?:\s+\| Current|$)/u.exec(
          line,
        )
        if (!match) throw new Error('Live Visual+ operation columns are malformed')
        idParts.push(match[1].trim())
        dependencyParts.push((match[2] ?? '').trim())
      }
      id = idParts.join('')
      dependency = dependencyParts.join('')
    } else {
      const dependencyIndex = block.findIndex((line) => line.startsWith('Dependency '))
      if (dependencyIndex < 1) throw new Error('Live Visual+ operation fields are incomplete')
      id = [block[0].slice('Operation ID '.length), ...block.slice(1, dependencyIndex)].join('')
      dependency = block[dependencyIndex].slice('Dependency '.length)
    }
    const diffLines = block.flatMap((line) => {
      const match = /^Diff (major|minor|patch)(?:\s+\||$)/u.exec(line)
      return match ? [match[1]] : []
    })
    const group = groupRanges.find(({ end, start: groupStart }) => start > groupStart && start < end)
    if (diffLines.length !== 1 || group === undefined) {
      throw new Error('Live Visual+ operation relationship fields are incomplete')
    }
    operationIds.push(id)
    dependencies.push(dependency)
    records.push({
      dependency,
      diff: diffLines[0],
      id,
      owner: group.label,
      target: group.target,
    })
  }
  return { dependencies, groups, operationIds, records }
}

function operationStarts(lines) {
  return lines.flatMap((line, index) =>
    line.startsWith('Operation ID ') && !lines[index - 1]?.startsWith('Operation ID ')
      ? [index]
      : [],
  )
}

function parseOperationGroups(lines) {
  const starts = fieldStarts(lines, (line) => line.startsWith('Owner '))
  return starts.map((start, position) => {
    const end = starts[position + 1] ?? lines.length
    const block = lines.slice(start, end)
    const firstOperation = operationStarts(block)[0]
    if (firstOperation === undefined || firstOperation < 1) {
      throw new Error('Live Visual+ operation owner membership is incomplete')
    }
    const heading = block.slice(0, firstOperation).join('')
    const match = /^Owner (.*?) (?:·|\|) (.+)$/u.exec(heading)
    if (!match) throw new Error('Live Visual+ operation owner membership is malformed')
    return {
      end,
      label: match[1],
      start,
      target: match[2],
      updates: operationStarts(block).length,
    }
  })
}

function parseTargetMembership(input) {
  return input.split('\n').flatMap((line) => {
    const match = /^Target (.*?) (?:·|\|) ([0-9]+) updates?(?: (?:·|\|) .+)?$/u.exec(line)
    if (!match || !Number.isSafeInteger(Number(match[2]))) return []
    return [{ path: match[1], updates: Number(match[2]) }]
  })
}

function allDistinct(values) {
  return values.length > 0 && new Set(values).size === values.length
}

function allNonEmpty(values) {
  return values.every((value) => typeof value === 'string' && value.length > 0)
}

function aggregateCounts(values, key, count = () => 1) {
  const counts = new Map()
  for (const value of values) {
    const member = key(value)
    counts.set(member, (counts.get(member) ?? 0) + count(value))
  }
  return counts
}

function sameCountMap(left, right) {
  return (
    left.size === right.size && [...left].every(([key, value]) => right.get(key) === value)
  )
}

function isSubset(values, universe) {
  const members = new Set(universe)
  return values.every((value) => members.has(value))
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0)
}

function countExactLines(screen, prefix) {
  return screen
    .split('\n')
    .filter((line) => (prefix.endsWith(' ') ? line.startsWith(prefix) : line === prefix)).length
}

function requireUniqueOrderedSections(screen, headings) {
  const lines = screen.split('\n')
  const positions = headings.map((heading) =>
    lines.flatMap((line, index) => (line === heading ? [index] : [])),
  )
  if (
    positions.some((matches) => matches.length !== 1) ||
    positions.some((matches, index) => index > 0 && matches[0] <= positions[index - 1][0])
  ) {
    throw new Error('Live Visual+ long section order is incomplete')
  }
}

function requireSuccessfulPty(result, columns) {
  if (
    !isRecord(result) ||
    result.exitCode !== 0 ||
    result.signal !== null ||
    result.finalCursorVisible !== true ||
    result.evidence?.columns !== columns ||
    typeof result.transcript !== 'string' ||
    !result.transcript.endsWith('Exit 0\n')
  ) {
    throw new Error('Live Visual+ PTY run is incomplete')
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
