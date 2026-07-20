import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

export const MAX_VISUAL_PLUS_REPORT_BYTES = 256 * 1024

const MAX_STABLE_FILE_BYTES = 4 * 1024 * 1024

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

export function trustedVisualPlusReplayTitles() {
  return Object.freeze([...TRUSTED_FAILURE_CATEGORIES.keys()])
}

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
  const containmentRoot = canonicalExistingDirectory(options.containmentRoot, 'evidence root')
  const outputPath = canonicalContainedNewOutput(
    options.outputPath,
    containmentRoot,
    'Installed replay evidence',
  )
  const tarballPath = canonicalExistingRegularFile(options.tarballPath, 'tarball')
  const installedRoot = canonicalExistingDirectory(options.installedRoot, 'extracted package')
  const cliPath = canonicalExistingRegularFile(options.cliPath, 'installed CLI')
  requireContainedPath(cliPath, installedRoot, 'Installed CLI is outside the extracted package')
  const packageVersion = requirePackageVersion(options.packageVersion)
  const packageJsonPath = canonicalExistingRegularFile(
    join(installedRoot, 'package.json'),
    'installed package manifest',
  )
  let installedPackage
  try {
    installedPackage = JSON.parse(
      readStableRegularFile(packageJsonPath, {
        label: 'installed package manifest',
        maxBytes: MAX_STABLE_FILE_BYTES,
      }).bytes.toString('utf8'),
    )
  } catch {
    throw new Error('Installed package manifest is invalid')
  }
  if (!isRecord(installedPackage) || installedPackage.version !== packageVersion) {
    throw new Error('Installed package version does not match replay evidence')
  }
  const tarballSha256 = requireSha256(options.tarballSha256, 'tarball')
  const cliSha256 = requireSha256(options.cliSha256, 'installed CLI')
  if (
    readStableRegularFile(tarballPath, {
      label: 'tarball',
      maxBytes: MAX_STABLE_FILE_BYTES,
    }).identity.sha256 !== tarballSha256
  ) {
    throw new Error('Tarball identity changed before replay evidence publication')
  }
  if (
    readStableRegularFile(cliPath, {
      label: 'installed CLI',
      maxBytes: MAX_STABLE_FILE_BYTES,
    }).identity.sha256 !== cliSha256
  ) {
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
  publishJsonAtomicNoReplace(outputPath, evidence, {
    errorPrefix: 'Installed replay evidence',
    hooks: options.publicationHooks,
  })
  return evidence
}

export function canonicalExistingDirectory(path, label) {
  return canonicalExistingPath(path, label, 'directory')
}

export function canonicalExistingRegularFile(path, label) {
  return canonicalExistingPath(path, label, 'file')
}

function canonicalExistingPath(path, label, kind) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) {
    throw new Error(`${label} path is invalid`)
  }
  let stats
  let canonical
  try {
    stats = lstatSync(path)
    canonical = realpathSync.native(path)
  } catch {
    throw new Error(`${label} is unavailable`)
  }
  const expectedKind = kind === 'directory' ? stats.isDirectory() : stats.isFile()
  if (!expectedKind || stats.isSymbolicLink() || !isAbsolute(canonical)) {
    throw new Error(`${label} is unsafe`)
  }
  return canonical
}

export function canonicalContainedNewOutput(path, containmentRoot, label) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) {
    throw new Error(`${label} output path is invalid`)
  }
  const canonicalRoot = canonicalExistingDirectory(containmentRoot, `${label} root`)
  const parent = canonicalExistingDirectory(dirname(path), `${label} output parent`)
  requireContainedPath(parent, canonicalRoot, `${label} output is not contained`)
  const outputPath = join(parent, basename(path))
  try {
    lstatSync(outputPath)
  } catch (error) {
    if (isMissing(error)) return outputPath
    throw new Error(`${label} output is unavailable`)
  }
  throw new Error(`${label} output already exists`)
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

export function readStableRegularFile(path, options) {
  if (!isRecord(options) || typeof options.label !== 'string') {
    throw new Error('Stable file read options are invalid')
  }
  const maxBytes = options.maxBytes
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error(`${options.label} byte bound is invalid`)
  }
  const canonical = canonicalExistingRegularFile(path, options.label)
  const expected = lstatSync(path)
  options.hooks?.afterLstat?.()
  let descriptor
  let closeError
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    )
    const opened = fstatSync(descriptor)
    requireSameRegularIdentity(expected, opened, options.label)
    if (opened.size < 0 || opened.size > maxBytes) {
      throw new Error(`${options.label} exceeds its byte bound`)
    }
    const bytes = Buffer.alloc(opened.size)
    let offset = 0
    while (offset < bytes.byteLength) {
      const count = readSync(descriptor, bytes, offset, bytes.byteLength - offset, offset)
      if (count === 0) throw new Error(`${options.label} changed while being read`)
      offset += count
    }
    if (readSync(descriptor, Buffer.alloc(1), 0, 1, bytes.byteLength) !== 0) {
      throw new Error(`${options.label} changed while being read`)
    }
    const afterDescriptor = fstatSync(descriptor)
    const afterPath = lstatSync(path)
    requireSameRegularIdentity(opened, afterDescriptor, options.label)
    requireSameRegularIdentity(opened, afterPath, options.label)
    if (realpathSync.native(path) !== canonical) {
      throw new Error(`${options.label} identity changed while being read`)
    }
    return {
      bytes,
      identity: stableIdentity(opened, canonical, bytes),
    }
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch (error) {
        closeError = error
      }
    }
    if (closeError !== undefined) throw new Error(`${options.label} descriptor could not be closed`)
  }
}

function requireSameRegularIdentity(expected, actual, label) {
  if (
    !actual.isFile() ||
    actual.isSymbolicLink() ||
    actual.dev !== expected.dev ||
    actual.ino !== expected.ino ||
    actual.mode !== expected.mode ||
    actual.nlink !== expected.nlink ||
    actual.size !== expected.size
  ) {
    throw new Error(`${label} identity changed while being read`)
  }
}

function stableIdentity(stats, canonical, bytes) {
  return {
    realpath: canonical,
    device: String(stats.dev),
    inode: String(stats.ino),
    mode: stats.mode,
    links: stats.nlink,
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

export function publishJsonAtomicNoReplace(path, value, options = {}) {
  const errorPrefix = typeof options.errorPrefix === 'string' ? options.errorPrefix : 'Evidence'
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  const parentPath = canonicalExistingDirectory(dirname(path), `${errorPrefix} output parent`)
  const parentContainer = canonicalExistingDirectory(
    dirname(parentPath),
    `${errorPrefix} output parent container`,
  )
  if (join(parentPath, basename(path)) !== path) {
    throw new Error(`${errorPrefix} output path is not canonical`)
  }
  const pendingPath = join(
    parentPath,
    `.${basename(path)}.pending-${process.pid}-${randomBytes(12).toString('hex')}`,
  )
  let expectedParent
  let parentDescriptor
  let pendingDescriptor
  let pendingCreated = false
  let pendingIdentity
  let relocatedParentPath
  let primaryError
  const cleanupErrors = []
  try {
    expectedParent = lstatSync(parentPath)
    parentDescriptor = openSync(
      parentPath,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    )
    requireSameDirectoryIdentity(expectedParent, fstatSync(parentDescriptor), errorPrefix)
    requireDirectoryPathIdentity(parentPath, expectedParent, parentDescriptor, errorPrefix)
    requireAbsent(path, errorPrefix)
    pendingDescriptor = openSync(
      pendingPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    )
    pendingCreated = true
    options.hooks?.beforePendingInitialStat?.({ pendingDescriptor, pendingPath })
    pendingIdentity = fstatSync(pendingDescriptor)
    if (
      !pendingIdentity.isFile() ||
      pendingIdentity.isSymbolicLink() ||
      pendingIdentity.dev !== expectedParent.dev ||
      pendingIdentity.nlink !== 1 ||
      pendingIdentity.size !== 0
    ) {
      throw new Error(`${errorPrefix} pending file is unsafe`)
    }
    options.hooks?.beforePendingChmod?.({ pendingDescriptor, pendingPath })
    fchmodSync(pendingDescriptor, 0o600)
    const securedIdentity = fstatSync(pendingDescriptor)
    if (
      securedIdentity.dev !== pendingIdentity.dev ||
      securedIdentity.ino !== pendingIdentity.ino ||
      (securedIdentity.mode & ~0o777) !== (pendingIdentity.mode & ~0o777) ||
      securedIdentity.nlink !== 1 ||
      securedIdentity.size !== 0 ||
      (securedIdentity.mode & 0o777) !== 0o600
    ) {
      throw new Error(`${errorPrefix} pending file is unsafe`)
    }
    pendingIdentity = securedIdentity
    requireDirectoryPathIdentity(parentPath, expectedParent, parentDescriptor, errorPrefix)
    let offset = 0
    while (offset < bytes.byteLength) {
      offset += writeSync(pendingDescriptor, bytes, offset, bytes.byteLength - offset)
    }
    fsyncSync(pendingDescriptor)
    const writtenIdentity = fstatSync(pendingDescriptor)
    if (
      writtenIdentity.dev !== pendingIdentity.dev ||
      writtenIdentity.ino !== pendingIdentity.ino ||
      writtenIdentity.mode !== pendingIdentity.mode ||
      writtenIdentity.nlink !== 1 ||
      writtenIdentity.size !== bytes.byteLength
    ) {
      throw new Error(`${errorPrefix} pending file changed while being written`)
    }
    pendingIdentity = writtenIdentity
    requirePendingPathIdentity(pendingPath, pendingIdentity, errorPrefix)
    const hookResult = options.hooks?.afterPendingCreated?.({ parentPath, pendingPath })
    if (isRecord(hookResult) && typeof hookResult.relocatedParentPath === 'string') {
      relocatedParentPath = hookResult.relocatedParentPath
    }
    requireDirectoryPathIdentity(parentPath, expectedParent, parentDescriptor, errorPrefix)
    requirePendingPathIdentity(pendingPath, pendingIdentity, errorPrefix)
    requireAbsent(path, errorPrefix)
    linkSync(pendingPath, path)
    const published = lstatSync(path)
    if (
      !published.isFile() ||
      published.isSymbolicLink() ||
      published.dev !== pendingIdentity.dev ||
      published.ino !== pendingIdentity.ino ||
      published.nlink !== 2
    ) {
      throw new Error(`${errorPrefix} publication identity is invalid`)
    }
    requireDirectoryPathIdentity(parentPath, expectedParent, parentDescriptor, errorPrefix)
    fsyncSync(parentDescriptor)
  } catch (error) {
    primaryError = error
  } finally {
    if (pendingCreated && pendingIdentity === undefined) {
      pendingIdentity = recoverCreatedPendingIdentity(
        pendingDescriptor,
        pendingPath,
        expectedParent,
        parentDescriptor,
        errorPrefix,
        cleanupErrors,
      )
    }
    try {
      options.hooks?.beforePendingCleanup?.()
    } catch (error) {
      cleanupErrors.push(error)
    }
    if (pendingIdentity !== undefined && (primaryError !== undefined || cleanupErrors.length > 0)) {
      cleanupOwnedPath(path, pendingIdentity, cleanupErrors)
    }
    const discoveredParent =
      relocatedParentPath === undefined && !isOwnedPath(pendingPath, pendingIdentity)
        ? locateDirectoryIdentity(parentContainer, expectedParent)
        : undefined
    const pendingCandidates = [
      pendingPath,
      ...(typeof relocatedParentPath === 'string'
        ? [join(relocatedParentPath, basename(pendingPath))]
        : []),
      ...(discoveredParent === undefined
        ? []
        : [join(discoveredParent, basename(pendingPath))]),
    ]
    for (const candidate of pendingCandidates) {
      cleanupOwnedPath(candidate, pendingIdentity, cleanupErrors)
    }
    if (pendingDescriptor !== undefined && (primaryError !== undefined || cleanupErrors.length > 0)) {
      cleanupOwnedPath(path, pendingIdentity, cleanupErrors)
    }
    if (pendingDescriptor !== undefined && pendingIdentity !== undefined) {
      try {
        const remainingLinks = fstatSync(pendingDescriptor).nlink
        const expectedLinks = primaryError === undefined && cleanupErrors.length === 0 ? 1 : 0
        if (remainingLinks !== expectedLinks) {
          cleanupErrors.push(new Error(`${errorPrefix} pending residue remains observable`))
        }
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (
      primaryError === undefined &&
      cleanupErrors.length === 0 &&
      pendingIdentity !== undefined &&
      parentDescriptor !== undefined &&
      expectedParent !== undefined
    ) {
      try {
        const published = lstatSync(path)
        if (
          !published.isFile() ||
          published.isSymbolicLink() ||
          published.dev !== pendingIdentity.dev ||
          published.ino !== pendingIdentity.ino ||
          published.nlink !== 1 ||
          published.size !== bytes.byteLength
        ) {
          throw new Error(`${errorPrefix} final publication identity is invalid`)
        }
        requireDirectoryPathIdentity(parentPath, expectedParent, parentDescriptor, errorPrefix)
        options.afterPublication?.()
        const afterCallback = lstatSync(path)
        if (
          !afterCallback.isFile() ||
          afterCallback.isSymbolicLink() ||
          afterCallback.dev !== pendingIdentity.dev ||
          afterCallback.ino !== pendingIdentity.ino ||
          afterCallback.nlink !== 1 ||
          afterCallback.size !== bytes.byteLength
        ) {
          throw new Error(`${errorPrefix} final publication identity changed`)
        }
        requireDirectoryPathIdentity(parentPath, expectedParent, parentDescriptor, errorPrefix)
        fsyncSync(parentDescriptor)
      } catch (error) {
        primaryError = error
        cleanupOwnedPath(path, pendingIdentity, cleanupErrors)
      }
    }
    if (pendingDescriptor !== undefined && parentDescriptor !== undefined) {
      try {
        options.hooks?.beforeDescriptorClose?.({ parentDescriptor, pendingDescriptor })
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (pendingDescriptor !== undefined) {
      try {
        closeSync(pendingDescriptor)
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (parentDescriptor !== undefined) {
      try {
        closeSync(parentDescriptor)
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (cleanupErrors.length > 0 && pendingIdentity !== undefined) {
      cleanupOwnedPath(path, pendingIdentity, cleanupErrors)
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [...(primaryError === undefined ? [] : [primaryError]), ...cleanupErrors],
      `${errorPrefix} cleanup failed`,
    )
  }
  if (primaryError !== undefined) {
    throw new Error(`${errorPrefix} could not be published`, { cause: primaryError })
  }
}

function recoverCreatedPendingIdentity(
  descriptor,
  path,
  expectedParent,
  parentDescriptor,
  label,
  errors,
) {
  if (descriptor !== undefined && expectedParent !== undefined) {
    try {
      const identity = fstatSync(descriptor)
      if (
        identity.isFile() &&
        !identity.isSymbolicLink() &&
        identity.dev === expectedParent.dev &&
        identity.nlink === 1 &&
        identity.size === 0
      ) {
        requirePendingPathIdentity(path, identity, label)
        return identity
      }
    } catch {}
  }
  if (expectedParent === undefined || parentDescriptor === undefined) {
    errors.push(new Error(`${label} pending identity is unavailable for cleanup`))
    return undefined
  }
  try {
    requireDirectoryPathIdentity(dirname(path), expectedParent, parentDescriptor, label)
    const actual = lstatSync(path)
    if (
      !actual.isFile() ||
      actual.isSymbolicLink() ||
      actual.dev !== expectedParent.dev ||
      actual.nlink !== 1 ||
      actual.size !== 0 ||
      (actual.mode & 0o177) !== 0
    ) {
      errors.push(new Error(`${label} unverified pending path remains after early failure`))
      return undefined
    }
    unlinkSync(path)
    fsyncSync(parentDescriptor)
  } catch (error) {
    if (!isMissing(error)) errors.push(error)
  }
  return undefined
}

function requireSameDirectoryIdentity(expected, actual, label) {
  if (
    !actual.isDirectory() ||
    actual.isSymbolicLink() ||
    actual.dev !== expected.dev ||
    actual.ino !== expected.ino ||
    actual.mode !== expected.mode
  ) {
    throw new Error(`${label} output parent identity changed`)
  }
}

function requireDirectoryPathIdentity(path, expected, descriptor, label) {
  requireSameDirectoryIdentity(expected, fstatSync(descriptor), label)
  requireSameDirectoryIdentity(expected, lstatSync(path), label)
  if (realpathSync.native(path) !== path) throw new Error(`${label} output parent identity changed`)
}

function requirePendingPathIdentity(path, expected, label) {
  const actual = lstatSync(path)
  if (
    !actual.isFile() ||
    actual.isSymbolicLink() ||
    actual.dev !== expected.dev ||
    actual.ino !== expected.ino ||
    actual.mode !== expected.mode ||
    actual.nlink !== expected.nlink
  ) {
    throw new Error(`${label} pending identity changed`)
  }
}

function requireAbsent(path, label) {
  try {
    lstatSync(path)
  } catch (error) {
    if (isMissing(error)) return
    throw new Error(`${label} output is unavailable`)
  }
  throw new Error(`${label} output already exists`)
}

function cleanupOwnedPath(path, expected, errors) {
  if (expected === undefined) return
  let actual
  try {
    actual = lstatSync(path)
  } catch (error) {
    if (isMissing(error)) return
    errors.push(error)
    return
  }
  if (actual.dev !== expected.dev || actual.ino !== expected.ino || !actual.isFile()) {
    errors.push(new Error('Owned publication path identity changed during cleanup'))
    return
  }
  try {
    unlinkSync(path)
  } catch (error) {
    errors.push(error)
  }
}

function isOwnedPath(path, expected) {
  if (expected === undefined) return false
  try {
    const actual = lstatSync(path)
    return actual.isFile() && actual.dev === expected.dev && actual.ino === expected.ino
  } catch {
    return false
  }
}

function locateDirectoryIdentity(container, expected) {
  if (expected === undefined) return undefined
  let names
  try {
    names = readdirSync(container)
  } catch {
    return undefined
  }
  if (names.length > 4096) return undefined
  for (const name of names) {
    const candidate = join(container, name)
    let stats
    try {
      stats = lstatSync(candidate)
    } catch {
      continue
    }
    if (
      stats.isDirectory() &&
      !stats.isSymbolicLink() &&
      stats.dev === expected.dev &&
      stats.ino === expected.ino
    ) {
      return candidate
    }
  }
  return undefined
}

function isMissing(error) {
  return isRecord(error) && error.code === 'ENOENT'
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
