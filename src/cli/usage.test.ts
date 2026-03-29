import { describe, expect, it, vi } from 'vitest'

const { renderUsageMock } = vi.hoisted(() => ({
  renderUsageMock: vi.fn(),
}))

vi.mock('citty', () => ({
  renderUsage: renderUsageMock,
}))

describe('withHelpLinks', () => {
  it('appends docs and repository links to usage output', async () => {
    renderUsageMock.mockResolvedValue('usage body')

    const { DOCUMENTATION_URL, REPOSITORY_URL, withHelpLinks } = await import('./usage')

    const output = withHelpLinks('usage body')

    expect(output).toContain('usage body')
    expect(output).toContain(`Docs: ${DOCUMENTATION_URL}`)
    expect(output).toContain(`GitHub: ${REPOSITORY_URL}`)
  })
})

describe('showUsageWithLinks', () => {
  it('prints rendered usage with links', async () => {
    renderUsageMock.mockResolvedValueOnce('usage body')
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { showUsageWithLinks } = await import('./usage')
    await showUsageWithLinks({} as never)

    expect(renderUsageMock).toHaveBeenCalledOnce()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Docs:'))
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('GitHub:'))

    consoleSpy.mockRestore()
  })

  it('propagates renderUsage errors', async () => {
    renderUsageMock.mockRejectedValueOnce(new Error('render failed'))

    const { showUsageWithLinks } = await import('./usage')

    await expect(showUsageWithLinks({} as never)).rejects.toThrow('render failed')
  })
})
