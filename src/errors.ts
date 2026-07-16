import { redactSensitiveText } from './utils/redact'

export const DEPFRESH_ERROR_REASONS = [
  'UNKNOWN_OPTION',
  'MISSING_OPTION_VALUE',
  'CONFLICTING_OPTION',
  'INVALID_BOOLEAN',
  'INVALID_OPTION_VALUE',
  'UNSUPPORTED_COMBINATION',
  'AUTHORITY_REQUIRED',
  'CONFIG_LOAD_FAILED',
  'CONFIG_PARSE_FAILED',
  'EXECUTABLE_CONFIG_FORBIDDEN',
  'INVALID_CONFIG',
  'REGISTRY_REQUEST_FAILED',
  'CACHE_FAILURE',
  'WRITE_FAILURE',
  'RESOLUTION_FAILURE',
  'ADDON_FAILURE',
  'UNKNOWN_ERROR',
] as const

export type depfreshErrorReason = (typeof DEPFRESH_ERROR_REASONS)[number]

interface depfreshErrorOptions {
  cause?: unknown
  reason?: depfreshErrorReason
}

/**
 * Base error class for all depfresh runtime errors.
 * Allows API users to reliably branch on `instanceof depfreshError` and `code`.
 */
export class depfreshError extends Error {
  readonly code: string
  readonly reason: depfreshErrorReason
  override readonly cause?: unknown

  constructor(message: string, code: string, options: depfreshErrorOptions = {}) {
    super(redactSensitiveText(message))
    this.name = new.target.name
    this.code = code
    this.reason = options.reason ?? 'UNKNOWN_ERROR'
    this.cause = options.cause
  }
}

export class RegistryError extends depfreshError {
  readonly status: number
  readonly url: string

  constructor(message: string, status: number, url: string, options: depfreshErrorOptions = {}) {
    super(message, 'ERR_REGISTRY', { reason: 'REGISTRY_REQUEST_FAILED', ...options })
    this.status = status
    this.url = redactSensitiveText(url)
  }
}

export class CacheError extends depfreshError {
  constructor(message: string, options: depfreshErrorOptions = {}) {
    super(message, 'ERR_CACHE', { reason: 'CACHE_FAILURE', ...options })
  }
}

export class ConfigError extends depfreshError {
  constructor(message: string, options: depfreshErrorOptions = {}) {
    super(message, 'ERR_CONFIG', { reason: 'INVALID_CONFIG', ...options })
  }
}

export class WriteError extends depfreshError {
  constructor(message: string, options: depfreshErrorOptions = {}) {
    super(message, 'ERR_WRITE', { reason: 'WRITE_FAILURE', ...options })
  }
}

export class ResolveError extends depfreshError {
  constructor(message: string, options: depfreshErrorOptions = {}) {
    super(message, 'ERR_RESOLVE', { reason: 'RESOLUTION_FAILURE', ...options })
  }
}

export class AddonError extends depfreshError {
  readonly addon: string
  readonly hook: string

  constructor(message: string, addon: string, hook: string, options: depfreshErrorOptions = {}) {
    super(message, 'ERR_ADDON', { reason: 'ADDON_FAILURE', ...options })
    this.addon = addon
    this.hook = hook
  }
}
