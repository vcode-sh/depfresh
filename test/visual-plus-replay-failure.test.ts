import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as replayFailure from '../scripts/visual-plus-replay-failure.mjs'

interface ReplayFailureApi {
  MAX_VISUAL_PLUS_REPORT_BYTES: number
  visualPlusReplayFailureMessage(reportPath: string): string
}

const replayFailureApi = replayFailure as unknown as ReplayFailureApi
const { classifyVisualPlusReplayFailure } = replayFailure
const roots: string[] = []
const expectedReportCap = 256 * 1024
const unclassifiedMessage = 'Installed Visual+ replay failed (classification: unclassified)'

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

function report(fullNames: string[]) {
  return {
    numFailedTests: fullNames.length,
    testResults: [
      {
        assertionResults: fullNames.map((fullName) => ({
          failureMessages: ['private path /Users/runner/work and raw child output'],
          fullName,
          status: 'failed',
        })),
      },
    ],
  }
}

describe('installed Visual+ replay failure classification', () => {
  it('uses a fixed report byte cap and a fixed bounded failure message', () => {
    expect(replayFailureApi.MAX_VISUAL_PLUS_REPORT_BYTES).toBe(expectedReportCap)
    expect(replayFailureApi.visualPlusReplayFailureMessage).toBeTypeOf('function')
    expect(Buffer.byteLength(unclassifiedMessage)).toBeLessThanOrEqual(64)
  })

  it.each([
    [
      'Visual+ PTY adapter removes a uniquely identified descendant after timeout',
      'pty-process-cleanup',
    ],
    [
      'Visual+ PTY adapter surfaces cleanup fault signaling-failure while preserving the timeout primary error',
      'pty-process-cleanup',
    ],
    [
      'Visual+ PTY adapter fails closed on exact wrapper fault malformed-completion',
      'pty-evidence',
    ],
    [
      'Visual+ PTY adapter keeps one owned ONLCR transform and transports explicit CRLF unchanged',
      'pty-transport',
    ],
    [
      'Visual+ built CLI renders exact success and safety journeys in a 80-column PTY',
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
  ])('maps the trusted exact title %s to %s', (fullName, expected) => {
    expect(classifyVisualPlusReplayFailure(report([fullName]))).toBe(expected)
  })

  it('fails closed without reflecting untrusted report content', () => {
    const privateValue = '/Users/runner/work/private-repository raw-secret-token'
    const classification = classifyVisualPlusReplayFailure({
      numFailedTests: 1,
      testResults: [
        {
          assertionResults: [
            {
              failureMessages: [privateValue],
              fullName: privateValue,
              status: 'failed',
            },
          ],
        },
      ],
    })

    expect(classification).toBe('unclassified')
    expect(classification).not.toContain(privateValue)
    expect(classification.length).toBeLessThanOrEqual(32)
  })

  it.each([
    undefined,
    null,
    {},
    { numFailedTests: 1, testResults: [] },
    {
      numFailedTests: 1,
      testResults: [{ assertionResults: [{ fullName: 'trusted-looking', status: 'passed' }] }],
    },
  ])('returns unclassified for malformed or incomplete evidence %#', (input) => {
    expect(classifyVisualPlusReplayFailure(input)).toBe('unclassified')
  })

  it('returns a fixed multiple-known label for failures in distinct trusted categories', () => {
    expect(
      classifyVisualPlusReplayFailure(
        report([
          'Visual+ PTY adapter removes a uniquely identified descendant after overflow',
          'Visual+ built CLI uses durable direct and slow-pipe fallbacks without losing read-only semantic output',
        ]),
      ),
    ).toBe('multiple-known')
  })

  it('classifies a bounded regular report without reflecting its private failure message', () => {
    const root = temporaryRoot()
    const reportPath = join(root, 'report.json')
    const privateValue = 'raw-private-child-output'
    writeFileSync(
      reportPath,
      JSON.stringify({
        ...report(['Visual+ PTY adapter removes a uniquely identified descendant after timeout']),
        privateValue,
      }),
    )

    const message = replayFailureApi.visualPlusReplayFailureMessage(reportPath)

    expect(message).toBe('Installed Visual+ replay failed (classification: pty-process-cleanup)')
    expect(message).not.toContain(privateValue)
    expect(Buffer.byteLength(message)).toBeLessThanOrEqual(80)
  })

  it('rejects unsafe reports before their trusted-looking private content can classify', () => {
    const root = temporaryRoot()
    const missingPath = join(root, 'private-missing-report.json')
    const directoryPath = join(root, 'private-report-directory')
    const trustedTargetPath = join(root, 'private-trusted-target.json')
    const symlinkPath = join(root, 'private-report-symlink.json')
    const oversizedPath = join(root, 'private-oversized-report.json')
    const untrustedPath = join(root, 'private-untrusted-report.json')
    const privateValue = '/Users/runner/work/private-secret-child-output'
    const trustedReport = report([
      'Visual+ PTY adapter removes a uniquely identified descendant after timeout',
    ])
    mkdirSync(directoryPath)
    writeFileSync(trustedTargetPath, JSON.stringify({ ...trustedReport, privateValue }))
    symlinkSync(trustedTargetPath, symlinkPath)
    writeFileSync(
      oversizedPath,
      JSON.stringify({
        ...trustedReport,
        privateValue: privateValue.repeat(Math.ceil((expectedReportCap + 1) / privateValue.length)),
      }),
    )
    writeFileSync(untrustedPath, JSON.stringify(report([privateValue])))

    for (const reportPath of [
      missingPath,
      directoryPath,
      symlinkPath,
      oversizedPath,
      untrustedPath,
    ]) {
      const message = replayFailureApi.visualPlusReplayFailureMessage(reportPath)
      expect(message, reportPath).toBe(unclassifiedMessage)
      expect(message, reportPath).not.toContain(privateValue)
      expect(message, reportPath).not.toContain(reportPath)
      expect(Buffer.byteLength(message), reportPath).toBeLessThanOrEqual(64)
    }
  })
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'depfresh-visual-plus-replay-failure-'))
  roots.push(root)
  return root
}
