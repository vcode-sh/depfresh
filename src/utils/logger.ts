import c from 'ansis'

export interface Logger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
  success: (...args: unknown[]) => void
}

export function createLogger(level: 'silent' | 'info' | 'debug' = 'info'): Logger {
  const noop = () => {}

  if (level === 'silent') {
    return { info: noop, warn: noop, error: noop, debug: noop, success: noop }
  }

  return {
    info: (...args) => console.log(c.blue('i'), ...args),
    warn: (...args) => console.warn(c.yellow('!'), ...args),
    error: (...args) => console.error(c.red('x'), ...args),
    debug: level === 'debug' ? (...args) => console.log(c.gray('~'), ...args) : noop,
    success: (...args) => console.log(c.green('*'), ...args),
  }
}
