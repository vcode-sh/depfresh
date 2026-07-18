import c, { Ansis } from 'ansis'
import { sanitizeTerminalText } from './format'

export interface Logger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
  success: (...args: unknown[]) => void
}

export interface LoggerOptions {
  color?: boolean
  sanitize?: boolean
  width?: number
  wrap?: (value: string, width: number) => readonly string[]
}

export function createLogger(
  level: 'silent' | 'info' | 'debug' = 'info',
  options: LoggerOptions = {},
): Logger {
  const noop = () => {}

  if (level === 'silent') {
    return { info: noop, warn: noop, error: noop, debug: noop, success: noop }
  }

  const color = options.color === undefined ? c : new Ansis(options.color ? 1 : 0)
  const prepare = options.sanitize
    ? (args: unknown[]): unknown[] => args.map(sanitizeLogArgument)
    : (args: unknown[]): unknown[] => args
  const emit = (
    method: (...args: unknown[]) => void,
    marker: string,
    style: (value: string) => string,
    args: unknown[],
  ): void => {
    const prepared = prepare(args)
    if (options.width === undefined || options.wrap === undefined) {
      method(style(marker), ...prepared)
      return
    }

    const width = Math.max(1, Math.floor(options.width))
    const body = prepared.map(safeString).join(' ')
    if (width < 3) {
      for (const line of options.wrap(body.length > 0 ? body : marker, width)) method(line)
      return
    }
    for (const line of options.wrap(body, width - 2)) method(style(marker), line)
  }

  return {
    // biome-ignore lint/suspicious/noConsole: logger is the intentional console wrapper
    info: (...args) => emit(console.log, 'i', color.blue, args),
    // biome-ignore lint/suspicious/noConsole: logger is the intentional console wrapper
    warn: (...args) => emit(console.warn, '!', color.yellow, args),
    // biome-ignore lint/suspicious/noConsole: logger is the intentional console wrapper
    error: (...args) => emit(console.error, 'x', color.red, args),
    debug:
      level === 'debug'
        ? (...args) => {
            // biome-ignore lint/suspicious/noConsole: logger is the intentional console wrapper
            emit(console.log, '~', color.gray, args)
          }
        : noop,
    // biome-ignore lint/suspicious/noConsole: logger is the intentional console wrapper
    success: (...args) => emit(console.log, '*', color.green, args),
  }
}

function sanitizeLogArgument(value: unknown): unknown {
  try {
    if (typeof value === 'string') return sanitizeTerminalText(value)
    if (value instanceof Error) return sanitizeTerminalText(value.message)
    if (
      value === null ||
      value === undefined ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value
    }
    return sanitizeTerminalText(safeString(value))
  } catch {
    return '[unprintable]'
  }
}

function safeString(value: unknown): string {
  try {
    return String(value)
  } catch {
    return '[unprintable]'
  }
}
