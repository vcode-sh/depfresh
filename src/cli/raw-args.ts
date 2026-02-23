export function normalizeCliRawArgs(rawArgs: string[]): string[] {
  if (rawArgs[0] !== 'help') {
    return rawArgs
  }

  return ['--help', ...rawArgs.slice(1)]
}
