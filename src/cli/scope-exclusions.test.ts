import { describe, expect, it } from 'vitest'
import { parseInvocationScopeExclusions } from './scope-exclusions'

describe('parseInvocationScopeExclusions', () => {
  it('parses exact repeated literals, canonicalizes workspace paths, and deduplicates first-seen', () => {
    expect(
      parseInvocationScopeExclusions([
        '--exclude-workspace',
        './apps/admin/',
        '--exclude-catalog=mobile,v2',
        '--exclude-workspace=apps/admin',
        '--exclude-workspace',
        '.',
        '--exclude-catalog',
        'mobile.v2',
        '--exclude-catalog=mobile,v2',
        '--exclude-catalog=-preview',
        '--exclude-catalog=zażółć space',
      ]),
    ).toEqual({
      workspaces: ['apps/admin', '.'],
      catalogs: ['mobile,v2', 'mobile.v2', '-preview', 'zażółć space'],
    })
  })

  it.each([
    ['workspace absolute path', ['--exclude-workspace', '/apps/admin']],
    ['workspace traversal', ['--exclude-workspace', 'apps/../admin']],
    ['workspace backslash', ['--exclude-workspace', 'apps\\admin']],
    ['empty workspace', ['--exclude-workspace=']],
    ['empty catalog', ['--exclude-catalog=']],
    ['catalog control text', ['--exclude-catalog', 'mobile\u001b[31m']],
    ['catalog bidi text', ['--exclude-catalog', 'mobile\u202eadmin']],
    ['catalog left-to-right mark', ['--exclude-catalog', 'mobile\u200eadmin']],
    ['catalog absolute path', ['--exclude-catalog', '/private/catalog']],
    ['catalog credential text', ['--exclude-catalog', 'token=not-a-catalog']],
  ])('rejects unsafe %s without echoing the supplied value', (_label, rawArgs) => {
    let caught: unknown
    try {
      parseInvocationScopeExclusions(rawArgs)
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({ reason: 'SELECTION_TARGET_UNPROVEN' })
    expect(String(caught)).not.toContain(rawArgs.at(-1) ?? '')
  })
})
