export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function timeDifference(
  dateStr: string | undefined,
): { text: string; color: 'green' | 'yellow' | 'red' } | undefined {
  if (!dateStr) return undefined

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return undefined

  const now = Date.now()
  const diffMs = now - date.getTime()
  if (diffMs < 0) return { text: '~0d', color: 'green' }

  const days = diffMs / (1000 * 60 * 60 * 24)

  if (days < 90) {
    const d = Math.max(1, Math.round(days))
    return { text: `~${d}d`, color: 'green' }
  }

  if (days < 365) {
    const months = Math.round(days / 30)
    return { text: `~${months}mo`, color: 'yellow' }
  }

  const years = days / 365
  const formatted = years >= 10 ? `~${Math.round(years)}y` : `~${years.toFixed(1)}y`
  return { text: formatted, color: 'red' }
}
