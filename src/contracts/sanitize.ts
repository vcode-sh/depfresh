import { redactSensitiveText } from '../utils/redact'

const POSIX_ABSOLUTE_PATH_PATTERN = /(?:^|[\s"'(=])(?:(?:file|link):)?\/+[^\s"'<>]+/u
const WINDOWS_DRIVE_PATH_PATTERN = /(?:^|[\s"'(=])(?:(?:file|link):)?[A-Za-z]:[\\/][^\s"'<>]+/u
const WINDOWS_UNC_PATH_PATTERN = /(?:^|[\s"'(=])\\\\[^\s\\/]+[\\/][^\s"'<>]+/u
const CONTROL_OR_FORMAT_PATTERN = /[\p{Cc}\p{Cf}\p{Cs}]/u

export function containsAbsolutePath(value: string): boolean {
  return (
    POSIX_ABSOLUTE_PATH_PATTERN.test(value) ||
    WINDOWS_DRIVE_PATH_PATTERN.test(value) ||
    WINDOWS_UNC_PATH_PATTERN.test(value)
  )
}

export function isContractSafeText(value: string): boolean {
  return (
    value.length <= 4096 &&
    !CONTROL_OR_FORMAT_PATTERN.test(value) &&
    !containsAbsolutePath(value) &&
    redactSensitiveText(value) === value
  )
}

const SENSITIVE_ARG_FLAG =
  /(?:auth|authorization|credential|passphrase|password|passwd|secret|token|api[-_]?key|private[-_]?key|oauth|proxy[-_]?user)/iu
const HEADER_FLAG = /^(?:-H|--header|--proxy-header)$/u
const USER_CREDENTIAL_FLAG = /^(?:-[uU]|--user|--username)$/u
const CREDENTIAL_SOURCE_FLAG =
  /^--(?:cert|ftp-user|http-user|key|netrc|netrc-file|proxy-cert|proxy-key)$/u
const PASSPHRASE_FLAG = /^-pass(?:in|out)?$/u
const COOKIE_FLAG = /^(?:-b|--cookie|--cookie-jar)$/u
const CURL_EXECUTABLE = /^curl(?:\.exe)?$/iu
const CURL_ATTACHED_USER_FLAG = /^-[^-]*[uU]/u
const CURL_ATTACHED_COOKIE_FLAG = /^-[^-]*b/u
const CURL_ATTACHED_CERT_FLAG = /^-[^-]*E/u
const PACKAGE_PROTOCOL_SPECIFIER =
  /^(?:npm:(?:@[^/\s:@]+\/)?[^/\s:@]+|jsr:@[^/\s:@]+\/[^/\s:@]+)@[^/\s]+$/u
const URI_WITH_AUTHORITY = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/giu
const PUBLIC_ARG_TOKEN = /(?:^|[=\s"'(])([^\s"'<>]+)/gu
const NAMED_VALUE = /(?:^|[\s"'(=])([a-z][a-z0-9_-]{0,63})\s*[:=]/giu
const SENSITIVE_HEADER_NAME =
  /(?:authorization|cookie|credential|passphrase|password|secret|session|token|api[-_]?key|private[-_]?key)/iu
const AUTH_SCHEME = /^(?:Bearer|Basic)$/iu

export function isContractSafeArgv(argv: readonly string[]): boolean {
  if (argv.length === 0 || argv.some((value) => !isContractSafeText(value))) return false
  const curlIndex = argv.findIndex((value) => CURL_EXECUTABLE.test(value))
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value) return false
    const flag = value.includes('=') ? value.slice(0, value.indexOf('=')) : value
    if (
      USER_CREDENTIAL_FLAG.test(flag) ||
      CREDENTIAL_SOURCE_FLAG.test(flag) ||
      PASSPHRASE_FLAG.test(flag) ||
      COOKIE_FLAG.test(flag) ||
      (index > curlIndex && curlIndex !== -1 && CURL_ATTACHED_USER_FLAG.test(value)) ||
      (index > curlIndex && curlIndex !== -1 && CURL_ATTACHED_COOKIE_FLAG.test(value)) ||
      (index > curlIndex && curlIndex !== -1 && CURL_ATTACHED_CERT_FLAG.test(value)) ||
      hasLiteralUserInfo(value) ||
      hasSensitiveNamedValue(value) ||
      (/^--?/u.test(flag) && SENSITIVE_ARG_FLAG.test(flag))
    ) {
      return false
    }
    const header = headerValue(value, argv[index + 1], index > curlIndex && curlIndex !== -1)
    if (header) {
      const separator = header.indexOf(':')
      const name = (separator === -1 ? header : header.slice(0, separator)).trim()
      if (SENSITIVE_HEADER_NAME.test(name)) return false
    }
    if (AUTH_SCHEME.test(value) && argv[index + 1]) return false
  }
  return true
}

function headerValue(
  value: string,
  nextValue: string | undefined,
  curl: boolean,
): string | undefined {
  if (HEADER_FLAG.test(value)) return nextValue
  if (value.startsWith('--header=')) return value.slice('--header='.length)
  if (value.startsWith('--proxy-header=')) return value.slice('--proxy-header='.length)
  if (curl && value.startsWith('-') && !value.startsWith('--')) {
    const headerOption = value.indexOf('H', 1)
    if (headerOption !== -1 && headerOption < value.length - 1) {
      return value.slice(headerOption + 1)
    }
  }
  return undefined
}

function hasSensitiveNamedValue(value: string): boolean {
  return [...value.matchAll(NAMED_VALUE)].some((match) =>
    SENSITIVE_HEADER_NAME.test(match[1] ?? ''),
  )
}

function hasLiteralUserInfo(value: string): boolean {
  for (const match of value.matchAll(URI_WITH_AUTHORITY)) {
    try {
      const url = new URL(match[0])
      if (url.username || url.password) return true
    } catch {
      return true
    }
  }
  for (const match of value.matchAll(PUBLIC_ARG_TOKEN)) {
    const token = match[1]
    if (!(token && !token.includes('://') && !PACKAGE_PROTOCOL_SPECIFIER.test(token))) continue
    const authority = token.slice(0, token.indexOf('/') === -1 ? undefined : token.indexOf('/'))
    const at = authority.lastIndexOf('@')
    if (at !== -1 && authority.slice(0, at).includes(':')) return true
  }
  return false
}

export function sanitizeContractText(value: string): string {
  if (value.length > 4096) return '[REDACTED]'
  if (CONTROL_OR_FORMAT_PATTERN.test(value)) return '[REDACTED]'
  if (containsAbsolutePath(value)) return '[REDACTED_PATH]'
  if (redactSensitiveText(value) !== value) return '[REDACTED]'
  return value
}
