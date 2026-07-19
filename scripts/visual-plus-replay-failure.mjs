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
    'Visual+ built CLI uses durable public fallbacks without losing read-only semantic output',
    'fallback',
  ],
  [
    'Visual+ built CLI sanitizes hostile owner text before it can become terminal protocol',
    'terminal-sanitization',
  ],
])

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
