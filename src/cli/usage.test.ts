import { describe, expect, it } from 'vitest'
import { DOCUMENTATION_URL, REPOSITORY_URL, withHelpLinks } from './usage'

describe('withHelpLinks', () => {
  it('appends docs and repository links to usage output', () => {
    const output = withHelpLinks('usage body')

    expect(output).toContain('usage body')
    expect(output).toContain(`Docs: ${DOCUMENTATION_URL}`)
    expect(output).toContain(`GitHub: ${REPOSITORY_URL}`)
  })
})
