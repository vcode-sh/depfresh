import { formatMs, sanitizeTerminalText } from '../../../../utils/format'
import type { CheckRunResultTotals } from '../../run-model'
import type { VisualPlusSectionInput } from '../input'
import { pluralVisualPlus, visualPlusSectionLines, visualPlusSeparator } from '../theme'

export function isStrictVisualPlusWriteSuccess(input: VisualPlusSectionInput): boolean {
  const { snapshot, writeReceipt } = input
  if (!(snapshot.write && snapshot.exitCode === 0 && writeReceipt)) return false
  if (
    snapshot.results.operations.length !== snapshot.counts.operations ||
    snapshot.results.targets.length !== snapshot.counts.targets ||
    snapshot.results.operations.some(
      (result) =>
        result.outcome !== 'applied' || result.blocked || result.notAttempted || result.unknown,
    ) ||
    snapshot.results.targets.some(
      (result) =>
        result.outcome !== 'applied' || result.blocked || result.notAttempted || result.unknown,
    )
  ) {
    return false
  }
  if (
    !(
      strictAppliedTotals(snapshot.results.totals, snapshot.counts.operations) &&
      strictAppliedTotals(snapshot.results.targetTotals, snapshot.counts.targets)
    ) ||
    phaseStatus(input, 'observe') !== 'passed' ||
    snapshot.recovery.executed ||
    snapshot.recovery.status !== 'not-needed'
  ) {
    return false
  }
  const canonical = writeReceipt.canonical
  return (
    canonical.verdict === 'complete' &&
    !canonical.noFilesChanged &&
    canonical.groups.length === 0 &&
    canonical.operations.planned === snapshot.counts.operations &&
    canonical.operations.applied === snapshot.counts.operations &&
    canonical.operations.skipped === 0 &&
    canonical.operations.conflicted === 0 &&
    canonical.operations.reverted === 0 &&
    canonical.operations.failed === 0 &&
    canonical.operations.unknown === 0 &&
    canonical.files.planned === snapshot.counts.targets &&
    canonical.files.applied === snapshot.counts.targets &&
    canonical.files.skipped === 0 &&
    canonical.files.blocked === 0 &&
    canonical.files.conflicted === 0 &&
    canonical.files.reverted === 0 &&
    canonical.files.failed === 0 &&
    canonical.files.unknown === 0
  )
}

export function renderVisualPlusReceipt(input: VisualPlusSectionInput): readonly string[] {
  const { snapshot } = input
  const separator = visualPlusSeparator(input.capabilities)
  if (snapshot.exitCode === null) return visualPlusSectionLines(input, ['Pending'])

  if (
    input.run.detailLevel === 'compact' &&
    snapshot.exitCode === 0 &&
    snapshot.counts.updates === 0 &&
    snapshot.counts.operations === 0 &&
    snapshot.counts.targets === 0
  ) {
    const message =
      snapshot.counts.unresolved > 0
        ? `Check incomplete: ${snapshot.counts.unresolved} ${snapshot.counts.unresolved === 1 ? 'dependency' : 'dependencies'} could not be checked.`
        : snapshot.counts.packages === 0
          ? 'No packages found.'
          : 'No updates found.'
    return visualPlusSectionLines(input, [message])
  }

  if (input.run.detailLevel === 'compact' && !snapshot.write && snapshot.exitCode === 0) {
    return visualPlusSectionLines(input, [
      `Review complete${separator}${pluralVisualPlus(snapshot.counts.operations, 'update')} across ${pluralVisualPlus(snapshot.counts.targets, 'file')}${separator}write not attempted`,
      'Exit 0',
    ])
  }

  if (input.run.detailLevel === 'compact' && isStrictVisualPlusWriteSuccess(input)) {
    return visualPlusSectionLines(input, [
      `Complete${separator}${pluralVisualPlus(snapshot.counts.operations, 'update')} applied across ${pluralVisualPlus(snapshot.counts.targets, 'file')}`,
      `All ${snapshot.counts.targets} files observed at the requested values${separator}recovery not needed${separator}${formatMs(snapshot.elapsedMs ?? 0)}`,
      'Exit 0',
    ])
  }

  if (!snapshot.write) {
    const headline =
      snapshot.exitCode === 0
        ? 'Review complete'
        : snapshot.exitCode === 1
          ? `Review complete${separator}updates available`
          : 'Review incomplete'
    const diagnostics = snapshot.exitCode === 2 ? reviewDiagnosticLines(input) : []
    const action =
      snapshot.exitCode === 2
        ? ['Next: review every diagnostic and correct each reported cause before rerunning.']
        : []
    return visualPlusSectionLines(input, [
      headline,
      reviewSummary(input),
      ...diagnostics,
      ...action,
      `Exit ${snapshot.exitCode}`,
    ])
  }

  if (snapshot.counts.operations === 0 && snapshot.counts.targets === 0) {
    const headline =
      snapshot.exitCode === 0
        ? `Complete${separator}no selected updates`
        : `Write incomplete${separator}no selected updates`
    return finalLines(
      input,
      headline,
      totalsLine(snapshot.results.totals, snapshot.results.targetTotals),
      snapshot.exitCode,
      snapshot.exitCode === 2
        ? 'Next: inspect all reported diagnostics; do not rerun until the cause is understood.'
        : undefined,
    )
  }

  const evidence = input.writeReceipt
  if (!evidence) {
    return finalLines(
      input,
      `Result unknown${separator}receipt evidence unavailable`,
      totalsLine(snapshot.results.totals, snapshot.results.targetTotals),
      snapshot.exitCode,
      'Next: inspect all reported diagnostics and repository state; do not rerun until every final state is known.',
    )
  }

  const recovery = snapshot.recovery
  if (recovery.executed && recovery.status === 'completed') {
    return retainedEvidenceLines(input, 'Recovered')
  }
  if (recovery.status === 'partial') return retainedEvidenceLines(input, 'Recovery incomplete')
  if (recovery.status === 'unknown') return retainedEvidenceLines(input, 'Recovery unknown')

  const canonical = evidence.canonical
  if (canonical.verdict === 'safety-block' && canonical.noFilesChanged) {
    const reasons = safetyBlockReasons(input)
    return visualPlusSectionLines(input, [
      `Safety block${separator}no files were changed`,
      ...(input.run.detailLevel === 'compact'
        ? []
        : [totalsLine(snapshot.results.totals, snapshot.results.targetTotals)]),
      ...reasons,
      safetyBlockAction(input),
      `Exit ${snapshot.exitCode}`,
    ])
  }
  if (canonical.verdict === 'partial') {
    return retainedEvidenceLines(input, 'Partial')
  }
  if (canonical.verdict === 'failed') {
    return finalLines(
      input,
      'Failed',
      totalsLine(snapshot.results.totals, snapshot.results.targetTotals),
      snapshot.exitCode,
      'Next: review all reported errors and inspect every failed target; rerun only after every known cause is corrected.',
    )
  }
  if (canonical.verdict === 'unknown') {
    return finalLines(
      input,
      'Unknown',
      totalsLine(snapshot.results.totals, snapshot.results.targetTotals),
      snapshot.exitCode,
      'Next: review all reported errors and inspect every target; do not rerun until every final state is known.',
    )
  }

  const strictComplete =
    snapshot.results.totals.applied === snapshot.counts.operations &&
    snapshot.results.targetTotals.applied === snapshot.counts.targets &&
    phaseStatus(input, 'observe') === 'passed' &&
    recovery.status === 'not-needed' &&
    snapshot.exitCode === 0
  if (strictComplete) {
    return visualPlusSectionLines(input, [
      `Complete${separator}${pluralVisualPlus(snapshot.counts.operations, 'update')} applied across ${pluralVisualPlus(snapshot.counts.targets, 'file')}`,
      totalsLine(snapshot.results.totals, snapshot.results.targetTotals),
      `All ${snapshot.counts.targets} target files were observed at the requested values. Recovery was not needed. ${formatMs(snapshot.elapsedMs ?? 0)}.`,
      'Exit 0',
    ])
  }
  if (
    snapshot.exitCode === 0 &&
    snapshot.results.totals.skipped > 0 &&
    onlyAppliedOrSkipped(snapshot.results.totals)
  ) {
    return finalLines(
      input,
      `Complete${separator}${snapshot.results.totals.applied} applied, ${snapshot.results.totals.skipped} skipped across ${pluralVisualPlus(snapshot.counts.targets, 'file')}`,
      totalsLine(snapshot.results.totals, snapshot.results.targetTotals),
      snapshot.exitCode,
    )
  }
  return finalLines(
    input,
    `Write complete${separator}command incomplete`,
    totalsLine(snapshot.results.totals, snapshot.results.targetTotals),
    snapshot.exitCode,
    snapshot.exitCode === 2
      ? 'Next: review all reported errors before running another write.'
      : undefined,
  )
}

function reviewDiagnosticLines(input: VisualPlusSectionInput): readonly string[] {
  const separator = visualPlusSeparator(input.capabilities)
  return input.snapshot.diagnostics.map((diagnostic) => {
    const path =
      diagnostic.path === undefined
        ? ''
        : `${separator}path ${sanitizeTerminalText(diagnostic.path)}`
    const detail =
      diagnostic.detail === undefined
        ? ''
        : `${separator}detail ${sanitizeTerminalText(diagnostic.detail)}`
    return `Diagnostic ${sanitizeTerminalText(diagnostic.code)}${path}${detail}`
  })
}

function finalLines(
  input: VisualPlusSectionInput,
  headline: string,
  summary: string,
  exitCode: 0 | 1 | 2,
  action?: string,
): readonly string[] {
  return visualPlusSectionLines(input, [
    headline,
    summary,
    ...(action === undefined ? [] : [action]),
    `Exit ${exitCode}`,
  ])
}

function retainedEvidenceLines(input: VisualPlusSectionInput, headline: string): readonly string[] {
  const { recovery, exitCode } = input.snapshot
  const appliedOperationIds = new Set(
    input.snapshot.results.operations
      .filter((operation) => operation.outcome === 'applied')
      .map((operation) => operation.operationId),
  )
  const appliedPaths = input.snapshot.targets
    .filter((target) =>
      target.operationIds.some((operationId) => appliedOperationIds.has(operationId)),
    )
    .map((target) => sanitizeTerminalText(target.path))
  const applied = `Applied: ${appliedPaths.length > 0 ? appliedPaths.join(', ') : 'none'}`
  const restored =
    recovery.restoredPaths.length > 0
      ? `Restored: ${recovery.restoredPaths.map(sanitizeTerminalText).join(', ')}`
      : 'Restored: none'
  const unrecovered =
    recovery.unrecoveredPaths.length > 0
      ? `Unrecovered: ${recovery.unrecoveredPaths.map(sanitizeTerminalText).join(', ')}`
      : 'Unrecovered: none'
  const journal = recovery.journalId
    ? [
        `Journal: ${input.run.detailLevel === 'compact' ? 'retained' : sanitizeTerminalText(recovery.journalId)}`,
      ]
    : []
  const externalEffects = recovery.externalEffects?.length
    ? [`External effects: ${recovery.externalEffects.map(sanitizeTerminalText).join(', ')}`]
    : []
  const action =
    recovery.status === 'completed'
      ? 'Next: review all reported errors and restored paths; rerun only after every cause is corrected.'
      : recovery.status === 'partial'
        ? 'Next: preserve retained evidence and reconcile every applied, restored, and unrecovered path and external effect before any retry.'
        : recovery.status === 'unknown'
          ? 'Next: preserve retained evidence and establish every named path and external effect; do not retry until every final state is known.'
          : 'Next: review all reported errors and inspect every applied or incomplete target; do not rerun until the repository state is understood.'
  return visualPlusSectionLines(input, [
    headline,
    totalsLine(input.snapshot.results.totals, input.snapshot.results.targetTotals),
    applied,
    restored,
    unrecovered,
    ...journal,
    ...externalEffects,
    action,
    `Exit ${exitCode}`,
  ])
}

function safetyBlockReasons(input: VisualPlusSectionInput): readonly string[] {
  const separator = visualPlusSeparator(input.capabilities)
  const groups = input.writeReceipt!.canonical.groups
  if (input.run.detailLevel === 'compact') {
    const explanations: Record<string, string> = {
      MERGE_CONFLICT: 'An unresolved merge conflict blocked the write.',
      TARGET_DIRTY: 'Existing changes blocked the write.',
      SOURCE_CHANGED: 'Source content changed since review.',
      EXPECTED_VALUE_MISMATCH: 'A dependency value changed since review.',
      VCS_UNAVAILABLE: 'Git state could not be confirmed.',
      AMBIGUOUS_OCCURRENCE: 'A dependency location is ambiguous.',
      UNSUPPORTED_WRITE_SOURCE: 'A selected source cannot be updated safely.',
    }
    const causes = [
      ...new Set(
        groups.map(
          (group) =>
            explanations[group.reason] ?? `Write blocked: ${sanitizeTerminalText(group.reason)}.`,
        ),
      ),
    ]
    const targets = [...new Set(groups.map((group) => sanitizeTerminalText(group.file)))]
    return [...causes, 'Selected files not updated:', ...targets.map((file) => `  ${file}`)]
  }
  return [
    ...new Set(
      groups.map((group) => {
        const diagnostic = group.diagnostic ? ` / ${sanitizeTerminalText(group.diagnostic)}` : ''
        return `${sanitizeTerminalText(group.file)}${separator}${sanitizeTerminalText(group.reason)}${diagnostic}`
      }),
    ),
  ]
}

function safetyBlockAction(input: VisualPlusSectionInput): string {
  const groups = input.writeReceipt!.canonical.groups
  if (
    groups.every((group) => ['SOURCE_CHANGED', 'EXPECTED_VALUE_MISMATCH'].includes(group.reason))
  ) {
    return 'Next: review the changed files, then rerun to resolve updates against their current contents.'
  }
  if (groups.every((group) => group.reason === 'MERGE_CONFLICT')) {
    return 'Next: resolve the merge conflict, then rerun to review the current dependency values.'
  }
  if (groups.every((group) => group.reason === 'TARGET_DIRTY')) {
    return 'Next: review and resolve the existing changes in these files before retrying.'
  }
  const onlyGitEvidence = groups.every((group) => group.reason === 'VCS_UNAVAILABLE')
  return onlyGitEvidence
    ? 'Next: review all reported errors and restore trustworthy Git evidence for every reported target before rerunning.'
    : 'Next: review all reported errors and correct every reported preflight blocker before rerunning.'
}

function reviewSummary(input: VisualPlusSectionInput): string {
  const { operations, targets } = input.snapshot.counts
  if (operations === 0) return 'No updates selected.'
  return `${pluralVisualPlus(operations, 'update')} reviewed across ${pluralVisualPlus(targets, 'target')}.`
}

function totalsLine(operations: CheckRunResultTotals, targets: CheckRunResultTotals): string {
  let line = `Applied ${operations.applied}  Blocked ${operations.blocked}  Not attempted ${operations.notAttempted}  Failed ${operations.failed}  Unknown ${operations.unknown}`
  if (operations.skipped > 0) line += `  Skipped ${operations.skipped}`
  if (operations.reverted > 0) line += `  Reverted ${operations.reverted}`
  if (targets.mixed > 0) line += `  Mixed targets ${targets.mixed}`
  return line
}

function phaseStatus(input: VisualPlusSectionInput, phase: 'observe'): string | undefined {
  return input.snapshot.phases.find((item) => item.name === phase)?.status
}

function onlyAppliedOrSkipped(totals: CheckRunResultTotals): boolean {
  return (
    totals.blocked === 0 && totals.failed === 0 && totals.reverted === 0 && totals.unknown === 0
  )
}

function strictAppliedTotals(totals: CheckRunResultTotals, count: number): boolean {
  return (
    totals.applied === count &&
    totals.skipped === 0 &&
    totals.mixed === 0 &&
    totals.blocked === 0 &&
    totals.notAttempted === 0 &&
    totals.failed === 0 &&
    totals.reverted === 0 &&
    totals.unknown === 0
  )
}
