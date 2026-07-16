import type { depfreshOptions, PackageMeta } from '../../types'
import { visualLength, visualTruncate } from '../../utils/format'
import { isLocked } from '../../utils/versions'

const BAR_WIDTH = 20
const LINES = 2
const RENDER_INTERVAL_MS = 50

type ProgressPhase = 'discovery' | 'evidence' | 'resolution' | 'rendering'

export interface CheckProgress {
  onPackagesDiscovered(packages: PackageMeta[]): void
  onRepositoryInspectionStart(): void
  onPackagesReady(packages: PackageMeta[]): void
  onDependencyProcessed(): void
  onRenderingStart(): void
  onPackageRendered(): void
  suspend<T>(write: () => T): T
  suspendAsync<T>(write: () => Promise<T>): Promise<T>
  done(): void
}

interface ProgressState {
  phase: ProgressPhase
  totalPackages: number
  declaredDependencies: number
  eligibleDependencies: number
  pinnedDependencies: number
  completedDependencies: number
  completedPackages: number
  renderedLines: number
  pauseDepth: number
  timer?: NodeJS.Timeout
}

export function createCheckProgress(options: depfreshOptions): CheckProgress | null {
  if (!shouldRenderProgress(options)) return null

  const state: ProgressState = {
    phase: 'discovery',
    totalPackages: 0,
    declaredDependencies: 0,
    eligibleDependencies: 0,
    pinnedDependencies: 0,
    completedDependencies: 0,
    completedPackages: 0,
    renderedLines: 0,
    pauseDepth: 0,
  }

  const progress: CheckProgress = {
    onPackagesDiscovered(packages): void {
      state.totalPackages = packages.length
      state.declaredDependencies = packages.reduce((sum, pkg) => sum + pkg.deps.length, 0)
      renderImmediately(state)
    },
    onRepositoryInspectionStart(): void {
      state.phase = 'evidence'
      renderImmediately(state)
    },
    onPackagesReady(packages): void {
      state.totalPackages = packages.length
      state.declaredDependencies = packages.reduce((sum, pkg) => sum + pkg.deps.length, 0)
      state.eligibleDependencies = packages.reduce(
        (sum, pkg) => sum + pkg.deps.filter((dependency) => dependency.update).length,
        0,
      )
      state.pinnedDependencies = packages.reduce(
        (sum, pkg) =>
          sum +
          pkg.deps.filter((dependency) => !dependency.update && isLocked(dependency.currentVersion))
            .length,
        0,
      )
      state.phase = 'resolution'
      renderImmediately(state)
    },
    onDependencyProcessed(): void {
      state.completedDependencies = Math.min(
        state.completedDependencies + 1,
        state.eligibleDependencies,
      )
      scheduleRender(state)
    },
    onRenderingStart(): void {
      if (state.timer) renderImmediately(state)
      state.phase = 'rendering'
      renderImmediately(state)
    },
    onPackageRendered(): void {
      state.completedPackages = Math.min(state.completedPackages + 1, state.totalPackages)
      scheduleRender(state)
    },
    suspend<T>(write: () => T): T {
      pause(state)
      try {
        return write()
      } finally {
        resume(state)
      }
    },
    async suspendAsync<T>(write: () => Promise<T>): Promise<T> {
      pause(state)
      try {
        return await write()
      } finally {
        resume(state)
      }
    },
    done(): void {
      if (state.timer) renderImmediately(state)
      clear(state)
    },
  }

  render(state)
  return progress
}

function shouldRenderProgress(options: depfreshOptions): boolean {
  const isCi = Boolean(process.env.CI && process.env.CI !== 'false')
  return (
    process.stdout.isTTY &&
    options.output === 'table' &&
    options.loglevel === 'info' &&
    process.env.TERM?.toLowerCase() !== 'dumb' &&
    !isCi
  )
}

function scheduleRender(state: ProgressState): void {
  if (state.timer) return
  state.timer = setTimeout(() => {
    state.timer = undefined
    render(state)
  }, RENDER_INTERVAL_MS)
  state.timer.unref()
}

function renderImmediately(state: ProgressState): void {
  cancelScheduledRender(state)
  render(state)
}

function cancelScheduledRender(state: ProgressState): void {
  if (!state.timer) return
  clearTimeout(state.timer)
  state.timer = undefined
}

function render(state: ProgressState): void {
  if (state.pauseDepth > 0) return
  const reportedColumns = typeof process.stdout.columns === 'number' ? process.stdout.columns : 0
  const columns = reportedColumns > 0 ? reportedColumns : 80
  const contentWidth = Math.max(1, columns)
  const lines = [phaseLine(state), metricsLine(state)].map((line) =>
    visualLength(line) > contentWidth ? visualTruncate(line, contentWidth) : line,
  )

  if (state.renderedLines > 0) moveCursorUp(state.renderedLines)
  for (const line of lines) writeLine(line)
  state.renderedLines = LINES
}

function phaseLine(state: ProgressState): string {
  if (state.phase === 'discovery') return '◆ Discovering packages…'
  if (state.phase === 'evidence') return '◆ Inspecting repository evidence…'
  if (state.phase === 'resolution') {
    return `◆ Resolving dependencies ${formatBar(
      state.completedDependencies,
      state.eligibleDependencies,
    )}`
  }
  return `◆ Rendering results ${formatBar(state.completedPackages, state.totalPackages)}`
}

function metricsLine(state: ProgressState): string {
  if (state.phase === 'discovery') {
    return state.totalPackages === 0
      ? '  Preparing a trustworthy repository view'
      : `  ${state.totalPackages} packages · ${state.declaredDependencies} declarations found`
  }
  if (state.phase === 'evidence') {
    return `  ${state.totalPackages} packages · ${state.declaredDependencies} declarations found`
  }
  const skipped = Math.max(0, state.declaredDependencies - state.eligibleDependencies)
  const otherSkipped = Math.max(0, skipped - state.pinnedDependencies)
  const skippedLabel =
    otherSkipped === 0
      ? `${state.pinnedDependencies} pinned`
      : `${state.pinnedDependencies} pinned · ${otherSkipped} other skipped`
  return `  ${state.totalPackages} packages · ${state.declaredDependencies} declared · ${state.eligibleDependencies} eligible · ${skippedLabel}`
}

function pause(state: ProgressState): void {
  if (state.pauseDepth === 0) {
    cancelScheduledRender(state)
    clear(state)
  }
  state.pauseDepth += 1
}

function resume(state: ProgressState): void {
  state.pauseDepth = Math.max(0, state.pauseDepth - 1)
  if (state.pauseDepth === 0) render(state)
}

function clear(state: ProgressState): void {
  if (state.renderedLines === 0) return
  moveCursorUp(state.renderedLines)
  for (let index = 0; index < state.renderedLines; index++) {
    process.stdout.write('\r\x1B[2K\n')
  }
  moveCursorUp(state.renderedLines)
  state.renderedLines = 0
}

function formatBar(value: number, total: number): string {
  if (total <= 0) return `${'─'.repeat(BAR_WIDTH)} 0/0`
  const clamped = Math.min(value, total)
  const filled = Math.round(BAR_WIDTH * (clamped / total))
  return `${'━'.repeat(filled)}${'─'.repeat(BAR_WIDTH - filled)} ${clamped}/${total}`
}

function moveCursorUp(lines: number): void {
  if (lines > 0) process.stdout.write(`\x1B[${lines}A`)
}

function writeLine(text: string): void {
  process.stdout.write(`\r\x1B[2K${text}\n`)
}
