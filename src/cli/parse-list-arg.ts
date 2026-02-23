export function parseCommaSeparatedArg(value: unknown): string[] | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

  return items.length > 0 ? items : undefined
}
