import { describe, expect, it } from 'vitest'
import { classifyVisualPlusReplayFailure } from '../scripts/visual-plus-replay-failure.mjs'

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
      'Visual+ built CLI renders exact success and safety journeys in a 80-column PTY',
      'product-journey',
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
          'Visual+ built CLI uses durable public fallbacks without losing read-only semantic output',
        ]),
      ),
    ).toBe('multiple-known')
  })
})
