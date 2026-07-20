import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

export const MAX_VISUAL_PLUS_REPORT_BYTES = 256 * 1024

export function isCompleteVisualPlusReplayReport(report, expected) {
  if (
    !isRecord(report) ||
    !isRecord(expected) ||
    !Number.isSafeInteger(expected.files) ||
    expected.files < 1 ||
    !Number.isSafeInteger(expected.suites) ||
    expected.suites < 1 ||
    !Number.isSafeInteger(expected.tests) ||
    expected.tests < 1
  ) {
    return false
  }

  if (
    report.numTotalTestSuites !== expected.suites ||
    report.numPassedTestSuites !== expected.suites ||
    report.numFailedTestSuites !== 0 ||
    report.numPendingTestSuites !== 0 ||
    report.numTotalTests !== expected.tests ||
    report.numPassedTests !== expected.tests ||
    report.numFailedTests !== 0 ||
    report.numPendingTests !== 0 ||
    report.numTodoTests !== 0 ||
    !Array.isArray(report.testResults) ||
    report.testResults.length !== expected.files
  ) {
    return false
  }

  let assertionCount = 0
  for (const testResult of report.testResults) {
    if (
      !isRecord(testResult) ||
      testResult.status !== 'passed' ||
      !Array.isArray(testResult.assertionResults)
    ) {
      return false
    }
    for (const assertion of testResult.assertionResults) {
      if (!isRecord(assertion) || assertion.status !== 'passed') return false
      assertionCount += 1
    }
  }
  return assertionCount === expected.tests
}

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
    'Visual+ built CLI renders hybrid success and exact safety journeys in a 40-column PTY by default',
    'visual-hierarchy',
  ],
  [
    'Visual+ built CLI renders hybrid success and exact safety journeys in a 60-column PTY by default',
    'visual-hierarchy',
  ],
  [
    'Visual+ built CLI renders hybrid success and exact safety journeys in a 80-column PTY by default',
    'visual-hierarchy',
  ],
  [
    'Visual+ built CLI renders hybrid success and exact safety journeys in a 118-column PTY by default',
    'visual-hierarchy',
  ],
  [
    'Visual+ built CLI renders hybrid success and exact safety journeys in a 175-column PTY by default',
    'visual-hierarchy',
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

export function writeVisualPlusReplayEvidence(options) {
  if (!isRecord(options)) throw new Error('Installed replay evidence options are invalid')
  const expected = options.expected
  if (!isCompleteVisualPlusReplayReport(options.report, expected)) {
    throw new Error('Installed replay evidence is incomplete')
  }
  const containmentRoot = requireCanonicalDirectory(options.containmentRoot, 'evidence root')
  const outputPath = requireContainedNewOutput(options.outputPath, containmentRoot)
  const tarballPath = requireCanonicalRegularFile(options.tarballPath, 'tarball')
  const installedRoot = requireCanonicalDirectory(options.installedRoot, 'extracted package')
  const cliPath = requireCanonicalRegularFile(options.cliPath, 'installed CLI')
  requireContainedPath(cliPath, installedRoot, 'Installed CLI is outside the extracted package')
  const packageVersion = requirePackageVersion(options.packageVersion)
  const packageJsonPath = requireCanonicalRegularFile(
    join(installedRoot, 'package.json'),
    'installed package manifest',
  )
  let installedPackage
  try {
    installedPackage = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  } catch {
    throw new Error('Installed package manifest is invalid')
  }
  if (!isRecord(installedPackage) || installedPackage.version !== packageVersion) {
    throw new Error('Installed package version does not match replay evidence')
  }
  const tarballSha256 = requireSha256(options.tarballSha256, 'tarball')
  const cliSha256 = requireSha256(options.cliSha256, 'installed CLI')
  if (sha256File(tarballPath) !== tarballSha256) {
    throw new Error('Tarball identity changed before replay evidence publication')
  }
  if (sha256File(cliPath) !== cliSha256) {
    throw new Error('Installed CLI identity changed before replay evidence publication')
  }
  const evidence = {
    schemaVersion: 1,
    kind: 'depfresh-installed-visual-plus-replay',
    packageVersion,
    tarball: { realpath: tarballPath, sha256: tarballSha256 },
    extractedPackage: { realpath: installedRoot },
    cli: { realpath: cliPath, sha256: cliSha256 },
    passed: { files: expected.files, suites: expected.suites, tests: expected.tests },
  }
  writeJsonAtomicNoReplace(outputPath, evidence)
  return evidence
}

function requireCanonicalDirectory(path, label) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) {
    throw new Error(`Installed replay ${label} path is invalid`)
  }
  let stats
  try {
    stats = lstatSync(path)
  } catch {
    throw new Error(`Installed replay ${label} is unavailable`)
  }
  if (!stats.isDirectory() || stats.isSymbolicLink() || realpathSync.native(path) !== path) {
    throw new Error(`Installed replay ${label} is unsafe`)
  }
  return path
}

function requireCanonicalRegularFile(path, label) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) {
    throw new Error(`Installed replay ${label} path is invalid`)
  }
  let stats
  try {
    stats = lstatSync(path)
  } catch {
    throw new Error(`Installed replay ${label} is unavailable`)
  }
  if (!stats.isFile() || stats.isSymbolicLink() || realpathSync.native(path) !== path) {
    throw new Error(`Installed replay ${label} is unsafe`)
  }
  return path
}

function requireContainedNewOutput(path, containmentRoot) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) {
    throw new Error('Installed replay evidence output path is invalid')
  }
  const parent = requireCanonicalDirectory(dirname(path), 'evidence output parent')
  requireContainedPath(parent, containmentRoot, 'Installed replay evidence output is not contained')
  try {
    lstatSync(path)
  } catch (error) {
    if (isMissing(error)) return path
    throw new Error('Installed replay evidence output is unavailable')
  }
  throw new Error('Installed replay evidence output already exists')
}

function requireContainedPath(path, root, message) {
  const containment = relative(root, path)
  if (containment.startsWith('..') || isAbsolute(containment)) throw new Error(message)
}

function requirePackageVersion(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
    throw new Error('Installed replay package version is invalid')
  }
  return value
}

function requireSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Installed replay ${label} SHA-256 is invalid`)
  }
  return value
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function writeJsonAtomicNoReplace(path, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  const pendingPath = join(
    dirname(path),
    `.${basename(path)}.pending-${process.pid}-${randomBytes(12).toString('hex')}`,
  )
  let descriptor
  try {
    descriptor = openSync(
      pendingPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    )
    let offset = 0
    while (offset < bytes.byteLength) {
      offset += writeSync(descriptor, bytes, offset, bytes.byteLength - offset)
    }
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    chmodSync(pendingPath, 0o600)
    linkSync(pendingPath, path)
  } catch {
    throw new Error('Installed replay evidence could not be published')
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {}
    }
    try {
      unlinkSync(pendingPath)
    } catch {}
  }
}

function isMissing(error) {
  return isRecord(error) && error.code === 'ENOENT'
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
