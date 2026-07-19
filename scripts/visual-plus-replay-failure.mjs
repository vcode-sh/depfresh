import { closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs'

export const MAX_VISUAL_PLUS_REPORT_BYTES = 256 * 1024

const TRUSTED_FAILURE_CATEGORIES = new Map([
  [
    'Visual+ PTY adapter allocates one PTY for all three child streams at the requested width',
    'pty-adapter',
  ],
  [
    'Visual+ PTY adapter fails closed on bounded-output overflow and timeout',
    'pty-bounds',
  ],
  [
    'Visual+ PTY adapter keeps one owned ONLCR transform and transports explicit CRLF unchanged',
    'pty-transport',
  ],
  [
    'Visual+ PTY adapter removes a uniquely identified descendant after overflow',
    'pty-process-cleanup',
  ],
  [
    'Visual+ PTY adapter removes a uniquely identified descendant after timeout',
    'pty-process-cleanup',
  ],
  [
    'Visual+ PTY adapter surfaces cleanup fault observation-ambiguity while preserving the timeout primary error',
    'pty-process-cleanup',
  ],
  [
    'Visual+ PTY adapter surfaces cleanup fault signaling-failure while preserving the timeout primary error',
    'pty-process-cleanup',
  ],
  [
    'Visual+ PTY adapter surfaces cleanup fault survivor while preserving the timeout primary error',
    'pty-process-cleanup',
  ],
  [
    'Visual+ built CLI removes a stdio-independent descendant after a bounded direct-pipe abort',
    'pty-process-cleanup',
  ],
  [
    'Visual+ PTY adapter fails closed on exact wrapper fault start-evidence-failure',
    'pty-evidence',
  ],
  [
    'Visual+ PTY adapter fails closed on exact wrapper fault malformed-start',
    'pty-evidence',
  ],
  [
    'Visual+ PTY adapter fails closed on exact wrapper fault malformed-completion',
    'pty-evidence',
  ],
  [
    'Visual+ PTY adapter retains exact signal completion separately from outer adapter status',
    'pty-signal',
  ],
  ['Visual+ built CLI executes the selected CLI artifact', 'artifact-identity'],
  [
    'Visual+ built CLI renders exact success and safety journeys in a 40-column PTY',
    'product-journey',
  ],
  [
    'Visual+ built CLI renders exact success and safety journeys in a 60-column PTY',
    'product-journey',
  ],
  [
    'Visual+ built CLI renders exact success and safety journeys in a 80-column PTY',
    'product-journey',
  ],
  [
    'Visual+ built CLI renders exact success and safety journeys in a 118-column PTY',
    'product-journey',
  ],
  [
    'Visual+ built CLI uses durable direct and slow-pipe fallbacks without losing read-only semantic output',
    'fallback-direct',
  ],
  [
    'Visual+ built CLI uses durable capable and no-color PTY fallbacks without losing read-only semantic output',
    'fallback-capable-pty',
  ],
  [
    'Visual+ built CLI CI constrained PTY fallback executes with exact PTY evidence and exit 0',
    'fallback-ci-execution',
  ],
  [
    'Visual+ built CLI CI constrained PTY fallback preserves read-only semantic output',
    'fallback-ci-semantics',
  ],
  [
    'Visual+ built CLI CI constrained PTY fallback classifies raw terminal transport without exposing capture data',
    'fallback-ci-transport',
  ],
  [
    'Visual+ built CLI CI constrained PTY fallback emits only constrained terminal controls',
    'fallback-ci-controls',
  ],
  [
    'Visual+ built CLI CI constrained PTY fallback emits each active transition once',
    'fallback-ci-transitions',
  ],
  [
    'Visual+ built CLI CI constrained PTY fallback leaves fixture bytes and Git unchanged',
    'fallback-ci-read-only',
  ],
  [
    'Visual+ built CLI TERM=dumb constrained PTY fallback executes with exact PTY evidence and preserves semantic output',
    'fallback-dumb-journey',
  ],
  [
    'Visual+ built CLI TERM=dumb constrained PTY fallback contains no duplicate CRCRLF transport',
    'fallback-dumb-transport',
  ],
  [
    'Visual+ built CLI TERM=dumb constrained PTY fallback contains no normalized lone carriage return',
    'fallback-dumb-lone-cr',
  ],
  [
    'Visual+ built CLI TERM=dumb constrained PTY fallback preserves remaining controls transitions and read-only state',
    'fallback-dumb-rest',
  ],
  [
    'Visual+ built CLI sanitizes hostile owner text before it can become terminal protocol',
    'terminal-sanitization',
  ],
])

export function visualPlusReplayFailureMessage(reportPath) {
  const report = readVisualPlusReplayReport(reportPath)
  const classification = classifyVisualPlusReplayFailure(report)
  return `Installed Visual+ replay failed (classification: ${classification})`
}

export function readVisualPlusReplayReport(reportPath) {
  let expected
  try {
    expected = lstatSync(reportPath)
  } catch {
    return undefined
  }
  if (
    expected.isSymbolicLink() ||
    !expected.isFile() ||
    !Number.isSafeInteger(expected.size) ||
    expected.size < 1 ||
    expected.size > MAX_VISUAL_PLUS_REPORT_BYTES
  ) {
    return undefined
  }

  let descriptor
  try {
    descriptor = openSync(reportPath, 'r')
    const opened = fstatSync(descriptor)
    if (
      !opened.isFile() ||
      opened.dev !== expected.dev ||
      opened.ino !== expected.ino ||
      opened.size !== expected.size
    ) {
      return undefined
    }
    const bytes = Buffer.alloc(opened.size)
    let offset = 0
    while (offset < bytes.length) {
      const read = readSync(descriptor, bytes, offset, bytes.length - offset, offset)
      if (read === 0) return undefined
      offset += read
    }
    if (readSync(descriptor, Buffer.alloc(1), 0, 1, bytes.length) !== 0) return undefined
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    return undefined
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {}
    }
  }
}

export function classifyVisualPlusReplayFailure(report) {
  if (!isRecord(report) || !Number.isSafeInteger(report.numFailedTests)) return 'unclassified'
  if (report.numFailedTests < 1 || !Array.isArray(report.testResults)) return 'unclassified'

  const categories = new Set()
  let failedTests = 0
  for (const testResult of report.testResults) {
    if (!isRecord(testResult) || !Array.isArray(testResult.assertionResults)) {
      return 'unclassified'
    }
    for (const assertion of testResult.assertionResults) {
      if (!isRecord(assertion)) return 'unclassified'
      if (assertion.status !== 'failed') continue
      failedTests += 1
      if (typeof assertion.fullName !== 'string') return 'unclassified'
      const category = TRUSTED_FAILURE_CATEGORIES.get(assertion.fullName)
      if (category === undefined) return 'unclassified'
      categories.add(category)
    }
  }
  if (failedTests !== report.numFailedTests || categories.size === 0) return 'unclassified'
  if (categories.size > 1) return 'multiple-known'
  return categories.values().next().value ?? 'unclassified'
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
