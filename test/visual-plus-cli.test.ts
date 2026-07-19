import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { visualLength } from '../src/utils/format'
import {
  classifyScriptProbe,
  createDetachedGroupMonitor,
  detectScriptAdapter,
  normalizeTerminalCapture,
  runInPty,
} from './helpers/pty-runner.mjs'
import { resolveVisualPlusCliPath } from './helpers/visual-plus-artifact-path.mjs'
import { createVisualPlusFixture } from './helpers/visual-plus-fixture.mjs'

const { cliPath } = resolveVisualPlusCliPath({
  cliPath: process.env.DEPFRESH_VISUAL_PLUS_CLI_PATH,
  installRoot: process.env.DEPFRESH_VISUAL_PLUS_INSTALL_ROOT,
})
const asOfMs = Date.parse('2026-07-19T00:00:00.000Z')
let fixtureParent = ''
const registryResponses: Array<{ get(name: string): Buffer | undefined }> = []
let registry: Server
let registryUrl = ''
let fixtureSequence = 0

beforeAll(async () => {
  fixtureParent = mkdtempSync(join(tmpdir(), 'depfresh-visual-plus-cli-'))
  try {
    registry = createServer((request, response) => {
      const rawUrl = request.url ?? ''
      if (
        (request.method !== 'GET' && request.method !== 'HEAD') ||
        Buffer.byteLength(rawUrl) > 4096
      ) {
        response.writeHead(request.method === 'GET' || request.method === 'HEAD' ? 414 : 405)
        response.end()
        return
      }
      const name = decodeURIComponent(new URL(rawUrl, 'http://127.0.0.1').pathname.slice(1))
      const body = registryResponses.map((responses) => responses.get(name)).find(Boolean)
      if (!body) {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end('{"error":"not found"}')
        return
      }
      response.writeHead(200, {
        'content-length': body.byteLength,
        'content-type': 'application/vnd.npm.install-v1+json',
      })
      response.end(request.method === 'HEAD' ? undefined : body)
    })
    await new Promise<void>((resolvePromise, rejectPromise) => {
      registry.once('error', rejectPromise)
      registry.listen(0, '127.0.0.1', resolvePromise)
    })
    const address = registry.address()
    if (!address || typeof address === 'string') throw new Error('Registry did not bind TCP')
    registryUrl = `http://127.0.0.1:${address.port}/`
    return cleanupFixtures
  } catch (error) {
    await cleanupFixtures()
    throw error
  }
})

async function cleanupFixtures() {
  try {
    if (registry?.listening) {
      await new Promise<void>((resolvePromise) => {
        const timer = setTimeout(() => {
          registry.closeAllConnections?.()
          resolvePromise()
        }, 1_000)
        registry.close(() => {
          clearTimeout(timer)
          resolvePromise()
        })
        registry.closeAllConnections?.()
      })
    }
  } finally {
    if (fixtureParent) rmSync(fixtureParent, { recursive: true, force: true })
  }
}

describe('Visual+ PTY adapter', () => {
  it('detects one supported script family without executing repository values as source', () => {
    const adapter = detectScriptAdapter()

    expect(['bsd', 'util-linux']).toContain(adapter.family)
    expect(adapter.scriptPath).toMatch(/^\//u)
    if (adapter.family === 'bsd') expect(adapter.expectPath).toMatch(/^\//u)
  })

  it('hard-fails an unrecognized script capability probe', () => {
    expect(() =>
      classifyScriptProbe({ status: 0, signal: null, stdout: 'mystery script', stderr: '' }),
    ).toThrow(/Unsupported script implementation/u)
  })

  it('projects known renderer controls into durable visible text', () => {
    const capture = Buffer.from(
      '\r\u001b[2Kactive\n\u001b[1A\r\u001b[2K\n\u001b[1Acomplete\n\u001b[?25h',
    )

    expect(normalizeTerminalCapture(capture, { columns: 40 })).toMatchObject({
      transcript: 'complete\n',
      finalCursorVisible: true,
    })

    expect(
      normalizeTerminalCapture(Buffer.from('line\r\n'), { columns: 40 }).controls,
    ).toMatchObject({
      carriageReturn: 0,
      crlf: 1,
    })
  })

  it('rejects unknown terminal protocol instead of deleting it', () => {
    expect(() =>
      normalizeTerminalCapture(Buffer.from('safe\u001b]8;;https://example.test\u0007link'), {
        columns: 40,
      }),
    ).toThrow(/unknown OSC/u)
  })

  it.each(['\u061c', '\u200b', '\u200c', '\u200d', '\u200e', '\u200f', '\u2060', '\ufeff'])(
    'rejects direction control U+%s',
    (control) => {
      expect(() =>
        normalizeTerminalCapture(Buffer.from(`safe${control}text`), { columns: 40 }),
      ).toThrow(/unknown control/u)
    },
  )

  it('allocates one PTY for all three child streams at the requested width', async () => {
    const result = await runInPty({
      cliPath: process.execPath,
      args: [
        '-e',
        'process.stdout.write(JSON.stringify({stdin:process.stdin.isTTY,stdout:process.stdout.isTTY,stderr:process.stderr.isTTY,columns:process.stdout.columns})+"\\n")',
      ],
      columns: 40,
      env: {},
      input: Buffer.alloc(0),
    })

    expect(result.evidence).toEqual({
      stdin: true,
      stdout: true,
      stderr: true,
      columns: 40,
      nodeVersion: process.version,
    })
    expect(result.exitCode).toBe(0)
  })

  it('rejects non-empty input before launching the adapter', async () => {
    await expect(
      runInPty({
        cliPath: process.execPath,
        args: ['-e', 'process.exit(0)'],
        columns: 40,
        env: {},
        input: Buffer.from('unexpected'),
      }),
    ).rejects.toThrow(/explicitly empty/u)
  })

  it('fails closed on bounded-output overflow and timeout', async () => {
    await expect(
      runInPty({
        cliPath: process.execPath,
        args: ['-e', 'process.stdout.write("x".repeat(4096))'],
        columns: 40,
        env: {},
        input: Buffer.alloc(0),
        outputLimit: 512,
      }),
    ).rejects.toThrow(/output limit/u)

    await expect(
      runInPty({
        cliPath: process.execPath,
        args: ['-e', 'setInterval(()=>{},1000)'],
        columns: 40,
        env: {},
        input: Buffer.alloc(0),
        timeoutMs: 100,
      }),
    ).rejects.toThrow(/timed out/u)
  }, 20_000)

  it.each(['overflow', 'timeout'] as const)(
    'removes a uniquely identified descendant after %s',
    async (failure) => {
      const marker = join(fixtureParent, `descendant-${failure}-${fixtureSequence}`)
      fixtureSequence += 1
      const source = [
        'const {spawn}=require("node:child_process")',
        'const {writeFileSync}=require("node:fs")',
        'const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"})',
        `writeFileSync(${JSON.stringify(marker)},String(child.pid))`,
        failure === 'overflow'
          ? 'setTimeout(()=>process.stdout.write("x".repeat(4096)),50)'
          : 'setInterval(()=>{},1000)',
      ].join(';')
      const promise = runInPty({
        cliPath: process.execPath,
        args: ['-e', source],
        columns: 40,
        env: {},
        input: Buffer.alloc(0),
        ...(failure === 'overflow' ? { outputLimit: 512 } : { timeoutMs: 150 }),
      })
      await expect(promise).rejects.toThrow(failure === 'overflow' ? /output limit/u : /timed out/u)
      const descendantPid = Number(readFileSync(marker, 'utf8'))
      expectProcessGone(descendantPid)
    },
    20_000,
  )

  it.each(['start-evidence-failure', 'malformed-start', 'malformed-completion'] as const)(
    'fails closed on exact wrapper fault %s',
    async (fault) => {
      await expect(
        runInPty({
          cliPath: process.execPath,
          args: ['-e', fault === 'start-evidence-failure' ? 'setInterval(()=>{},1000)' : ''],
          columns: 40,
          env: {},
          fault,
          input: Buffer.alloc(0),
          timeoutMs: 2_000,
        }),
      ).rejects.toThrow(/evidence|sidecar|cleanup|adapter/u)
    },
    10_000,
  )

  it.each(['observation-ambiguity', 'signaling-failure', 'survivor'] as const)(
    'surfaces cleanup fault %s while preserving the timeout primary error',
    async (cleanupFault) => {
      let caught: unknown
      try {
        await runInPty({
          cliPath: process.execPath,
          args: ['-e', 'setInterval(()=>{},1000)'],
          cleanupFault,
          columns: 40,
          env: {},
          input: Buffer.alloc(0),
          timeoutMs: 100,
        })
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(AggregateError)
      expect((caught as AggregateError).message).toBe('PTY capture timed out')
      expect(flattenErrorMessages(caught).join('\n')).toMatch(
        new RegExp(cleanupFault.replace('-', ' '), 'iu'),
      )
    },
    10_000,
  )

  it('retains exact signal completion separately from outer adapter status', async () => {
    const result = await runInPty({
      cliPath: process.execPath,
      args: ['-e', 'process.kill(process.pid,"SIGTERM")'],
      columns: 40,
      env: {},
      input: Buffer.alloc(0),
    })

    expect(result.exitCode).toBeNull()
    expect(result.signal).toBe('SIGTERM')
  })
})

describe('Visual+ built CLI', () => {
  it('executes the selected CLI artifact', () => {
    const version = execFileSync(process.execPath, [cliPath, '--version'], {
      encoding: 'utf8',
    })

    expect(version.trim()).toBe('2.1.0')
  })

  it.each([40, 60, 80, 118])(
    'renders exact success and safety journeys in a %i-column PTY',
    async (columns) => {
      const successFixture = createFixture(`success-${columns}`)
      const success = await runFixture(successFixture, columns, 'success', true)
      assertJourney(success, columns, 'success', successFixture)
      assertFixtureBytes(successFixture, 'after')
      assertNoApplyResidue(successFixture.repository)
      assertExpectedTargetDirtAndStage(successFixture)
      execFileSync(successFixture.git, ['commit', '--quiet', '-m', 'expected update'], {
        cwd: successFixture.repository,
        env: successFixture.gitEnvironment,
      })
      assertGitClean(successFixture)

      const safetyFixture = createFixture(`safety-${columns}`)
      const safety = await runFixture(safetyFixture, columns, 'safety', true)
      assertJourney(safety, columns, 'safety', safetyFixture)
      assertFixtureBytes(safetyFixture, 'before')
      expect(readFileSync(safetyFixture.variants.safety.counter, 'utf8')).toBe('2')
      assertNoApplyResidue(safetyFixture.repository)
      assertGitClean(safetyFixture)
    },
    120_000,
  )

  it('uses durable direct and slow-pipe fallbacks without losing read-only semantic output', async () => {
    const fixture = createFixture('direct-fallbacks')
    const direct = await runDirectFixture(fixture, false)
    const slow = await runDirectFixture(fixture, true)
    expect(direct.exitCode).toBe(0)
    expect(slow.exitCode).toBe(0)
    expect(slow.stdout).toEqual(direct.stdout)
    expect(direct.stdout.includes(0x1b)).toBe(false)
    expect(direct.stdout.includes(0x0d)).toBe(false)
    expect(direct.stderr.toString('utf8')).toContain('Tip: Use --output json')
    expect(slow.stderr).toEqual(direct.stderr)
    expect(direct.stdout.toString('utf8').endsWith('Exit 0\n')).toBe(true)
    assertReadOnlySemantics(direct.stdout.toString('utf8'), fixture)
    assertReadOnlySemantics(slow.stdout.toString('utf8'), fixture)

    assertFixtureBytes(fixture, 'before')
    assertGitClean(fixture)
  }, 120_000)

  it('uses durable capable and no-color PTY fallbacks without losing read-only semantic output', async () => {
    const fixture = createFixture('capable-fallbacks')
    const baseline = await runReadOnlyPty(fixture, {})
    const noColor = await runReadOnlyPty(fixture, { NO_COLOR: '1' })
    for (const result of [baseline, noColor]) {
      expect(result.exitCode).toBe(0)
      expect(result.evidence.columns).toBe(80)
      expect(result.finalCursorVisible).toBe(true)
      expect(result.transcript.endsWith('Exit 0\n')).toBe(true)
      assertReadOnlySemantics(result.transcript, fixture)
    }
    expect(baseline.controls.sgr).toBeGreaterThan(0)
    expect(baseline.controls.cursorUp).toBeGreaterThan(0)
    expect(noColor.controls.sgr).toBe(0)
    expect(noColor.controls.cursorUp).toBeGreaterThan(0)
    expect(noColor.transcript).toBe(baseline.transcript)

    assertFixtureBytes(fixture, 'before')
    assertGitClean(fixture)
  }, 120_000)

  it('uses durable CI and dumb constrained PTY fallbacks without losing read-only semantic output', async () => {
    const fixture = createFixture('constrained-fallbacks')
    const ci = await runReadOnlyPty(fixture, { CI: '1' })
    const dumb = await runReadOnlyPty(fixture, { TERM: 'dumb' })
    for (const result of [ci, dumb]) {
      expect(result.exitCode).toBe(0)
      expect(result.evidence.columns).toBe(80)
      expect(result.finalCursorVisible).toBe(true)
      expect(result.transcript.endsWith('Exit 0\n')).toBe(true)
      assertReadOnlySemantics(result.transcript, fixture)
    }
    for (const constrained of [ci, dumb]) {
      expect(constrained.controls.sgr).toBe(0)
      expect(constrained.controls.carriageReturn).toBe(0)
      expect(constrained.controls.cursorUp).toBe(0)
      expect(constrained.controls.eraseLine).toBe(0)
      expect(constrained.controls.cursorHide).toBe(0)
      expect(constrained.controls.cursorShow).toBe(1)
      const activeTransitions = constrained.transcript
        .split('\n')
        .filter((line) => /\bactive\b/u.test(line))
      expect(new Set(activeTransitions).size).toBe(activeTransitions.length)
    }
    expect(dumb.transcript).toMatch(/66 packages -> 616 declared -> 612 eligible/u)
    expect([...dumb.transcript].every((character) => character.codePointAt(0)! <= 0x7f)).toBe(true)

    assertFixtureBytes(fixture, 'before')
    assertGitClean(fixture)
  }, 120_000)

  it('sanitizes hostile owner text before it can become terminal protocol', async () => {
    const environmentFixture = createFixture('hostile-environment')
    const hostile = createHostileRepository()
    const result = await runInPty({
      cliPath: process.execPath,
      args: [cliPath, '--cwd', hostile.repository, '--recursive', '--mode', 'major'],
      columns: 80,
      env: capableEnvironment(environmentFixture.variants.success.environment, { NO_COLOR: '1' }),
      input: Buffer.alloc(0),
    })
    expect(result.exitCode).toBe(0)
    expect(result.controls.sgr).toBe(0)
    expect(result.transcript).toContain(`Owner ${hostile.sanitizedOwner}`)
    expect(result.transcript).not.toContain('\u001b]')
    expect(result.transcript).not.toContain('\u202e')
  }, 120_000)

  it('removes a stdio-independent descendant after a bounded direct-pipe abort', async () => {
    const marker = join(fixtureParent, `direct-abort-${fixtureSequence}`)
    fixtureSequence += 1
    const source = [
      'const {spawn}=require("node:child_process")',
      'const {writeFileSync}=require("node:fs")',
      'const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"})',
      `writeFileSync(${JSON.stringify(marker)},String(child.pid))`,
      'setInterval(()=>{},1000)',
    ].join(';')

    await expect(runDirectCommand(['-e', source], {}, { timeoutMs: 500 })).rejects.toThrow(
      /timed out/u,
    )
    expectProcessGone(Number(readFileSync(marker, 'utf8')))
  }, 10_000)
})

function createHostileRepository() {
  const repository = join(fixtureParent, `hostile-${fixtureSequence}`)
  fixtureSequence += 1
  mkdirSync(repository)
  const rawOwner = 'owner\nsafe\u001b[31mred\u001b]0;bad\u0007osc\u202e\u200b界👩‍💻'
  const sanitizedOwner = 'owner saferedosc界👩💻'
  writeFileSync(
    join(repository, 'package.json'),
    `${JSON.stringify({
      name: rawOwner,
      private: true,
      dependencies: { 'hostile-dependency': '^1.0.0' },
    })}\n`,
  )
  writeFileSync(join(repository, '.npmrc'), `registry=${registryUrl}\n`)
  const metadata = Buffer.from(
    JSON.stringify({
      name: 'hostile-dependency',
      versions: { '1.0.0': {}, '1.0.1': {} },
      time: {
        '1.0.0': '2026-07-18T00:00:00.000Z',
        '1.0.1': '2026-07-18T00:00:00.000Z',
      },
      'dist-tags': { latest: '1.0.1' },
    }),
  )
  registryResponses.push({
    get(name: string) {
      return name === 'hostile-dependency' ? Buffer.from(metadata) : undefined
    },
  })

  return { repository, sanitizedOwner }
}

function assertJourney(
  result: Awaited<ReturnType<typeof runInPty>>,
  columns: number,
  outcome: 'success' | 'safety',
  fixture: ReturnType<typeof createVisualPlusFixture>,
) {
  const expectedExit = outcome === 'success' ? 0 : 2
  expect(result.exitCode).toBe(expectedExit)
  expect(result.evidence.columns).toBe(columns)
  expect(result.finalCursorVisible).toBe(true)
  expect(result.controls.cursorUp).toBeGreaterThan(0)
  expect(result.controls.eraseLine).toBeGreaterThan(0)
  assertExactReviewMembership(result.transcript, fixture)
  expect(logicalFieldStarts(result.transcript, 'Operation ID ')).toBe(76)
  expect(result.transcript.match(/^Owner ID /gmu) ?? []).toHaveLength(15)
  expect(result.transcript.match(/^Dependency ID /gmu) ?? []).toHaveLength(18)
  expect(result.transcript.match(/^Occurrence$/gmu) ?? []).toHaveLength(39)
  expect(result.transcript.match(/^Major card$/gmu) ?? []).toHaveLength(2)
  const compact = result.transcript.replace(/\s+/gu, '')
  expect(compact).toContain('66packages→616declared→612eligible→76updates→14files')
  expect(result.transcript).toContain('Major 3')
  expect(result.transcript).toContain('Minor 37')
  expect(result.transcript).toContain('Patch 36')
  const transaction = result.transcript.slice(result.transcript.indexOf('Apply transaction'))
  expect(transaction.match(/^Target /gmu) ?? []).toHaveLength(14)
  const compactTransaction = transaction.replace(/\s+/gu, '')
  for (const target of fixture.targets) {
    expect(compactTransaction.split(`Target${target.path}`).length - 1, target.path).toBe(1)
  }
  for (const phase of [
    'discover',
    'inspect',
    'resolve',
    'review',
    'preflight',
    'stage',
    'apply',
    'observe',
    'recover',
    'complete',
  ]) {
    expect(result.transcript.match(new RegExp(`^${phase} · `, 'gmu')) ?? [], phase).toHaveLength(1)
  }
  expect(result.transcript).not.toMatch(/\bactive\b/u)
  if (outcome === 'success') {
    expect(compact).toContain('Complete·76updatesappliedacross14files')
    expect(compact).toContain('Applied76Blocked0Notattempted0Failed0Unknown0')
    expect(compact).toContain(
      'All14targetfileswereobservedattherequestedvalues.Recoverywasnotneeded.',
    )
  } else {
    expect(compact).toContain('Safetyblock·nofileswerechanged')
    expect(compact).toContain('Applied0Blocked0Notattempted76Failed0Unknown76')
    expect(result.transcript.match(/^Next:/gmu) ?? []).toHaveLength(1)
    expect(compact).toContain(
      'Next:reviewallreportederrorsandrestoretrustworthyGitevidenceforeveryreportedtargetbeforererunning.',
    )
    expect(compact.split('PreflightcouldnotconfirmGitstatefor').length - 1).toBe(14)
    for (const target of fixture.targets) {
      expect(
        compact.split(`PreflightcouldnotconfirmGitstatefor${target.path}.`).length - 1,
        target.path,
      ).toBe(1)
    }
  }
  expect(result.transcript.endsWith(`Exit ${expectedExit}\n`)).toBe(true)
  for (const line of result.transcript.split('\n')) {
    expect(visualLength(line), line).toBeLessThanOrEqual(columns)
  }
}

function logicalFieldStarts(transcript: string, label: string) {
  const lines = transcript.split('\n')
  return lines.filter(
    (line, index) => line.startsWith(label) && !lines[index - 1]?.startsWith(label),
  ).length
}

function assertReadOnlySemantics(
  transcript: string,
  fixture: ReturnType<typeof createVisualPlusFixture>,
) {
  assertExactReviewMembership(transcript, fixture)
  expect(logicalFieldStarts(transcript, 'Operation ID ')).toBe(76)
  expect(transcript.match(/^Owner ID /gmu) ?? []).toHaveLength(15)
  expect(transcript.match(/^Dependency ID /gmu) ?? []).toHaveLength(18)
  expect(transcript.match(/^Occurrence$/gmu) ?? []).toHaveLength(39)
  expect(transcript.match(/^Major card$/gmu) ?? []).toHaveLength(2)
  const compact = transcript.replace(/\s+/gu, '')
  expect(compact).toMatch(
    /66packages(?:→|->)616declared(?:→|->)612eligible(?:→|->)76updates(?:→|->)14files/u,
  )
  expect(compact).toContain('76updatesreviewedacross14targets.')
}

function assertExactReviewMembership(
  transcript: string,
  fixture: ReturnType<typeof createVisualPlusFixture>,
) {
  const reviewStart = transcript.indexOf('Complete change list\n')
  if (reviewStart < 0) throw new Error('Visual+ complete change list is missing')
  const reviewTail = transcript.slice(reviewStart)
  const reviewEnd = reviewTail.search(/^(?:preflight|stage|apply|observe|recover|complete) · /mu)
  const review = reviewEnd < 0 ? reviewTail : reviewTail.slice(0, reviewEnd)
  const fields = reviewOperationFields(review)
  expect(fields.dependencies.sort()).toEqual(
    fixture.selectedDeclarations.map((declaration) => declaration.name).sort(),
  )
  expect(fields.operationIds).toHaveLength(76)
  expect(new Set(fields.operationIds).size).toBe(76)

  const ownerSection = section(transcript, 'Owner impact\n', 'Shared dependencies\n')
  const ownerIds = wrappedValues(ownerSection, 'Owner ID ', 'Owner ')
  expect(ownerIds).toHaveLength(15)
  expect(new Set(ownerIds).size).toBe(15)
  expect(
    ownerSection
      .split('\n')
      .filter((line) => line.startsWith('Owner ') && !line.startsWith('Owner ID '))
      .map((line) => line.slice('Owner '.length))
      .sort(),
  ).toEqual([
    'auxiliary-catalog',
    ...Array.from(
      { length: 11 },
      (_value, index) => `fixture-package-${String(index + 2).padStart(2, '0')}`,
    ),
    'lab-editor',
    'root-catalog',
    'web',
  ])

  const sharedSection = section(transcript, 'Shared dependencies\n', 'Complete change list\n')
  const sharedIds = wrappedValues(sharedSection, 'Dependency ID ', 'Dependency ')
  expect(sharedIds).toHaveLength(18)
  expect(new Set(sharedIds).size).toBe(18)
  const expectedShared = [...groupDeclarationNames(fixture)]
    .filter(([_name, count]) => count > 1)
    .map(([name]) => name)
    .sort()
  expect(
    sharedSection
      .split('\n')
      .filter((line) => line.startsWith('Dependency ') && !line.startsWith('Dependency ID '))
      .map((line) => line.slice('Dependency '.length))
      .sort(),
  ).toEqual(expectedShared)

  const majorSection = section(transcript, 'Risk focus\n', 'Owner impact\n')
  expect(
    majorSection
      .split('\n')
      .filter((line) => line.startsWith('Dependency '))
      .map((line) => line.slice('Dependency '.length))
      .sort(),
  ).toEqual(['nanoid', 'react-dropzone'])
}

function reviewOperationFields(review: string) {
  const lines = review.split('\n')
  const starts = lines.flatMap((line, index) =>
    line.startsWith('Operation ID ') && !lines[index - 1]?.startsWith('Operation ID ')
      ? [index]
      : [],
  )
  const operationIds: string[] = []
  const dependencies: string[] = []
  for (const [position, start] of starts.entries()) {
    const block = lines.slice(start, starts[position + 1] ?? lines.length)
    if (block[0]?.includes('| Dependency ')) {
      const id: string[] = []
      const dependency: string[] = []
      for (const line of block.filter((candidate) => candidate.startsWith('Operation ID '))) {
        const match = /^Operation ID (.*?)\s+\| Dependency(?: (.*?))?(?:\s+\| Current|$)/u.exec(
          line,
        )
        if (!match) throw new Error('Could not reconstruct Visual+ review columns')
        id.push(match[1]!.trim())
        dependency.push((match[2] ?? '').trim())
      }
      operationIds.push(id.join(''))
      dependencies.push(dependency.join(''))
    } else {
      const dependencyIndex = block.findIndex((line) => line.startsWith('Dependency '))
      if (dependencyIndex < 1) throw new Error('Could not reconstruct Visual+ review fields')
      operationIds.push(
        [block[0]!.slice('Operation ID '.length), ...block.slice(1, dependencyIndex)].join(''),
      )
      dependencies.push(block[dependencyIndex]!.slice('Dependency '.length))
    }
  }
  return { dependencies, operationIds }
}

function wrappedValues(input: string, label: string, nextLabel: string) {
  const lines = input.split('\n')
  const values: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index]!.startsWith(label)) continue
    let value = lines[index]!.slice(label.length)
    while (lines[index + 1] && !lines[index + 1]!.startsWith(nextLabel)) {
      value += lines[index + 1]
      index += 1
    }
    values.push(value)
  }
  return values
}

function section(transcript: string, start: string, end: string) {
  const startIndex = transcript.indexOf(start)
  const endIndex = transcript.indexOf(end, startIndex + start.length)
  if (startIndex < 0 || endIndex < 0) throw new Error('Visual+ semantic section is missing')
  return transcript.slice(startIndex + start.length, endIndex)
}

function groupDeclarationNames(fixture: ReturnType<typeof createVisualPlusFixture>) {
  const counts = new Map<string, number>()
  for (const declaration of fixture.selectedDeclarations) {
    counts.set(declaration.name, (counts.get(declaration.name) ?? 0) + 1)
  }
  return counts
}

function createFixture(name: string) {
  const directory = join(fixtureParent, `${name}-${fixtureSequence}`)
  fixtureSequence += 1
  mkdirSync(directory)
  const fixture = createVisualPlusFixture(realpathSync(directory), { asOfMs, registryUrl })
  registryResponses.push(fixture.registry.responses)
  return fixture
}

function capableEnvironment(environment: Record<string, string>, overrides = {}) {
  const clean = Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) =>
        !['CI', 'NO_COLOR', 'FORCE_COLOR', 'CLICOLOR', 'CLICOLOR_FORCE'].includes(
          name.toUpperCase(),
        ),
    ),
  )
  return { ...clean, TERM: 'xterm-256color', ...overrides }
}

function runFixture(
  fixture: ReturnType<typeof createVisualPlusFixture>,
  columns: number,
  variant: 'success' | 'safety',
  write: boolean,
) {
  return runInPty({
    cliPath: process.execPath,
    args: [
      cliPath,
      '--cwd',
      fixture.repository,
      '--recursive',
      ...(write ? ['--write'] : []),
      '--mode',
      'major',
    ],
    columns,
    env: capableEnvironment(fixture.variants[variant].environment),
    input: Buffer.alloc(0),
  })
}

function runReadOnlyPty(
  fixture: ReturnType<typeof createVisualPlusFixture>,
  overrides: Record<string, string>,
) {
  return runInPty({
    cliPath: process.execPath,
    args: [cliPath, '--cwd', fixture.repository, '--recursive', '--mode', 'major'],
    columns: 80,
    env: capableEnvironment(fixture.variants.success.environment, overrides),
    input: Buffer.alloc(0),
  })
}

function runDirectFixture(fixture: ReturnType<typeof createVisualPlusFixture>, slow: boolean) {
  return runDirectCommand(
    [cliPath, '--cwd', fixture.repository, '--recursive', '--mode', 'major'],
    capableEnvironment(fixture.variants.success.environment),
    { slow },
  )
}

function runDirectCommand(
  args: string[],
  env: Record<string, string>,
  options: { outputLimit?: number; slow?: boolean; timeoutMs?: number },
) {
  return new Promise<{ exitCode: number | null; stdout: Buffer; stderr: Buffer }>(
    (resolvePromise, rejectPromise) => {
      const child = spawn(process.execPath, args, {
        cwd: '/',
        detached: true,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      const resumeTimers = new Set<NodeJS.Timeout>()
      let bytes = 0
      let settled = false
      let terminalError: Error | undefined
      let monitor: ReturnType<typeof createDetachedGroupMonitor>
      try {
        monitor = createDetachedGroupMonitor(child.pid)
      } catch (error) {
        child.kill('SIGKILL')
        rejectPromise(error)
        return
      }
      const observer = setInterval(monitor.observe, 20)
      const clearTimers = () => {
        clearTimeout(timer)
        clearInterval(observer)
        for (const resumeTimer of resumeTimers) clearTimeout(resumeTimer)
        resumeTimers.clear()
      }
      const abort = async (error: Error) => {
        if (settled || terminalError) return
        terminalError = error
        child.stdin.destroy()
        child.stdout.resume()
        child.stderr.resume()
        clearTimers()
        monitor.observe()
        try {
          await monitor.cleanup()
          settled = true
          rejectPromise(error)
        } catch (cleanupError) {
          settled = true
          rejectPromise(new AggregateError([error, cleanupError], error.message))
        }
      }
      const timer = setTimeout(
        () => void abort(new Error('Direct CLI capture timed out')),
        options.timeoutMs ?? 30_000,
      )
      const collect = (target: Buffer[], chunk: Buffer) => {
        if (terminalError) return
        bytes += chunk.byteLength
        if (bytes > (options.outputLimit ?? 4 * 1024 * 1024)) {
          void abort(new Error('Direct CLI capture exceeded output limit'))
          return
        }
        target.push(chunk)
      }
      child.stdout.on('data', (chunk: Buffer) => {
        collect(stdout, chunk)
        if (options.slow) {
          child.stdout.pause()
          const resumeTimer = setTimeout(() => {
            resumeTimers.delete(resumeTimer)
            if (!(settled || terminalError)) child.stdout.resume()
          }, 1)
          resumeTimers.add(resumeTimer)
        }
      })
      child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk))
      child.once(
        'error',
        (error) => void abort(new Error(`Direct CLI spawn failed: ${error.code}`)),
      )
      child.once('close', (exitCode) => {
        if (settled || terminalError) return
        settled = true
        clearTimers()
        resolvePromise({ exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) })
      })
      child.stdin.on(
        'error',
        (error) => void abort(new Error(`Direct CLI stdin failed: ${error.code}`)),
      )
      child.stdin.end()
    },
  )
}

function assertFixtureBytes(
  fixture: ReturnType<typeof createVisualPlusFixture>,
  state: 'before' | 'after',
) {
  for (const target of fixture.targets) {
    const actual = readFileSync(join(fixture.repository, target.path))
    const expected = state === 'before' ? target.beforeBytes : target.expectedAfterBytes
    const expectedHash = state === 'before' ? target.beforeHash : target.expectedAfterHash
    expect(actual, target.path).toEqual(expected)
    expect(createHash('sha256').update(actual).digest('hex'), target.path).toBe(expectedHash)
  }
}

function assertGitClean(fixture: ReturnType<typeof createVisualPlusFixture>) {
  const status = execFileSync(fixture.git, ['status', '--porcelain=v1', '-z'], {
    cwd: fixture.repository,
    env: fixture.gitEnvironment,
  })
  expect(status.byteLength).toBe(0)
}

function assertExpectedTargetDirtAndStage(fixture: ReturnType<typeof createVisualPlusFixture>) {
  const expected = fixture.targets.map((target) => target.path).sort()
  const status = execFileSync(fixture.git, ['status', '--porcelain=v1', '-z'], {
    cwd: fixture.repository,
    env: fixture.gitEnvironment,
  })
  const records = status.toString('utf8').split('\0').filter(Boolean)
  expect(records.every((record) => record.startsWith(' M '))).toBe(true)
  expect(records.map((record) => record.slice(3)).sort()).toEqual(expected)

  const literalTargets = fixture.targets.map((target) => `:(top,literal)${target.path}`)
  execFileSync(fixture.git, ['add', '--', ...literalTargets], {
    cwd: fixture.repository,
    env: fixture.gitEnvironment,
  })
  const staged = execFileSync(fixture.git, ['diff', '--cached', '--name-only', '-z'], {
    cwd: fixture.repository,
    env: fixture.gitEnvironment,
  })
  expect(staged.toString('utf8').split('\0').filter(Boolean).sort()).toEqual(expected)
  const stagedStatus = execFileSync(fixture.git, ['status', '--porcelain=v1', '-z'], {
    cwd: fixture.repository,
    env: fixture.gitEnvironment,
  })
  const stagedRecords = stagedStatus.toString('utf8').split('\0').filter(Boolean)
  expect(stagedRecords.every((record) => record.startsWith('M  '))).toBe(true)
  expect(stagedRecords.map((record) => record.slice(3)).sort()).toEqual(expected)
}

function assertNoApplyResidue(repository: string) {
  expect(existsSync(join(repository, '.depfresh'))).toBe(false)
  const residue: string[] = []
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      if (entry === '.git' || entry === 'filler') continue
      const path = join(directory, entry)
      if (/\.depfresh-.+\.(?:stage|backup)$/u.test(entry)) residue.push(relative(repository, path))
      else if (statSync(path).isDirectory()) visit(path)
    }
  }
  visit(repository)
  expect(residue).toEqual([])
}

function expectProcessGone(pid: number) {
  expect(Number.isSafeInteger(pid) && pid > 1).toBe(true)
  try {
    process.kill(pid, 0)
  } catch (error) {
    expect((error as NodeJS.ErrnoException).code).toBe('ESRCH')
    return
  }
  throw new Error(`Descendant process ${pid} survived cleanup`)
}

function flattenErrorMessages(error: unknown): string[] {
  if (error instanceof AggregateError) {
    return [error.message, ...error.errors.flatMap(flattenErrorMessages)]
  }
  return [error instanceof Error ? error.message : String(error)]
}
