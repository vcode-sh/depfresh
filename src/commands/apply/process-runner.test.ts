import { spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { resolveExecutable, runProcess, runResolvedProcess } from './process-runner'

describe('Plan 020 no-shell process runner', () => {
  it('passes hostile text as one inert argv value and strips unrelated environment secrets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-process-literal-'))
    const output = join(root, 'output.json')
    const marker = join(root, 'injected')
    const hostile = `value;touch ${marker}`
    const script = [
      "const { writeFileSync } = require('node:fs')",
      'writeFileSync(process.argv[1], JSON.stringify({ arg: process.argv[2], secret: process.env.DEPFRESH_SECRET }))',
    ].join(';')

    const result = await runProcess({
      executable: process.execPath,
      args: ['-e', script, output, hostile],
      cwd: root,
      timeoutMs: 2_000,
      inheritedEnv: { ...process.env, DEPFRESH_SECRET: 'token=must-not-leak' },
    })

    expect(result).toMatchObject({ termination: 'exit', exitCode: 0, reason: 'PROCESS_EXITED' })
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual({ arg: hostile })
    expect(existsSync(marker)).toBe(false)
    expect(JSON.stringify(result)).not.toContain('must-not-leak')
  })

  it('reports unavailable executables without a shell fallback', async () => {
    const result = await runProcess({
      executable: 'definitely-not-a-depfresh-command',
      args: ['; touch forbidden'],
      cwd: process.cwd(),
      timeoutMs: 10_000,
      inheritedEnv: { PATH: '' },
    })

    expect(result).toEqual({
      termination: 'unavailable',
      reason: 'EXECUTABLE_UNAVAILABLE',
      terminationConfirmed: true,
    })
  })

  it('distinguishes a nonzero exit from a signal', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-process-exit-signal-'))
    const exited = await runProcess({
      executable: process.execPath,
      args: ['-e', 'process.exit(23)'],
      cwd: root,
      timeoutMs: 10_000,
    })
    const signaled = await runProcess({
      executable: process.execPath,
      args: ['-e', "process.kill(process.pid, 'SIGTERM')"],
      cwd: root,
      timeoutMs: 10_000,
    })

    expect(exited).toMatchObject({
      termination: 'exit',
      exitCode: 23,
      reason: 'PROCESS_EXITED',
      terminationConfirmed: true,
    })
    expect(signaled).toMatchObject({
      termination: 'signal',
      signal: 'SIGTERM',
      reason: 'PROCESS_SIGNALED',
      terminationConfirmed: true,
    })
  })

  it('does not attribute a concurrent process launched by a baseline process', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-process-concurrent-'))
    const running = runProcess({
      executable: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 200)'],
      cwd: root,
      timeoutMs: 2_000,
    })
    const unrelated = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 500)'], {
      cwd: '/',
      detached: true,
      env: {},
      stdio: 'ignore',
    })
    unrelated.unref()

    const result = await running
    if (unrelated.pid) {
      try {
        process.kill(unrelated.pid, 'SIGKILL')
      } catch {}
    }

    expect(result).toMatchObject({
      termination: 'exit',
      exitCode: 0,
      reason: 'PROCESS_EXITED',
      terminationConfirmed: true,
    })
  })

  it('kills a timed-out process group before descendants can mutate the repository', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-process-timeout-'))
    const marker = join(root, 'late-write')
    const childScript = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 400)`
    const parentScript = [
      "const { spawn } = require('node:child_process')",
      `spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { stdio: 'ignore' })`,
      'setInterval(() => {}, 1000)',
    ].join(';')

    const result = await runProcess({
      executable: process.execPath,
      args: ['-e', parentScript],
      cwd: root,
      timeoutMs: 50,
      terminationGraceMs: 50,
    })
    await delay(650)

    expect(result).toMatchObject({
      termination: 'timeout',
      reason: 'PROCESS_TIMEOUT',
      terminationConfirmed: true,
    })
    expect(existsSync(marker)).toBe(false)
  })

  it('never reports a successful exit while a detached descendant remains alive', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-process-descendant-'))
    const marker = join(root, 'late-write')
    const childScript = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 1500)`
    const parentScript = [
      "const { spawn } = require('node:child_process')",
      `spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { detached: true, stdio: 'ignore' }).unref()`,
    ].join(';')

    const result = await runProcess({
      executable: process.execPath,
      args: ['-e', parentScript],
      cwd: root,
      timeoutMs: 2_000,
      terminationGraceMs: 50,
    })
    await delay(1_700)

    expect(result).toMatchObject({
      termination: 'unknown',
      reason: 'PROCESS_DESCENDANTS_SURVIVED',
      terminationConfirmed: true,
    })
    expect(existsSync(marker)).toBe(false)
  })

  it('fails closed when a detached descendant strips the supervision marker', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-process-unattributed-'))
    const marker = join(root, 'late-write')
    const childScript = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 400)`
    const parentScript = [
      "const { spawn } = require('node:child_process')",
      `spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { detached: true, env: {}, cwd: '/', stdio: 'ignore' }).unref()`,
    ].join(';')

    const result = await runProcess({
      executable: process.execPath,
      args: ['-e', parentScript],
      cwd: root,
      timeoutMs: 2_000,
      terminationGraceMs: 50,
    })
    await delay(650)

    expect(result).toMatchObject({
      termination: 'unknown',
      reason: 'PROCESS_DESCENDANTS_SURVIVED',
      terminationConfirmed: false,
    })
    expect(existsSync(marker)).toBe(true)
  })

  it('scans for detached descendants after a timeout before confirming recovery safety', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-process-timeout-detached-'))
    const marker = join(root, 'late-write')
    const childScript = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 400)`
    const parentScript = [
      "const { spawn } = require('node:child_process')",
      `spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { detached: true, env: {}, cwd: '/', stdio: 'ignore' }).unref()`,
      'setInterval(() => {}, 1000)',
    ].join(';')

    const result = await runProcess({
      executable: process.execPath,
      args: ['-e', parentScript],
      cwd: root,
      timeoutMs: 200,
      terminationGraceMs: 50,
    })
    await delay(650)

    expect(result).toMatchObject({
      termination: 'unknown',
      reason: 'PROCESS_DESCENDANTS_SURVIVED',
      terminationConfirmed: false,
    })
    expect(existsSync(marker)).toBe(true)
  })

  it('escalates independently of close when the process ignores SIGTERM', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-process-escalation-'))
    const startedAt = Date.now()
    const result = await runProcess({
      executable: process.execPath,
      args: ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      cwd: root,
      timeoutMs: 50,
      terminationGraceMs: 50,
    })

    expect(result).toMatchObject({
      termination: 'timeout',
      reason: 'PROCESS_TIMEOUT',
      terminationConfirmed: true,
    })
    expect(Date.now() - startedAt).toBeLessThan(2_000)
  })

  it('fails closed when the resolved executable identity changes before spawn', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-process-swap-'))
    const bin = join(root, 'bin')
    const replacement = join(root, 'replacement')
    writeFileSync(bin, '#!/bin/sh\nexit 0\n')
    writeFileSync(replacement, '#!/bin/sh\nexit 0\n')
    chmodSync(bin, 0o755)
    chmodSync(replacement, 0o755)
    const resolved = resolveExecutable(bin, root, {
      PATH: process.env.PATH ?? ''.split(delimiter).join(delimiter),
    })
    expect('reason' in resolved).toBe(false)
    if ('reason' in resolved) return
    renameSync(replacement, bin)

    const result = await runResolvedProcess(resolved, [], {
      cwd: root,
      timeoutMs: 10_000,
    })

    expect(result).toEqual({
      termination: 'unavailable',
      reason: 'EXECUTABLE_CHANGED',
      terminationConfirmed: true,
    })
  })

  it('bounds captured output and never returns it for ordinary commands', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-process-output-'))
    const result = await runProcess({
      executable: process.execPath,
      args: ['-e', "process.stdout.write('token=hidden\\n')"],
      cwd: root,
      timeoutMs: 10_000,
    })
    const version = await runProcess({
      executable: process.execPath,
      args: ['-e', "process.stdout.write('v24.15.0\\n')"],
      cwd: root,
      timeoutMs: 10_000,
      captureStdout: true,
    })

    expect(result).not.toHaveProperty('stdout')
    expect(JSON.stringify(result)).not.toContain('hidden')
    expect(version).toMatchObject({ stdout: 'v24.15.0' })
  })

  it('supports an explicitly bounded private verifier capture in an isolated environment', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-process-verifier-'))
    const isolatedHome = mkdtempSync(join(tmpdir(), 'depfresh-process-verifier-home-'))
    const payload = 'x'.repeat(128 * 1024)
    const result = await runProcess({
      executable: process.execPath,
      args: [
        '-e',
        `process.stdout.write(JSON.stringify({home:process.env.HOME,cache:process.env.npm_config_cache,secret:process.env.DEPFRESH_SECRET,payload:${JSON.stringify(payload)}}));process.stderr.write(JSON.stringify({error:{code:'ENETUNREACH'}}))`,
      ],
      cwd: root,
      timeoutMs: 10_000,
      inheritedEnv: { ...process.env, DEPFRESH_SECRET: 'must-not-cross' },
      environmentOverrides: {
        HOME: isolatedHome,
        npm_config_cache: join(isolatedHome, 'npm-cache'),
      },
      captureStdout: true,
      captureStderr: true,
      redactCapturedStdout: false,
      maxOutputBytes: 256 * 1024,
      maxCaptureBytes: 256 * 1024,
    })

    expect(result).toMatchObject({ termination: 'exit', exitCode: 0 })
    expect(JSON.parse(result.stdout ?? '{}')).toEqual({
      home: isolatedHome,
      cache: join(isolatedHome, 'npm-cache'),
      payload,
    })
    expect(JSON.parse(result.stderr ?? '{}')).toEqual({ error: { code: 'ENETUNREACH' } })
    expect(JSON.stringify(result)).not.toContain('must-not-cross')
  })
})
