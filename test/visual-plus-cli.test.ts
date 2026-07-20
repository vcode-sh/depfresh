import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
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
import { isAbsolute, join, relative } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { visualLength } from '../src/utils/format'
import {
  canArmTimeoutAfterReadiness,
  classifyRawTerminalTransport,
  classifyScriptProbe,
  createDetachedGroupMonitor,
  detectScriptAdapter,
  hasDoubleCarriageReturnLineFeed,
  matchingObservedIdentities,
  normalizeTerminalCapture,
  observeIdentity,
  observeIdentitySnapshot,
  processScanArguments,
  processScanFailureReason,
  readPtyTimeoutPhase,
  readPtyTranscriptFailurePhase,
  registerEvidenceIdentity,
  runInPty,
  sameProcessIdentity,
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
  it('preserves the first parent when the same process is reparented', () => {
    const observed = Object.assign(new Map(), { ambiguous: false })
    const original = { parent: 200, group: 300, start: 'Sun Jul 19 13:20:31 2026' }

    observeIdentity(observed, 300, original)
    observeIdentity(observed, 300, { ...original, parent: 1 })

    expect(observed.get(300)).toEqual(original)
    expect(observed.ambiguous).toBe(false)
    expect(() => registerEvidenceIdentity(observed, 300, original)).not.toThrow()
  })

  it('rejects sidecar topology when observation starts after reparenting', () => {
    const observed = Object.assign(new Map(), { ambiguous: false })
    const original = { parent: 200, group: 300, start: 'Sun Jul 19 13:20:31 2026' }

    observeIdentity(observed, 300, { ...original, parent: 1 })

    expect(() => registerEvidenceIdentity(observed, 300, original)).toThrow(
      'PTY process identity evidence changed',
    )
    expect(observed.ambiguous).toBe(true)
  })

  it('retains first evidence and marks start or group mutation ambiguous', () => {
    const observed = Object.assign(new Map(), { ambiguous: false })
    const original = { parent: 200, group: 300, start: 'Sun Jul 19 13:20:31 2026' }

    for (const changed of [
      { parent: 200, group: 300, start: 'Sun Jul 19 13:20:32 2026' },
      { parent: 200, group: 301, start: 'Sun Jul 19 13:20:31 2026' },
    ]) {
      observed.ambiguous = false
      observeIdentity(observed, 300, original)
      observeIdentity(observed, 300, changed)

      expect(observed.get(300)).toEqual(original)
      expect(observed.ambiguous).toBe(true)
    }
  })

  it('scopes process inventory to the exact current numeric user', () => {
    expect(processScanArguments(501)).toEqual([
      '-U',
      '501',
      '-x',
      '-o',
      'pid=',
      '-o',
      'ppid=',
      '-o',
      'pgid=',
      '-o',
      'lstart=',
    ])
    expect(processScanFailureReason({ uid: undefined })).toBe('uid')
    expect(
      processScanFailureReason({
        uid: 501,
        error: Object.assign(new Error(), { code: 'ETIMEDOUT' }),
      }),
    ).toBe('timeout')
    expect(processScanFailureReason({ uid: 501, error: new Error() })).toBe('spawn')
    expect(processScanFailureReason({ uid: 501, status: 1, stdout: '' })).toBe('status')
    expect(processScanFailureReason({ uid: 501, status: 0, stdout: 'x'.repeat(1024 * 1024) })).toBe(
      'oversize',
    )
    expect(processScanFailureReason({ uid: 501, status: 0, stdout: '' })).toBeUndefined()
  })

  it('matches cleanup identity across reparenting but rejects changed start or group', () => {
    const original = { parent: 200, group: 300, start: 'Sun Jul 19 13:20:31 2026' }

    expect(sameProcessIdentity(original, { ...original, parent: 1 })).toBe(true)
    expect(
      sameProcessIdentity(original, {
        ...original,
        parent: 1,
        start: 'Sun Jul 19 13:20:32 2026',
      }),
    ).toBe(false)
    expect(sameProcessIdentity(original, { ...original, parent: 1, group: 301 })).toBe(false)
  })

  it('rejects an exact coarse identity that disappears and later reappears', () => {
    const observed = Object.assign(new Map(), { ambiguous: false })
    const original = { parent: 200, group: 300, start: 'Sun Jul 19 13:20:31 2026' }

    observeIdentity(observed, 300, original)
    observeIdentitySnapshot(observed, new Map())
    expect(observed.missing).toEqual(new Set([300]))

    const reparented = { ...original, parent: 1 }
    const current = new Map([[300, reparented]])
    observeIdentitySnapshot(observed, current)

    expect(observed.get(300)).toEqual(original)
    expect(observed.ambiguous).toBe(true)
    expect(observed.reappeared).toEqual(new Set([300]))
    expect(matchingObservedIdentities(current, observed).has(300)).toBe(false)

    const exactObserved = Object.assign(new Map([[300, original]]), {
      ambiguous: false,
      missing: new Set<number>(),
      probeFailed: false,
      probeSucceeded: true,
      provisionalGroupChanges: new Map(),
      reappeared: new Set<number>(),
    })
    const exactCurrent = new Map([[300, original]])
    expect(canArmTimeoutAfterReadiness(300, exactCurrent, exactObserved)).toBe(true)
    expect(
      canArmTimeoutAfterReadiness(
        300,
        exactCurrent,
        Object.assign(new Map(exactObserved), exactObserved, { missing: new Set([400]) }),
      ),
    ).toBe(true)
    for (const unsafeObserved of [
      Object.assign(new Map(exactObserved), exactObserved, { ambiguous: true }),
      Object.assign(new Map(exactObserved), exactObserved, { missing: new Set([300]) }),
      Object.assign(new Map(exactObserved), exactObserved, { probeFailed: true }),
      Object.assign(new Map(exactObserved), exactObserved, {
        provisionalGroupChanges: new Map([[300, { group: 301 }]]),
      }),
      Object.assign(new Map(exactObserved), exactObserved, { reappeared: new Set([300]) }),
    ]) {
      expect(canArmTimeoutAfterReadiness(300, exactCurrent, unsafeObserved)).toBe(false)
    }
    expect(canArmTimeoutAfterReadiness(300, new Map(), exactObserved)).toBe(false)
    expect(
      canArmTimeoutAfterReadiness(
        300,
        new Map([[300, { ...original, start: 'Sun Jul 19 13:20:32 2026' }]]),
        exactObserved,
      ),
    ).toBe(false)
  })

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
    const noRawTransportSignal = {
      doubleCrlf: false,
      beforeEscape: false,
      beforeText: false,
      beforeOtherControl: false,
      trailing: false,
    }
    expect(classifyRawTerminalTransport(Buffer.from('line\r\n'))).toEqual(noRawTransportSignal)
    expect(classifyRawTerminalTransport(Buffer.from([13, 13, 10]))).toEqual({
      ...noRawTransportSignal,
      doubleCrlf: true,
    })
    expect(classifyRawTerminalTransport(Buffer.from([13, 27]))).toEqual({
      ...noRawTransportSignal,
      beforeEscape: true,
    })
    expect(classifyRawTerminalTransport(Buffer.from('\rtext'))).toEqual({
      ...noRawTransportSignal,
      beforeText: true,
    })
    expect(classifyRawTerminalTransport(Buffer.from([13, 0]))).toEqual({
      ...noRawTransportSignal,
      beforeOtherControl: true,
    })
    expect(classifyRawTerminalTransport(Buffer.from([13]))).toEqual({
      ...noRawTransportSignal,
      trailing: true,
    })
    expect(() => classifyRawTerminalTransport(Buffer.alloc(4 * 1024 * 1024 + 1))).toThrow(
      'Terminal capture exceeds the configured bound',
    )
    expect(hasDoubleCarriageReturnLineFeed(Buffer.from([13, 13, 10]))).toBe(true)
    expect(hasDoubleCarriageReturnLineFeed(Buffer.from([13, 10]))).toBe(false)
    expect(hasDoubleCarriageReturnLineFeed(Buffer.from([13, 13]))).toBe(false)

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

  it('diagnoses child writes before the owned line-ending transform', async () => {
    const bareLineFeed = await runInPty({
      cliPath: process.execPath,
      args: [
        '-e',
        'if(process.stdout.write.length!==3)process.exit(86);process.stdout.write("line\\n")',
      ],
      columns: 40,
      diagnoseChildWrites: true,
      env: {},
      input: Buffer.alloc(0),
    })
    expect(bareLineFeed.writeBoundary).toEqual(
      expectedWriteBoundary({ childStdout: { bareLf: true }, inner: { bareLf: true } }),
    )
    expect(bareLineFeed.rawTerminal).toEqual(Buffer.from('line\r\n'))

    const splitExplicitCrlf = await runInPty({
      cliPath: process.execPath,
      args: ['-e', 'process.stdout.write("line\\r");process.stdout.write("\\n")'],
      columns: 40,
      diagnoseChildWrites: true,
      env: {},
      input: Buffer.alloc(0),
    })
    expect(splitExplicitCrlf.writeBoundary).toEqual(
      expectedWriteBoundary({
        childStdout: { singleCrlf: true },
        inner: { singleCrlf: true },
      }),
    )
    expect(splitExplicitCrlf.rawTerminal).toEqual(Buffer.from('line\r\n'))

    const childDoubleCrlf = await runInPty({
      cliPath: process.execPath,
      args: ['-e', 'process.stdout.write("line\\r\\r\\n")'],
      columns: 40,
      diagnoseChildWrites: true,
      env: {},
      input: Buffer.alloc(0),
    })
    expect(childDoubleCrlf.writeBoundary).toEqual(
      expectedWriteBoundary({
        childStdout: { doubleCrlf: true },
        inner: { doubleCrlf: true },
      }),
    )
    expect(childDoubleCrlf.rawTerminal).toEqual(Buffer.from('line\r\r\n'))
  })

  it('diagnoses owned output-mode changes at child write time and process close', async () => {
    const disabled = await runInPty({
      cliPath: process.execPath,
      args: [
        '-e',
        'require("node:child_process").execFileSync("/bin/stty",["-opost"],{stdio:"inherit"});process.stdout.write("line\\r\\n")',
      ],
      columns: 40,
      diagnoseChildWrites: true,
      env: {},
      input: Buffer.alloc(0),
    })
    expect(disabled.writeBoundary).toEqual(
      expectedWriteBoundary({
        childStdout: { singleCrlf: true },
        inner: { singleCrlf: true },
      }),
    )

    const changedAndRestored = await runInPty({
      cliPath: process.execPath,
      args: [
        '-e',
        'const {execFileSync}=require("node:child_process");execFileSync("/bin/stty",["opost","onlcr"],{stdio:"inherit"});process.stdout.write("line\\r\\n");execFileSync("/bin/stty",["-opost","-onlcr"],{stdio:"inherit"})',
      ],
      columns: 40,
      diagnoseChildWrites: true,
      env: {},
      input: Buffer.alloc(0),
    })
    expect(changedAndRestored.writeBoundary).toEqual(
      expectedWriteBoundary({
        childStdout: { singleCrlf: true },
        inner: { doubleCrlf: true },
        stateChanged: true,
        writeModes: { newlineMapping: true, outputProcessing: true },
      }),
    )

    const hostileInherited = await runInPty({
      cliPath: process.execPath,
      args: [
        '-e',
        'const {execFileSync}=require("node:child_process");const output=execFileSync("/bin/stty",["-a"],{encoding:"utf8",stdio:["inherit","pipe","inherit"]});const modes=new Set(output.split(/[\\s;:]+/u));const required=["-icanon","-echo","-opost","-onlcr","-onocr","-onlret",...(process.platform==="darwin"?[]:["-ocrnl"])];const forbidden=["icanon","echo","opost","onlcr","ocrnl","onocr","onlret"];if(required.some(mode=>!modes.has(mode))||forbidden.some(mode=>modes.has(mode)))process.exit(86);process.stdout.write("line\\n")',
      ],
      columns: 40,
      diagnoseChildWrites: true,
      env: {},
      fault: 'inner-hostile-output-modes',
      input: Buffer.alloc(0),
    })

    expect(hostileInherited.exitCode).toBe(0)
    expect(hostileInherited.rawTerminal).toEqual(Buffer.from('line\r\n'))
    expect(hostileInherited.writeBoundary).toEqual(
      expectedWriteBoundary({ childStdout: { bareLf: true }, inner: { bareLf: true } }),
    )
  })

  it('separates child, inner, and outer output transforms', async () => {
    const adapter = detectScriptAdapter()
    if (adapter.family !== 'bsd') return
    const result = await runInPty({
      cliPath: process.execPath,
      args: ['-e', 'process.stdout.write("line\\r\\n")'],
      columns: 40,
      diagnoseChildWrites: true,
      env: {},
      fault: 'outer-post-proof-output-processing',
      input: Buffer.alloc(0),
    })

    expect(result.writeBoundary).toEqual(
      expectedWriteBoundary({ childStdout: { singleCrlf: true }, inner: { singleCrlf: true } }),
    )
    expect(result.outerTransportDoubleCrlf).toBe(true)
  })

  it('fails closed when child-write evidence is absent or malformed', async () => {
    for (const fault of [
      'child-write-evidence-missing',
      'child-write-evidence-malformed',
      'child-write-evidence-unclosed',
    ] as const) {
      await expect(
        runInPty({
          cliPath: process.execPath,
          args: ['-e', 'process.stdout.write("line\\n")'],
          columns: 40,
          diagnoseChildWrites: true,
          env: {},
          fault,
          input: Buffer.alloc(0),
        }),
      ).rejects.toThrow(/^PTY child write evidence is invalid$/u)
    }

    await expect(
      runInPty({
        cliPath: realpathSync('/bin/sh'),
        args: ['-c', 'printf line'],
        columns: 40,
        diagnoseChildWrites: true,
        env: {},
        input: Buffer.alloc(0),
      }),
    ).rejects.toThrow(/^PTY child-write diagnostics require the current Node executable$/u)
  })

  it('keeps one owned ONLCR transform and transports explicit CRLF unchanged', async () => {
    const adapter = detectScriptAdapter()
    const requiredModes =
      adapter.family === 'bsd' ? ['-icanon', '-echo', '-opost', '-onlcr'] : ['-opost', '-onlcr']
    const forbiddenModes =
      adapter.family === 'bsd' ? ['icanon', 'echo', 'opost', 'onlcr'] : ['opost', 'onlcr']
    const lineFeed = await runInPty({
      cliPath: process.execPath,
      args: [
        '-e',
        `const output=require("node:child_process").execFileSync("/bin/stty",["-a"],{encoding:"utf8",stdio:["inherit","pipe","inherit"]});const modes=new Set(output.split(/[\\s;:]+/u));const required=${JSON.stringify(requiredModes)};const forbidden=${JSON.stringify(forbiddenModes)};if(required.some(mode=>!modes.has(mode))||forbidden.some(mode=>modes.has(mode)))process.exit(86);process.stdout.write("line\\n")`,
      ],
      columns: 40,
      env: {},
      input: Buffer.alloc(0),
    })
    const explicitCrlf = await runInPty({
      cliPath: process.execPath,
      args: [
        '-e',
        'require("node:child_process").execFileSync("/bin/stty",["-opost"],{stdio:"inherit"});process.stdout.write("line\\r\\n")',
      ],
      columns: 40,
      env: {},
      input: Buffer.alloc(0),
    })
    const delayedImmediateLineFeed = await runInPty({
      cliPath: process.execPath,
      args: ['-e', 'process.stdout.write("line\\n")'],
      columns: 40,
      env: {},
      ...(adapter.family === 'bsd' ? { fault: 'outer-release-publication-delay' as const } : {}),
      input: Buffer.alloc(0),
    })

    for (const result of [lineFeed, explicitCrlf, delayedImmediateLineFeed]) {
      expect(result.adapter.family).toBe(adapter.family)
      expect(result.exitCode).toBe(0)
      expect(result.rawTerminal).toEqual(Buffer.from('line\r\n'))
      expect(result.transcript).toBe('line\n')
      expect(result.controls).toMatchObject({ carriageReturn: 0, crlf: 1 })
      if (adapter.family === 'bsd') {
        expect(result.outerTransportDoubleCrlf).toBe(false)
      } else {
        expect(Object.hasOwn(result, 'outerTransportDoubleCrlf')).toBe(false)
      }
    }

    for (const fault of ['start-readiness-missing', 'start-readiness-malformed'] as const) {
      await expect(
        runInPty({
          cliPath: process.execPath,
          args: ['-e', 'process.stdout.write("private-readiness-bytes\\n")'],
          columns: 40,
          env: {},
          fault,
          input: Buffer.alloc(0),
        }),
      ).rejects.toThrow(/^PTY start readiness evidence is invalid$/u)
    }

    if (adapter.family === 'bsd') {
      const postProofOutputProcessing = await runInPty({
        cliPath: process.execPath,
        args: ['-e', 'process.stdout.write("line\\r\\n")'],
        columns: 40,
        env: {},
        fault: 'outer-post-proof-output-processing',
        input: Buffer.alloc(0),
      })
      expect(postProofOutputProcessing.outerTransportDoubleCrlf).toBe(true)
      expect(hasDoubleCarriageReturnLineFeed(postProofOutputProcessing.rawTerminal)).toBe(false)
      expect(postProofOutputProcessing.rawTerminal).toEqual(Buffer.from('line\r\n'))

      for (const [fault, message] of [
        ['typescript-missing', 'PTY transcript evidence is invalid'],
        ['typescript-replaced', 'PTY transcript evidence is invalid'],
        ['typescript-symlink', 'PTY transcript evidence is invalid'],
        ['typescript-wrong-mode', 'PTY transcript evidence is invalid'],
        ['typescript-unstable', 'PTY transcript evidence is invalid'],
      ] as const) {
        await expect(
          runInPty({
            cliPath: process.execPath,
            args: ['-e', 'process.stdout.write("line\\n")'],
            columns: 40,
            env: {},
            fault,
            input: Buffer.alloc(0),
            outputLimit: 512,
          }),
        ).rejects.toThrow(new RegExp(`^${message}$`, 'u'))
      }

      let transcriptOversize: unknown
      try {
        await runInPty({
          cliPath: process.execPath,
          args: ['-e', 'process.stdout.write("line\\n")'],
          columns: 40,
          env: {},
          fault: 'typescript-oversize',
          input: Buffer.alloc(0),
          outputLimit: 512,
        })
      } catch (error) {
        transcriptOversize = error
      }
      expect(transcriptOversize).toBeInstanceOf(Error)
      expect((transcriptOversize as Error).message).toBe('PTY transcript exceeded output limit')
      expect(readPtyTranscriptFailurePhase(transcriptOversize)).toBe('after-wrapper-readiness')

      for (const fault of [
        'outer-transport-missing',
        'outer-transport-malformed',
        'outer-transport-ambiguous',
        'outer-output-processing',
      ] as const) {
        const marker = join(fixtureParent, `transport-release-${fault}-${fixtureSequence}`)
        fixtureSequence += 1
        await expect(
          runInPty({
            cliPath: process.execPath,
            args: ['-e', `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "spawned")`],
            columns: 40,
            env: {},
            fault,
            input: Buffer.alloc(0),
          }),
        ).rejects.toThrow(/^PTY outer transport evidence is invalid$/u)
        expect(existsSync(marker)).toBe(false)
      }

      const signalMarker = join(fixtureParent, `pre-release-signal-${fixtureSequence}`)
      fixtureSequence += 1
      const signalCli = join(fixtureParent, `pre-release-signal-cli-${fixtureSequence}`)
      fixtureSequence += 1
      writeFileSync(signalCli, '#!/bin/sh\nprintf spawned > "$1"\n/bin/sleep 1\n')
      chmodSync(signalCli, 0o700)
      let signalError: unknown
      try {
        await runInPty({
          cliPath: realpathSync(signalCli),
          args: [signalMarker],
          columns: 40,
          env: {},
          fault: 'outer-release-pre-spawn-signal',
          input: Buffer.alloc(0),
        })
      } catch (error) {
        signalError = error
      }
      expect(existsSync(signalMarker)).toBe(false)
      expect(signalError).toEqual(new Error('PTY start readiness evidence is invalid'))

      for (const [fault, message] of [
        ['outer-release-ready-malformed', 'PTY outer transport evidence is invalid'],
        ['outer-release-ready-ambiguous', 'PTY outer transport evidence is invalid'],
        ['wrapper-ready-marker-malformed', 'PTY wrapper readiness evidence is invalid'],
        ['wrapper-ready-marker-nonoverwriting', 'PTY wrapper readiness evidence is invalid'],
      ] as const) {
        const marker = join(fixtureParent, `publication-${fault}-${fixtureSequence}`)
        fixtureSequence += 1
        await expect(
          runInPty({
            cliPath: process.execPath,
            args: ['-e', `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "spawned")`],
            columns: 40,
            env: {},
            fault,
            input: Buffer.alloc(0),
          }),
        ).rejects.toThrow(new RegExp(`^${message}$`, 'u'))
        expect(existsSync(marker)).toBe(false)
      }
    } else {
      await expect(
        runInPty({
          cliPath: process.execPath,
          args: ['-e', 'process.exit(0)'],
          columns: 40,
          env: {},
          fault: 'outer-output-processing',
          input: Buffer.alloc(0),
        }),
      ).rejects.toThrow(/^PTY outer transport fault is not applicable$/u)
      await expect(
        runInPty({
          cliPath: process.execPath,
          args: ['-e', 'process.exit(0)'],
          columns: 40,
          env: {},
          fault: 'typescript-missing',
          input: Buffer.alloc(0),
        }),
      ).rejects.toThrow(/^PTY transcript fault is not applicable$/u)
    }
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

    let hardTimeout: unknown
    try {
      await runInPty({
        cliPath: process.execPath,
        args: ['-e', 'setInterval(()=>{},1000)'],
        columns: 40,
        env: {},
        input: Buffer.alloc(0),
        timeoutMs: 100,
      })
    } catch (error) {
      hardTimeout = error
    }
    expect(hardTimeout).toBeInstanceOf(Error)
    expect(hardTimeout).not.toBeInstanceOf(AggregateError)
    expect((hardTimeout as Error).message).toBe('PTY capture timed out')
    expect(readPtyTimeoutPhase(hardTimeout)).toBe('hard')

    const adapter = detectScriptAdapter()
    if (adapter.family === 'bsd') {
      const marker = join(fixtureParent, `pre-release-timeout-${fixtureSequence}`)
      fixtureSequence += 1
      let delayedHardTimeout: unknown
      try {
        await runInPty({
          cliPath: process.execPath,
          args: ['-e', `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "spawned")`],
          columns: 40,
          env: {},
          fault: 'outer-release-publication-delay',
          input: Buffer.alloc(0),
          timeoutMs: 100,
        })
      } catch (error) {
        delayedHardTimeout = error
      }
      expect(delayedHardTimeout).toBeInstanceOf(Error)
      expect(delayedHardTimeout).not.toBeInstanceOf(AggregateError)
      expect((delayedHardTimeout as Error).message).toBe('PTY capture timed out')
      expect(readPtyTimeoutPhase(delayedHardTimeout)).toBe('hard')
      expect(existsSync(marker)).toBe(false)
    }
  }, 20_000)

  it.each(['overflow', 'timeout'] as const)(
    'removes a uniquely identified descendant after %s',
    async (failure) => {
      const adapter = detectScriptAdapter()
      const marker = join(fixtureParent, `descendant-${failure}-${fixtureSequence}`)
      fixtureSequence += 1
      const source = [
        'const {spawn}=require("node:child_process")',
        'const {closeSync,constants,openSync,writeFileSync,writeSync}=require("node:fs")',
        'const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"})',
        `writeFileSync(${JSON.stringify(marker)},String(child.pid))`,
        failure === 'overflow'
          ? 'setTimeout(()=>process.stdout.write("x".repeat(4096)),50)'
          : [
              'const readiness=process.env.DEPFRESH_PTY_TIMEOUT_READINESS_PATH',
              'if(!readiness)process.exit(87)',
              'const descriptor=openSync(readiness,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600)',
              'try{writeSync(descriptor,String(child.pid)+"\\n")}finally{closeSync(descriptor)}',
              'setInterval(()=>{},1000)',
            ].join(';'),
      ].join(';')
      const promise = runInPty({
        cliPath: process.execPath,
        args: ['-e', source],
        columns: 40,
        env: {},
        input: Buffer.alloc(0),
        ...(failure === 'overflow'
          ? { outputLimit: 512 }
          : {
              ...(adapter.family === 'bsd'
                ? { fault: 'outer-release-publication-delay' as const }
                : {}),
              timeoutAfterReadyMs: 150,
              timeoutMs: 10_000,
            }),
      })
      if (failure === 'overflow') await expect(promise).rejects.toThrow(/output limit/u)
      else {
        let readinessTimeout: unknown
        try {
          await promise
        } catch (error) {
          readinessTimeout = error
        }
        expect(readinessTimeout).toBeInstanceOf(Error)
        expect(readinessTimeout).not.toBeInstanceOf(AggregateError)
        expect((readinessTimeout as Error).message).toBe('PTY capture timed out')
        expect(readPtyTimeoutPhase(readinessTimeout)).toBe('readiness')
      }
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

    expect(version.trim()).toBe('2.1.1')
  })

  it.each([40, 60, 80, 118, 175])(
    'renders hybrid success and exact safety journeys in a %i-column PTY by default',
    async (columns) => {
      let successFixture: ReturnType<typeof createVisualPlusFixture> | undefined
      let safetyFixture: ReturnType<typeof createVisualPlusFixture> | undefined
      try {
        successFixture = createFixture(`success-${columns}`)
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

        safetyFixture = createFixture(`safety-${columns}`)
        const safety = await runFixture(safetyFixture, columns, 'safety', true)
        assertJourney(safety, columns, 'safety', safetyFixture)
        assertFixtureBytes(safetyFixture, 'before')
        expect(readFileSync(safetyFixture.variants.safety.counter, 'utf8')).toBe('2')
        assertNoApplyResidue(safetyFixture.repository)
        assertGitClean(safetyFixture)
      } finally {
        try {
          if (safetyFixture) cleanupFixtureRepository(safetyFixture.repository)
        } finally {
          if (successFixture) cleanupFixtureRepository(successFixture.repository)
        }
      }
    },
    120_000,
  )

  it('renders the complete audit in an 80-column PTY with --long', async () => {
    const fixture = createFixture('long-pty')
    const result = await runReadOnlyPty(fixture, {}, false, true)

    expect(result.exitCode).toBe(0)
    expect(result.evidence.columns).toBe(80)
    expect(result.finalCursorVisible).toBe(true)
    expect(result.controls.cursorUp).toBeGreaterThan(0)
    expect(result.controls.eraseLine).toBeGreaterThan(0)
    expect(result.transcript.endsWith('Exit 0\n')).toBe(true)
    assertRunContext(result.transcript)
    assertFullReadOnlySemantics(result.transcript, fixture)
    assertFixtureBytes(fixture, 'before')
    assertGitClean(fixture)
  }, 120_000)

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
    assertHybridReadOnlySemantics(direct.stdout.toString('utf8'), fixture, 80)
    assertHybridReadOnlySemantics(slow.stdout.toString('utf8'), fixture, 80)

    assertFixtureBytes(fixture, 'before')
    assertGitClean(fixture)
  }, 120_000)

  it('rejects a duplicated same-severity ledger row that hides a canonical operation', async () => {
    const fixture = createFixture('ledger-membership-mutation')
    try {
      const result = await runDirectFixture(fixture, false)
      const transcript = result.stdout.toString('utf8')
      const mutated = transcript.replace('unique-01 [compat unknown]', 'unique-00 [compat unknown]')

      expect(result.exitCode).toBe(0)
      expect(mutated).not.toBe(transcript)
      assertHybridReviewMembership(transcript, fixture)
      expect(() => assertHybridReviewMembership(mutated, fixture)).toThrow()
      assertFixtureBytes(fixture, 'before')
      assertGitClean(fixture)
    } finally {
      cleanupFixtureRepository(fixture.repository)
    }
  }, 120_000)

  it('uses the durable direct-pipe fallback for the complete --long audit', async () => {
    const fixture = createFixture('long-direct')
    const result = await runDirectFixture(fixture, false, true)

    expect(result.exitCode).toBe(0)
    expect(result.stdout.includes(0x1b)).toBe(false)
    expect(result.stdout.includes(0x0d)).toBe(false)
    expect(result.stderr.toString('utf8')).toContain('Tip: Use --output json')
    const transcript = result.stdout.toString('utf8')
    expect(transcript.endsWith('Exit 0\n')).toBe(true)
    assertRunContext(transcript)
    assertFullReadOnlySemantics(transcript, fixture)
    assertFixtureBytes(fixture, 'before')
    assertGitClean(fixture)
  }, 120_000)

  it('retains exact compact recovery truth in the durable direct-pipe fallback', async () => {
    const fixture = createFixture('compact-recovery')
    const recovery = (
      fixture.variants as typeof fixture.variants & {
        recovery?: { environment: Record<string, string>; marker: string }
      }
    ).recovery

    expect(recovery).toBeDefined()
    if (!recovery) return
    const result = await runDirectCommand(
      [cliPath, '--cwd', fixture.repository, '--recursive', '--write', '--mode', 'major'],
      capableEnvironment(recovery.environment, {
        DEPFRESH_VISUAL_PLUS_RECOVERY_CLI: realpathSync(cliPath),
      }),
      {},
    )

    expect(result.exitCode).toBe(2)
    expect(result.stdout.includes(0x1b)).toBe(false)
    expect(result.stdout.includes(0x0d)).toBe(false)
    expect(result.stderr.toString('utf8')).toContain('Tip: Use --output json')
    const transcript = result.stdout.toString('utf8')
    expect(transcript.endsWith('Exit 2\n')).toBe(true)
    assertHybridContext(transcript, 'write')
    assertNoInternalIds(transcript)
    expect(transcript).toContain('Recovery incomplete')
    expect(transcript).toContain('Applied: none')
    expect(transcript).toContain(`Restored: ${fixture.targets[1]!.path}`)
    expect(transcript).toContain(`Unrecovered: ${fixture.targets[0]!.path}`)
    expect(transcript).toContain('Journal: retained')
    expect(transcript).not.toMatch(/^Journal: (?!retained$).+/gmu)
    for (const target of fixture.targets) expect(transcript, target.path).toContain(target.path)

    expect(JSON.parse(readFileSync(recovery.marker, 'utf8'))).toEqual({
      commitBlocked: fixture.targets[2]!.path,
      commitRenameCount: 3,
      recoveryBlocked: fixture.targets[0]!.path,
      recoveryRenameCount: 1,
    })
    for (const [index, target] of fixture.targets.entries()) {
      const actual = readFileSync(join(fixture.repository, target.path))
      const expected = index === 0 ? target.expectedAfterBytes : target.beforeBytes
      expect(actual, target.path).toEqual(expected)
    }
    expect(existsSync(join(fixture.repository, '.depfresh', 'apply.lock'))).toBe(true)
    const runs = readdirSync(join(fixture.repository, '.depfresh', 'runs'))
    expect(runs).toHaveLength(1)
    expect(
      existsSync(join(fixture.repository, '.depfresh', 'runs', runs[0]!, 'journal.json')),
    ).toBe(true)
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
      assertHybridReadOnlySemantics(result.transcript, fixture, 80)
    }
    expect(baseline.controls.sgr).toBeGreaterThan(0)
    expect(baseline.controls.cursorUp).toBeGreaterThan(0)
    expect(noColor.controls.sgr).toBe(0)
    expect(noColor.controls.cursorUp).toBeGreaterThan(0)
    expect(noColor.transcript).toBe(baseline.transcript)

    assertFixtureBytes(fixture, 'before')
    assertGitClean(fixture)
  }, 120_000)

  it.each([40, 60, 80, 118])(
    'renders the exact plain TERM=dumb hybrid signature at %i columns',
    async (columns) => {
      const fixture = createFixture(`dumb-hybrid-${columns}`)
      try {
        const result = await runReadOnlyPty(fixture, { TERM: 'dumb' }, true, false, columns)

        expect(result.exitCode).toBe(0)
        expect(result.evidence.columns).toBe(columns)
        expect(result.finalCursorVisible).toBe(true)
        expect(result.controls.sgr).toBe(0)
        expect(result.controls.cursorUp).toBe(0)
        expect(result.controls.eraseLine).toBe(0)
        assertHybridReadOnlySemantics(result.transcript, fixture, columns, true)
        for (const line of result.transcript.split('\n')) {
          expect(visualLength(line), line).toBeLessThanOrEqual(columns)
        }
        assertFixtureBytes(fixture, 'before')
        assertGitClean(fixture)
      } finally {
        cleanupFixtureRepository(fixture.repository)
      }
    },
    120_000,
  )

  describe.sequential('CI constrained PTY fallback', () => {
    let fixture: ReturnType<typeof createVisualPlusFixture> | undefined
    let result: Awaited<ReturnType<typeof runInPty>> | undefined
    let journeyReady = false
    let executionReady = false
    let semanticsReady = false
    let rawTransportReady = false
    let controlsReady = false
    let transitionsReady = false

    beforeAll(async () => {
      try {
        fixture = createFixture('ci-constrained-fallback')
        result = await runReadOnlyPty(fixture, { CI: '1' })
        journeyReady = true
      } catch {}
    }, 120_000)

    it('executes with exact PTY evidence and exit 0', () => {
      expect(journeyReady).toBe(true)
      if (!(journeyReady && result)) return
      expect(result.exitCode).toBe(0)
      expect(result.evidence.columns).toBe(80)
      expect(result.finalCursorVisible).toBe(true)
      executionReady = true
    })

    it('preserves read-only semantic output', () => {
      if (!(executionReady && fixture && result)) return
      expect(result.transcript.endsWith('Exit 0\n')).toBe(true)
      assertHybridReadOnlySemantics(result.transcript, fixture, 80)
      semanticsReady = true
    })

    it('classifies raw terminal transport without exposing capture data', () => {
      if (!(semanticsReady && result)) return
      expect(classifyRawTerminalTransport(result.rawTerminal)).toEqual({
        doubleCrlf: false,
        beforeEscape: false,
        beforeText: false,
        beforeOtherControl: false,
        trailing: false,
      })
      rawTransportReady = true
    })

    it('emits only constrained terminal controls', () => {
      if (!(rawTransportReady && result)) return
      expect(result.controls.sgr).toBe(0)
      expect(result.controls.carriageReturn).toBe(0)
      expect(result.controls.cursorUp).toBe(0)
      expect(result.controls.eraseLine).toBe(0)
      expect(result.controls.cursorHide).toBe(0)
      expect(result.controls.cursorShow).toBe(1)
      controlsReady = true
    })

    it('emits each active transition once', () => {
      if (!(controlsReady && result)) return
      expect(result.transcript).not.toMatch(/Lifecycle|\bactive\b/u)
      transitionsReady = true
    })

    it('leaves fixture bytes and Git unchanged', () => {
      if (!(transitionsReady && fixture)) return
      assertFixtureBytes(fixture, 'before')
      assertGitClean(fixture)
    })
  })

  describe.sequential('TERM=dumb constrained PTY fallback', () => {
    let fixture: ReturnType<typeof createVisualPlusFixture> | undefined
    let result: Awaited<ReturnType<typeof runInPty>> | undefined
    let captureReady = false
    let journeyReady = false
    let transportReady = false
    let lineEndingReady = false

    beforeAll(async () => {
      try {
        fixture = createFixture('dumb-constrained-fallback')
        result = await runReadOnlyPty(fixture, { TERM: 'dumb' }, true)
        captureReady = true
      } catch {}
    }, 120_000)

    it('executes with exact PTY evidence and preserves semantic output', () => {
      expect(captureReady).toBe(true)
      if (!(captureReady && fixture && result)) return
      expect(result.exitCode).toBe(0)
      expect(result.evidence.columns).toBe(80)
      expect(result.finalCursorVisible).toBe(true)
      expect(result.transcript.endsWith('Exit 0\n')).toBe(true)
      assertHybridReadOnlySemantics(result.transcript, fixture, 80, true)
      journeyReady = true
    })

    it('contains no duplicate CRCRLF transport', () => {
      if (!(journeyReady && result)) return
      expect(result.writeBoundary).toEqual(
        expectedWriteBoundary({ childStdout: { bareLf: true }, inner: { bareLf: true } }),
      )
      expect(hasDoubleCarriageReturnLineFeed(result.rawTerminal)).toBe(false)
      transportReady = true
    })

    it('contains no normalized lone carriage return', () => {
      if (!(transportReady && result)) return
      expect(result.controls.carriageReturn).toBe(0)
      lineEndingReady = true
    })

    it('preserves remaining controls transitions and read-only state', () => {
      if (!(lineEndingReady && fixture && result)) return
      expect(result.controls.sgr).toBe(0)
      expect(result.controls.cursorUp).toBe(0)
      expect(result.controls.eraseLine).toBe(0)
      expect(result.controls.cursorHide).toBe(0)
      expect(result.controls.cursorShow).toBe(1)
      expect(result.transcript).not.toMatch(/Lifecycle|\bactive\b/u)
      expect(result.transcript).toMatch(/66 packages - 616 declared - 612 eligible/u)
      expect([...result.transcript].every((character) => character.codePointAt(0)! <= 0x7f)).toBe(
        true,
      )
      assertFixtureBytes(fixture, 'before')
      assertGitClean(fixture)
    })
  })

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
    expect(result.transcript).toContain(`${hostile.sanitizedOwner} · package.json`)
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
  assertHybridContext(result.transcript, 'write')
  assertNoInternalIds(result.transcript)
  assertHybridReviewMembership(result.transcript, fixture)
  assertHybridLayoutSignature(result.transcript, columns, 'write', fixture)
  const transaction = result.transcript.slice(result.transcript.indexOf('Apply transaction'))
  const compact = result.transcript.replace(/\s+/gu, '')
  const compactTransaction = transaction.replace(/\s+/gu, '')
  expect(result.transcript).not.toContain('Lifecycle')
  expect(result.transcript).not.toMatch(/\bactive\b/u)
  if (outcome === 'success') {
    expect(result.transcript).not.toContain('Apply transaction')
    expect(result.transcript).not.toContain('Reviewed physical targets')
    expect(durableLineCount(result.transcript)).toBeGreaterThan(80)
    expect(compact).toContain('Complete·76updatesappliedacross14files')
    expect(compact).toContain('All14filesobservedattherequestedvalues·recoverynotneeded·')
    assertExactStrictWriteFinalScreen(result.transcript, columns, fixture)
  } else {
    expect(
      result.transcript.match(/^preflight · .* (?:blocked|failed|unknown)$/gmu) ?? [],
    ).toHaveLength(1)
    expect(transaction.match(/^Target /gmu) ?? []).toHaveLength(14)
    expect(transaction.match(/^Update /gmu) ?? []).toHaveLength(76)
    for (const target of fixture.targets) {
      expect(compactTransaction.split(`Target${target.path}`).length - 1, target.path).toBe(1)
    }
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function assertRunContext(transcript: string) {
  const compact = transcript.replace(/\s+/gu, '')
  expect(compact).toMatch(/Repositorylab-editor(?:·|\||-)\.(?:·|\||-)workspace/u)
  expect(compact).toContain('Packagemanagerunknown')
  expect(transcript).not.toContain('Repository unknown')
}

function assertHybridContext(transcript: string, intent: 'write' | 'read-only') {
  expect(transcript).toContain('lab-editor')
  expect(transcript).toContain('manager unknown')
  expect(transcript).toContain('workspace')
  expect(transcript).toContain(intent)
  expect(transcript).not.toContain('Repository unknown')
  expect(transcript).not.toContain('Package manager unknown')
}

function assertHybridLayoutSignature(
  transcript: string,
  width: number,
  intent: 'write' | 'read-only',
  fixture: ReturnType<typeof createVisualPlusFixture>,
) {
  const lines = transcript.split('\n')
  const majorAge = expectedFixtureAge(fixture, 432_000_000)
  const context =
    width === 40
      ? ['lab-editor · manager unknown · workspace', `major · ${intent}`]
      : [`lab-editor · manager unknown · workspace · major · ${intent}`]
  const topology =
    width === 40
      ? ['66 packages · 616 declared', '612 eligible · 76 updates · 14 files']
      : width === 60
        ? ['66 packages · 616 declared · 612 eligible · 76 updates', '14 files']
        : ['66 packages · 616 declared · 612 eligible · 76 updates · 14 files']
  const table =
    width === 40
      ? [
          '  dependencies',
          'dependency · transition · severity · age',
          'react-dropzone [compat unknown]',
          `  ^15.0.0 → ^17.0.0 · Major · ${majorAge}`,
        ]
      : width === 60
        ? [
            '  dependencies',
            'dependency              current → target   severity  age',
            `react-dropzone          ^15.0.0 → ^17.0.0  Major     ${majorAge}`,
          ]
        : width === 80
          ? [
              '  dependencies',
              'dependency                                  current → target   severity  age',
              `react-dropzone [compat unknown]             ^15.0.0 → ^17.0.0  Major     ${majorAge}`,
            ]
          : [
              '  dependencies',
              'dependency                                current  target   severity  age',
              `react-dropzone [compat unknown]           ^15.0.0  ^17.0.0  Major     ${majorAge}`,
            ]
  const risk =
    width === 40
      ? [
          'react-dropzone',
          `  ^15.0.0 → ^17.0.0 · ${majorAge}`,
          '  lab-editor, web',
          '  0 compatible · 0 incompatible',
          '  2 unknown',
          'nanoid',
          `  ^5.1.16 → ^6.0.0 · ${majorAge} · root-catalog`,
          '  0 compatible · 0 incompatible',
          '  1 unknown',
        ]
      : [
          'react-dropzone',
          `  ^15.0.0 → ^17.0.0 · ${majorAge} · lab-editor, web`,
          '  0 compatible · 0 incompatible · 2 unknown',
          'nanoid',
          `  ^5.1.16 → ^6.0.0 · ${majorAge} · root-catalog`,
          '  0 compatible · 0 incompatible · 1 unknown',
        ]
  assertOrderedExactLines(lines, [
    ...context,
    ...topology,
    'Major 3 · Minor 37 · Patch 36',
    '████████████████████████████████████████',
    'Breaking changes',
    ...risk,
    'lab-editor · package.json',
    ...table,
    ...expectedFinalLedgerSignature(width, false, fixture).header,
  ])
}

function assertPlainHybridLayoutSignature(
  transcript: string,
  width: number,
  fixture: ReturnType<typeof createVisualPlusFixture>,
) {
  const lines = transcript.split('\n')
  const majorAge = expectedFixtureAge(fixture, 432_000_000)
  const context =
    width === 40
      ? ['lab-editor - manager unknown - workspace', 'major - read-only']
      : ['lab-editor - manager unknown - workspace - major - read-only']
  const topology =
    width === 40
      ? ['66 packages - 616 declared', '612 eligible - 76 updates - 14 files']
      : width === 60
        ? ['66 packages - 616 declared - 612 eligible - 76 updates', '14 files']
        : ['66 packages - 616 declared - 612 eligible - 76 updates - 14 files']
  const table =
    width === 40
      ? [
          '  dependencies',
          'dependency - transition - severity - age',
          'react-dropzone [compat unknown]',
          `  ^15.0.0 -> ^17.0.0 - Major - ${majorAge}`,
        ]
      : width === 60
        ? [
            '  dependencies',
            'dependency             current -> target   severity  age',
            `react-dropzone         ^15.0.0 -> ^17.0.0  Major     ${majorAge}`,
          ]
        : width === 80
          ? [
              '  dependencies',
              'dependency                                 current -> target   severity  age',
              `react-dropzone [compat unknown]            ^15.0.0 -> ^17.0.0  Major     ${majorAge}`,
            ]
          : [
              '  dependencies',
              'dependency                                current  target   severity  age',
              `react-dropzone [compat unknown]           ^15.0.0  ^17.0.0  Major     ${majorAge}`,
            ]
  const risk =
    width === 40
      ? [
          'react-dropzone',
          `  ^15.0.0 -> ^17.0.0 - ${majorAge}`,
          '  lab-editor, web',
          '  0 compatible - 0 incompatible',
          '  2 unknown',
          'nanoid',
          `  ^5.1.16 -> ^6.0.0 - ${majorAge} - root-catalog`,
          '  0 compatible - 0 incompatible',
          '  1 unknown',
        ]
      : [
          'react-dropzone',
          `  ^15.0.0 -> ^17.0.0 - ${majorAge} - lab-editor, web`,
          '  0 compatible - 0 incompatible - 2 unknown',
          'nanoid',
          `  ^5.1.16 -> ^6.0.0 - ${majorAge} - root-catalog`,
          '  0 compatible - 0 incompatible - 1 unknown',
        ]
  assertOrderedExactLines(lines, [
    ...context,
    ...topology,
    'Major 3 - Minor 37 - Patch 36',
    '########################################',
    'Breaking changes',
    ...risk,
    'lab-editor - package.json',
    ...table,
    ...expectedFinalLedgerSignature(width, true, fixture).header,
  ])
}

function expectedFinalLedgerSignature(
  width: number,
  plain: boolean,
  fixture: ReturnType<typeof createVisualPlusFixture>,
) {
  const separator = plain ? ' - ' : ' · '
  const rule = (plain ? '-' : '─').repeat(width < 100 ? width : 76)
  const patchAge = expectedFixtureAge(fixture, 86_400_000)
  const catalogEvidence =
    width === 40
      ? ['  catalog root-catalog:', '  pnpm-workspace.yaml']
      : ['  catalog root-catalog: pnpm-workspace.yaml']
  if (width === 40) {
    return {
      header: [
        `root-catalog${separator}pnpm-workspace.yaml`,
        '  catalog',
        plain
          ? 'dependency - transition - severity - age'
          : 'dependency · transition · severity · age',
        rule,
      ],
      row: [
        'unique-35 [compat unknown]',
        plain
          ? `  ^1.0.0 -> ^1.0.1 - Patch - ${patchAge}`
          : `  ^1.0.0 → ^1.0.1 · Patch · ${patchAge}`,
        ...catalogEvidence,
      ],
    }
  }
  if (width === 60) {
    return {
      header: [
        `root-catalog${separator}pnpm-workspace.yaml`,
        '  catalog',
        plain
          ? 'dependency              current -> target  severity  age'
          : 'dependency               current → target  severity  age',
        rule,
      ],
      row: [
        plain
          ? `unique-35               ^1.0.0 -> ^1.0.1   Patch     ${patchAge}`
          : `unique-35                ^1.0.0 → ^1.0.1   Patch     ${patchAge}`,
        '  compat unknown',
        ...catalogEvidence,
      ],
    }
  }
  if (width === 80) {
    return {
      header: [
        `root-catalog${separator}pnpm-workspace.yaml`,
        '  catalog',
        plain
          ? 'dependency                                  current -> target  severity  age'
          : 'dependency                                   current → target  severity  age',
        rule,
      ],
      row: [
        plain
          ? `unique-35 [compat unknown]                  ^1.0.0 -> ^1.0.1   Patch     ${patchAge}`
          : `unique-35 [compat unknown]                   ^1.0.0 → ^1.0.1   Patch     ${patchAge}`,
        ...catalogEvidence,
      ],
    }
  }
  return {
    header: [
      `root-catalog${separator}pnpm-workspace.yaml`,
      '  catalog',
      'dependency                                current  target  severity  age',
      rule,
    ],
    row: [
      `unique-35 [compat unknown]                ^1.0.0   ^1.0.1  Patch     ${patchAge}`,
      ...catalogEvidence,
    ],
  }
}

function expectedFixtureAge(
  fixture: ReturnType<typeof createVisualPlusFixture>,
  ageAtFixtureClockMs: number,
) {
  const ageMs = Date.now() - (fixture.asOfMs - ageAtFixtureClockMs)
  const days = ageMs / 86_400_000
  if (days < 1) return '~0d'
  if (days < 90) return `~${Math.round(days)}d`
  if (days < 365) return `~${Math.round(days / 30)}mo`
  const years = days / 365
  return years >= 10 ? `~${Math.round(years)}y` : `~${years.toFixed(1)}y`
}

function exactTranscriptLines(transcript: string) {
  expect(transcript.endsWith('\n')).toBe(true)
  return transcript.slice(0, -1).split('\n')
}

function assertExactReadOnlyFinalScreen(
  transcript: string,
  width: number,
  plain: boolean,
  fixture: ReturnType<typeof createVisualPlusFixture>,
) {
  const receipt =
    width === 40
      ? [
          plain
            ? 'Review complete - 76 updates across 14 f'
            : 'Review complete · 76 updates across 14 f',
          plain ? 'iles - write not attempted' : 'iles · write not attempted',
          'Exit 0',
        ]
      : width === 60
        ? [
            plain
              ? 'Review complete - 76 updates across 14 files - write not att'
              : 'Review complete · 76 updates across 14 files · write not att',
            'empted',
            'Exit 0',
          ]
        : [
            plain
              ? 'Review complete - 76 updates across 14 files - write not attempted'
              : 'Review complete · 76 updates across 14 files · write not attempted',
            'Exit 0',
          ]
  const expected = [...expectedFinalLedgerSignature(width, plain, fixture).row, ...receipt]
  expect(exactTranscriptLines(transcript).slice(-expected.length)).toEqual(expected)
}

function assertExactStrictWriteFinalScreen(
  transcript: string,
  width: number,
  fixture: ReturnType<typeof createVisualPlusFixture>,
) {
  const receipt =
    width === 40
      ? [
          'Complete · 76 updates applied across 14',
          'files',
          'All 14 files observed at the requested v',
          'alues · recovery not needed · <elapsed>',
          'Exit 0',
        ]
      : width === 60
        ? [
            'Complete · 76 updates applied across 14 files',
            'All 14 files observed at the requested values · recovery not',
            ' needed · <elapsed>',
            'Exit 0',
          ]
        : [
            'Complete · 76 updates applied across 14 files',
            'All 14 files observed at the requested values · recovery not needed · <elapsed>',
            'Exit 0',
          ]
  const expected = [...expectedFinalLedgerSignature(width, false, fixture).row, ...receipt]
  const actual = exactTranscriptLines(transcript).map((line) =>
    line.replace(/\b(?:\d+ms|\d+(?:\.\d+)?s)\b/gu, '<elapsed>'),
  )
  expect(actual.slice(-expected.length)).toEqual(expected)
}

function assertOrderedExactLines(lines: readonly string[], expected: readonly string[]) {
  let cursor = 0
  for (const line of expected) {
    const index = lines.indexOf(line, cursor)
    expect(index, `missing exact line after ${cursor}: ${line}`).toBeGreaterThanOrEqual(cursor)
    cursor = index + 1
  }
}

function assertHybridReviewMembership(
  transcript: string,
  fixture: ReturnType<typeof createVisualPlusFixture>,
) {
  const lines = transcript.split('\n')
  const ledgerStart = lines.findIndex(
    (line) => line === 'lab-editor · package.json' || line === 'lab-editor - package.json',
  )
  expect(ledgerStart).toBeGreaterThan(-1)
  const ledger = lines.slice(ledgerStart)
  const expected = expectedHumanLedgerSignatures(fixture)
  const actual = parseHumanLedgerSignatures(ledger, expected)

  expect(expected).toHaveLength(76)
  expect(new Set(expected.map((signature) => signature.ownerKey))).toHaveLength(15)
  expect(actual).toEqual(expected)
}

interface HumanLedgerSignature {
  readonly ownerKey: string
  readonly owner: string
  readonly physicalTarget: string
  readonly source: string
  readonly name: string
  readonly current: string
  readonly target: string
  readonly severity: string
}

function expectedHumanLedgerSignatures(
  fixture: ReturnType<typeof createVisualPlusFixture>,
): HumanLedgerSignature[] {
  const ownerLabels = new Map<string, string>()
  for (const declaration of fixture.selectedDeclarations) {
    const label =
      declaration.ownerType === 'catalog'
        ? declaration.catalogName
        : JSON.parse(readFileSync(join(fixture.repository, declaration.physicalTarget), 'utf8'))
            .name
    ownerLabels.set(`${declaration.ownerType}:${label}:${declaration.physicalTarget}`, label)
  }
  return fixture.selectedDeclarations.map((declaration) => {
    const label =
      declaration.ownerType === 'catalog'
        ? declaration.catalogName
        : JSON.parse(readFileSync(join(fixture.repository, declaration.physicalTarget), 'utf8'))
            .name
    return {
      ownerKey: `${declaration.ownerType}:${label}:${declaration.physicalTarget}`,
      owner: ownerLabels.get(`${declaration.ownerType}:${label}:${declaration.physicalTarget}`)!,
      physicalTarget: declaration.physicalTarget,
      source: declaration.ownerType === 'catalog' ? 'catalog' : 'dependencies',
      name: declaration.name,
      current: declaration.current,
      target: declaration.target,
      severity: `${declaration.diff.slice(0, 1).toUpperCase()}${declaration.diff.slice(1)}`,
    }
  })
}

function parseHumanLedgerSignatures(
  ledger: readonly string[],
  expected: readonly HumanLedgerSignature[],
): HumanLedgerSignature[] {
  const separator = ledger.includes('lab-editor · package.json') ? ' · ' : ' - '
  const owners = new Map(expected.map((signature) => [signature.ownerKey, signature]))
  const names = [...new Set(expected.map((signature) => signature.name))].sort(
    (left, right) => right.length - left.length || left.localeCompare(right),
  )
  const signatures: HumanLedgerSignature[] = []
  let owner: HumanLedgerSignature | undefined
  let source: string | undefined
  for (let index = 0; index < ledger.length; index += 1) {
    const line = ledger[index]!
    const ownerHeading = [...owners.values()].find(
      (candidate) =>
        line === `${candidate.owner}${separator}${candidate.physicalTarget}` ||
        (line === candidate.owner && ledger[index + 1] === candidate.physicalTarget),
    )
    if (ownerHeading) {
      owner = ownerHeading
      source = undefined
      continue
    }
    if (line === '  dependencies' || line === '  catalog') {
      source = line.slice(2)
      continue
    }
    const name = names.find((candidate) => line === candidate || line.startsWith(`${candidate} `))
    if (!name) continue
    if (!(owner && source)) throw new Error(`Ledger context is missing for ${name}`)
    const transition = `${line}\n${ledger[index + 1] ?? ''}`.match(
      /(\^[^\s]+)\s*(?:(?:→|->)\s*)?(\^[^\s]+)\s*(?:[·-]\s*)?(Major|Minor|Patch)\b/u,
    )
    if (!transition) throw new Error(`Ledger transition is missing for ${name}`)
    signatures.push({
      ownerKey: owner.ownerKey,
      owner: owner.owner,
      physicalTarget: owner.physicalTarget,
      source,
      name,
      current: transition[1]!,
      target: transition[2]!,
      severity: transition[3]!,
    })
  }
  return signatures
}

function assertNoInternalIds(transcript: string) {
  expect(transcript).not.toMatch(/Operation ID|Owner ID|Dependency ID/u)
  expect(transcript).not.toMatch(/operation-|dependency:|package:|source:/iu)
}

function durableLineCount(transcript: string) {
  return transcript.split('\n').filter((line) => line.length > 0).length
}

function logicalFieldStarts(transcript: string, label: string) {
  const lines = transcript.split('\n')
  return lines.filter(
    (line, index) => line.startsWith(label) && !lines[index - 1]?.startsWith(label),
  ).length
}

function assertHybridReadOnlySemantics(
  transcript: string,
  fixture: ReturnType<typeof createVisualPlusFixture>,
  width: number,
  plain = false,
) {
  assertHybridContext(transcript, 'read-only')
  assertNoInternalIds(transcript)
  assertHybridReviewMembership(transcript, fixture)
  if (plain) assertPlainHybridLayoutSignature(transcript, width, fixture)
  else assertHybridLayoutSignature(transcript, width, 'read-only', fixture)
  assertExactReadOnlyFinalScreen(transcript, width, plain, fixture)
  expect(durableLineCount(transcript)).toBeGreaterThan(80)
  expect(transcript).not.toMatch(
    /Lifecycle|Update preview|audit preview|omitted|more updates|Reviewed physical targets/iu,
  )
  expect(transcript).not.toMatch(/\bactive\b/u)
  expect(transcript.replace(/\s+/gu, '')).toContain(
    plain
      ? 'Reviewcomplete-76updatesacross14files-writenotattempted'
      : 'Reviewcomplete·76updatesacross14files·writenotattempted',
  )
}

function assertFullReadOnlySemantics(
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
  const transaction = section(transcript, 'Reviewed physical targets\n', 'Review complete\n')
  expect(transaction.match(/^Target /gmu) ?? []).toHaveLength(fixture.targets.length)
  for (const target of fixture.targets) {
    expect(transaction, target.path).toMatch(
      new RegExp(`^Target ${escapeRegExp(target.path)}(?: ·| \\|)`, 'mu'),
    )
  }
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

function cleanupFixtureRepository(repository: string) {
  const canonicalParent = realpathSync(fixtureParent)
  const relativeRepository = relative(canonicalParent, repository)
  if (
    !fixtureParent ||
    relativeRepository.length === 0 ||
    isAbsolute(relativeRepository) ||
    relativeRepository.split(/[\\/]/u)[0] === '..'
  ) {
    throw new Error('Visual+ fixture cleanup escaped its temporary parent')
  }
  rmSync(repository, { recursive: true, force: true })
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
  diagnoseChildWrites = false,
  long = false,
  columns = 80,
) {
  return runInPty({
    cliPath: process.execPath,
    args: [
      cliPath,
      '--cwd',
      fixture.repository,
      '--recursive',
      '--mode',
      'major',
      ...(long ? ['--long'] : []),
    ],
    columns,
    diagnoseChildWrites,
    env: capableEnvironment(fixture.variants.success.environment, overrides),
    input: Buffer.alloc(0),
  })
}

function expectedWriteBoundary(options: {
  childStdout?: Partial<ReturnType<typeof emptyLineEndingEvidence>>
  inner?: Partial<ReturnType<typeof emptyLineEndingEvidence>>
  stateChanged?: boolean
  writeModes?: Partial<ReturnType<typeof availableOutputModes>>
}) {
  const stdout = { ...emptyLineEndingEvidence(), ...options.childStdout }
  const stderr = emptyLineEndingEvidence()
  const start = availableOutputModes(false, false)
  const writes = {
    ...availableOutputModes(false, false),
    ...options.writeModes,
    observed: true,
    stateChanged: options.stateChanged ?? false,
  }
  const end = availableOutputModes(false, false)
  return {
    child: { combined: { ...stdout }, stderr, stdout },
    inner: { ...emptyLineEndingEvidence(), ...options.inner },
    modes: { end, start, stateChanged: options.stateChanged ?? false, writes },
  }
}

function emptyLineEndingEvidence() {
  return {
    bareLf: false,
    beforeEscape: false,
    beforeOtherControl: false,
    beforeText: false,
    doubleCrlf: false,
    singleCrlf: false,
    trailing: false,
  }
}

function availableOutputModes(newlineMapping: boolean, outputProcessing: boolean) {
  return {
    available: true,
    canonicalInput: false,
    carriageReturnMapping: false,
    carriageReturnSuppression: false,
    echo: false,
    newlineMapping,
    newlineReturn: false,
    outputProcessing,
  }
}

function runDirectFixture(
  fixture: ReturnType<typeof createVisualPlusFixture>,
  slow: boolean,
  long = false,
) {
  return runDirectCommand(
    [
      cliPath,
      '--cwd',
      fixture.repository,
      '--recursive',
      '--mode',
      'major',
      ...(long ? ['--long'] : []),
    ],
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
