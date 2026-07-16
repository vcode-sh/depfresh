import { describe, expect, it } from 'vitest'
import { isContractSafeArgv } from './sanitize'

describe('contract argv safety', () => {
  it.each([
    ['curl', '-ualice:pw'],
    ['curl', '-Uproxy:pw'],
    ['curl', 'ftp://alice:pw@example.test/file'],
    ['curl', 'sftp://alice:pw@example.test/file'],
    ['curl', 'alice:pw@example.test/file'],
    ['curl', '-H', 'X-Api-Key: literal-secret'],
    ['curl', '--header=X-Api-Key:literal-secret'],
    ['tool', '--passphrase=literal-secret'],
    ['curl', 'ftp://alice:pw@[::1]/file'],
    ['curl', 'ftp://alice:pw@例子.test/file'],
    ['curl', '-H', 'Cookie: session=literal-secret'],
    ['curl', '--cookie', 'session=literal-secret'],
    ['curl', '-bsession=literal-secret'],
    ['curl', '--proxy-header', 'X-Api-Key: abc123'],
    ['curl', '--proxy-header=X-Api-Key:abc123'],
    ['openssl', 'enc', '-pass', 'pass:abc123'],
    ['openssl', 'enc', '-passin', 'pass:abc123'],
    ['openssl', 'enc', '-passout', 'pass:abc123'],
    ['curl', 'ftp://:pw@example.test/file'],
    ['curl', 'ftp://alice:p@ss@example.test/file'],
    ['curl', '--cert', 'cert.pem:pw'],
    ['curl', '-Ecert.pem:pw'],
    ['env', 'curl', '-HX-Api-Key:abc123'],
    ['curl', '-sHX-Session:zzz'],
    ['curl', '-sHCookie:zzz'],
    ['http', 'GET', 'example.test', 'X-Api-Key:zzz'],
    ['http', 'GET', 'example.test', 'Cookie:session=zzz'],
    ['tool', 'X-Api-Key=zzz'],
  ])('rejects credential-bearing argv %#', (...argv) => {
    expect(isContractSafeArgv(argv)).toBe(false)
  })

  it('retains ordinary public package and user-agent arguments', () => {
    expect(
      isContractSafeArgv([
        'tool',
        '@scope/package',
        'npm:alias@^2.0.0',
        'npm:alias@2.0.0',
        'jsr:@scope/package@^2.0.0',
        '--user-agent',
        'depfresh',
      ]),
    ).toBe(true)
  })
})
