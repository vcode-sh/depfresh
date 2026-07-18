function restoreCursor() {
  if (!process.stdout.isTTY) return
  process.stdout.write('\x1B[?25h')
}

const signalCleanups = new Map<symbol, () => void>()

export function registerSignalCleanup(cleanup: () => void): () => void {
  const registration = Symbol('signal-cleanup')
  signalCleanups.set(registration, cleanup)
  let registered = true
  return () => {
    if (!registered) return
    registered = false
    signalCleanups.delete(registration)
  }
}

function runSignalCleanups(): void {
  const cleanups = [...signalCleanups.values()]
  signalCleanups.clear()
  for (const cleanup of cleanups) {
    try {
      cleanup()
    } catch {
      // Signal termination must continue through every registered cleanup.
    }
  }
}

process.on('SIGINT', () => {
  runSignalCleanups()
  restoreCursor()
  process.exit(130)
})
process.on('SIGTERM', () => {
  runSignalCleanups()
  restoreCursor()
  process.exit(143)
})
process.on('exit', restoreCursor)
