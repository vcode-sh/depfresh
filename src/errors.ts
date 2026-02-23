interface depfreshErrorOptions {
  cause?: unknown
}

/**
 * Base error class for all depfresh runtime errors.
 * Allows API users to reliably branch on `instanceof depfreshError` and `code`.
 */
export class depfreshError extends Error {
  readonly code: string
  override readonly cause?: unknown

  constructor(message: string, code: string, options: depfreshErrorOptions = {}) {
    super(message)
    this.name = new.target.name
    this.code = code
    this.cause = options.cause
  }
}

export class RegistryError extends depfreshError {
  readonly status: number
  readonly url: string

  constructor(message: string, status: number, url: string, options: depfreshErrorOptions = {}) {
    super(message, 'ERR_REGISTRY', options)
    this.status = status
    this.url = url
  }
}

export class CacheError extends depfreshError {
  constructor(message: string, options: depfreshErrorOptions = {}) {
    super(message, 'ERR_CACHE', options)
  }
}

export class ConfigError extends depfreshError {
  constructor(message: string, options: depfreshErrorOptions = {}) {
    super(message, 'ERR_CONFIG', options)
  }
}

export class WriteError extends depfreshError {
  constructor(message: string, options: depfreshErrorOptions = {}) {
    super(message, 'ERR_WRITE', options)
  }
}

export class ResolveError extends depfreshError {
  constructor(message: string, options: depfreshErrorOptions = {}) {
    super(message, 'ERR_RESOLVE', options)
  }
}

export class AddonError extends depfreshError {
  readonly addon: string
  readonly hook: string

  constructor(message: string, addon: string, hook: string, options: depfreshErrorOptions = {}) {
    super(message, 'ERR_ADDON', options)
    this.addon = addon
    this.hook = hook
  }
}
