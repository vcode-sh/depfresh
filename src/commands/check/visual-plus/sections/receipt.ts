import { formatMs, sanitizeTerminalText } from '../../../../utils/format'
import type { CheckRunResultTotals } from '../../run-model'
import type { VisualPlusSectionInput } from '../input'
import { pluralVisualPlus, visualPlusSectionLines, visualPlusSeparator } from '../theme'

export function renderVisualPlusReceipt(input: VisualPlusSectionInput): readonly string[] {
  const { snapshot } = input
  const separator = visualPlusSeparator(input.capabilities)
  if (snapshot.exitCode === null) return visualPlusSectionLines(input, ['Pending'])

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
      totalsLine(snapshot.results.totals, snapshot.results.targetTotals),
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
  const journal = recovery.journalId ? [`Journal: ${sanitizeTerminalText(recovery.journalId)}`] : []
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
  const lines = groups.map((group) => {
    if (group.reason === 'VCS_UNAVAILABLE') {
      const path = sanitizeTerminalText(group.file)
      return `Preflight could not confirm Git state for ${path}.`
    }
    const diagnostic = group.diagnostic ? ` / ${sanitizeTerminalText(group.diagnostic)}` : ''
    return `${sanitizeTerminalText(group.file)}${separator}${sanitizeTerminalText(group.reason)}${diagnostic}`
  })
  return [...new Set(lines)]
}

function safetyBlockAction(input: VisualPlusSectionInput): string {
  const onlyGitEvidence = input.writeReceipt!.canonical.groups.every(
    (group) => group.reason === 'VCS_UNAVAILABLE',
  )
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
