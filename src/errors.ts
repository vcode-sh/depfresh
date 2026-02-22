interface UpgrErrorOptions {
  cause?: unknown
}

/**
 * Base error class for all upgr runtime errors.
 * Allows API users to reliably branch on `instanceof UpgrError` and `code`.
 */
export class UpgrError extends Error {
  readonly code: string
  override readonly cause?: unknown

  constructor(message: string, code: string, options: UpgrErrorOptions = {}) {
    super(message)
    this.name = new.target.name
    this.code = code
    this.cause = options.cause
  }
}

export class RegistryError extends UpgrError {
  readonly status: number
  readonly url: string

  constructor(message: string, status: number, url: string, options: UpgrErrorOptions = {}) {
    super(message, 'ERR_REGISTRY', options)
    this.status = status
    this.url = url
  }
}

export class CacheError extends UpgrError {
  constructor(message: string, options: UpgrErrorOptions = {}) {
    super(message, 'ERR_CACHE', options)
  }
}

export class ConfigError extends UpgrError {
  constructor(message: string, options: UpgrErrorOptions = {}) {
    super(message, 'ERR_CONFIG', options)
  }
}

export class WriteError extends UpgrError {
  constructor(message: string, options: UpgrErrorOptions = {}) {
    super(message, 'ERR_WRITE', options)
  }
}

export class ResolveError extends UpgrError {
  constructor(message: string, options: UpgrErrorOptions = {}) {
    super(message, 'ERR_RESOLVE', options)
  }
}
