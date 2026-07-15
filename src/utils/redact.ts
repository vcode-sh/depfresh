const REDACTED = '[REDACTED]'
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/giu
const SENSITIVE_QUERY_KEY_PATTERN = /auth|key|password|secret|token/iu

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/giu, '').toLowerCase()
  return (
    /authorization|password|secret|token/u.test(normalized) ||
    /(?:api|private)key/u.test(normalized) ||
    normalized === 'auth'
  )
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value)
    const hadUserInfo = url.username.length > 0 || url.password.length > 0
    url.username = ''
    url.password = ''
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_QUERY_KEY_PATTERN.test(key)) {
        url.searchParams.set(key, REDACTED)
      }
    }
    const serialized = url.toString().replaceAll('%5BREDACTED%5D', REDACTED)
    return hadUserInfo
      ? serialized.replace(`${url.protocol}//`, `${url.protocol}//${REDACTED}@`)
      : serialized
  } catch {
    return REDACTED
  }
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(URL_PATTERN, (url) => redactUrl(url))
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/giu, `$1 ${REDACTED}`)
    .replace(
      /\b([A-Z0-9_]*(?:AUTH(?:ORIZATION)?|PASSWORD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY)[A-Z0-9_]*)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      `$1=${REDACTED}`,
    )
}

function redactUnknown(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactSensitiveText(value)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)

  if (value instanceof Error) {
    const error = value as Error & { cause?: unknown; code?: unknown; reason?: unknown }
    const redacted: Record<string, unknown> = {
      name: value.name,
      message: redactSensitiveText(value.message),
    }
    if (typeof error.code === 'string') redacted.code = error.code
    if (typeof error.reason === 'string') redacted.reason = error.reason
    for (const [key, nestedValue] of Object.entries(value)) {
      if (key === 'cause' || key === 'code' || key === 'reason') continue
      redacted[key] = isSensitiveKey(key) ? REDACTED : redactUnknown(nestedValue, seen)
    }
    if (error.cause !== undefined) redacted.cause = redactUnknown(error.cause, seen)
    return redacted
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, seen))
  }

  const redacted: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(value)) {
    redacted[key] = isSensitiveKey(key) ? REDACTED : redactUnknown(nestedValue, seen)
  }
  return redacted
}

export function redactSensitiveValue(value: unknown): unknown {
  return redactUnknown(value, new WeakSet())
}

export interface SafeErrorDetails {
  name: string
  code: string
  reason: string
  message: string
  cause?: unknown
}

export function getSafeErrorDetails(error: unknown): SafeErrorDetails {
  if (!(error instanceof Error)) {
    return {
      name: 'Error',
      code: 'ERR_UNKNOWN',
      reason: 'UNKNOWN_ERROR',
      message: redactSensitiveText(String(error)),
    }
  }

  const coded = error as Error & { code?: unknown; reason?: unknown; cause?: unknown }
  return {
    name: error.name,
    code: typeof coded.code === 'string' ? coded.code : 'ERR_UNKNOWN',
    reason: typeof coded.reason === 'string' ? coded.reason : 'UNKNOWN_ERROR',
    message: redactSensitiveText(error.message),
    ...(coded.cause === undefined
      ? {}
      : { cause: redactUnknown(coded.cause, new WeakSet<object>()) }),
  }
}
