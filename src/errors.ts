interface BumpErrorOptions {
  cause?: unknown
}

/**
 * Base error class for all bump runtime errors.
 * Allows API users to reliably branch on `instanceof BumpError` and `code`.
 */
export class BumpError extends Error {
  readonly code: string
  override readonly cause?: unknown

  constructor(message: string, code: string, options: BumpErrorOptions = {}) {
    super(message)
    this.name = new.target.name
    this.code = code
    this.cause = options.cause
  }
}

export class RegistryError extends BumpError {
  readonly status: number
  readonly url: string

  constructor(message: string, status: number, url: string, options: BumpErrorOptions = {}) {
    super(message, 'ERR_REGISTRY', options)
    this.status = status
    this.url = url
  }
}

export class CacheError extends BumpError {
  constructor(message: string, options: BumpErrorOptions = {}) {
    super(message, 'ERR_CACHE', options)
  }
}

export class ConfigError extends BumpError {
  constructor(message: string, options: BumpErrorOptions = {}) {
    super(message, 'ERR_CONFIG', options)
  }
}

export class WriteError extends BumpError {
  constructor(message: string, options: BumpErrorOptions = {}) {
    super(message, 'ERR_WRITE', options)
  }
}

export class ResolveError extends BumpError {
  constructor(message: string, options: BumpErrorOptions = {}) {
    super(message, 'ERR_RESOLVE', options)
  }
}
