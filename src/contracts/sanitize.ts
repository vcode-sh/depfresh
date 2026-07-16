import { redactSensitiveText } from '../utils/redact'

const POSIX_ABSOLUTE_PATH_PATTERN = /(?:^|[\s"'(=])(?:(?:file|link):)?\/+[^\s"'<>]+/u
const WINDOWS_DRIVE_PATH_PATTERN = /(?:^|[\s"'(=])(?:(?:file|link):)?[A-Za-z]:[\\/][^\s"'<>]+/u
const WINDOWS_UNC_PATH_PATTERN = /(?:^|[\s"'(=])\\\\[^\s\\/]+[\\/][^\s"'<>]+/u

export function containsAbsolutePath(value: string): boolean {
  return (
    POSIX_ABSOLUTE_PATH_PATTERN.test(value) ||
    WINDOWS_DRIVE_PATH_PATTERN.test(value) ||
    WINDOWS_UNC_PATH_PATTERN.test(value)
  )
}

export function isContractSafeText(value: string): boolean {
  return !containsAbsolutePath(value) && redactSensitiveText(value) === value
}

export function sanitizeContractText(value: string): string {
  if (containsAbsolutePath(value)) return '[REDACTED_PATH]'
  if (redactSensitiveText(value) !== value) return '[REDACTED]'
  return value
}
