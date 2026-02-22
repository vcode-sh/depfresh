import type { PackageMeta, UpgrOptions } from '../../types'
import { visualLength, visualTruncate } from '../../utils/format'

const BAR_WIDTH = 24
const LINES = 2

export interface CheckProgress {
  onPackageStart(pkg: PackageMeta): void
  onDependencyProcessed(): void
  onPackageEnd(): void
  done(): void
}

interface ProgressState {
  totalPackages: number
  totalDeps: number
  completedPackages: number
  completedDeps: number
  currentPackageName: string
  currentPackageTotalDeps: number
  currentPackageResolvedDeps: number
  renderedLines: number
}

export function createCheckProgress(
  options: UpgrOptions,
  packages: PackageMeta[],
): CheckProgress | null {
  if (!shouldRenderProgress(options)) {
    return null
  }

  const state: ProgressState = {
    totalPackages: packages.length,
    totalDeps: packages.reduce((sum, p) => sum + p.deps.filter((d) => d.update).length, 0),
    completedPackages: 0,
    completedDeps: 0,
    currentPackageName: '',
    currentPackageTotalDeps: 0,
    currentPackageResolvedDeps: 0,
    renderedLines: 0,
  }

  const progress: CheckProgress = {
    onPackageStart(pkg): void {
      state.currentPackageName = pkg.name || '(unnamed)'
      state.currentPackageTotalDeps = pkg.deps.filter((d) => d.update).length
      state.currentPackageResolvedDeps = 0
      render(state)
    },
    onDependencyProcessed(): void {
      state.currentPackageResolvedDeps = Math.min(
        state.currentPackageResolvedDeps + 1,
        state.currentPackageTotalDeps,
      )
      state.completedDeps = Math.min(state.completedDeps + 1, state.totalDeps)
      render(state)
    },
    onPackageEnd(): void {
      state.completedPackages = Math.min(state.completedPackages + 1, state.totalPackages)
      state.currentPackageResolvedDeps = state.currentPackageTotalDeps
      render(state)
    },
    done(): void {
      clear(state)
    },
  }

  return progress
}

function shouldRenderProgress(options: UpgrOptions): boolean {
  return process.stdout.isTTY && options.output === 'table' && options.loglevel !== 'silent'
}

function render(state: ProgressState): void {
  const maxLabel = getMaxLabelWidth()
  const pkgLabel = clampLabel('Packages', maxLabel)
  const depLabel = clampLabel(`Deps (${state.currentPackageName || '-'})`, maxLabel)

  const pkgBar = formatBar(state.completedPackages, state.totalPackages)
  const depBar = formatBar(state.currentPackageResolvedDeps, state.currentPackageTotalDeps)

  const pkgLine = `${pkgLabel} ${pkgBar}`
  const depLine = `${depLabel} ${depBar}  total ${state.completedDeps}/${state.totalDeps}`

  if (state.renderedLines > 0) {
    moveCursorUp(state.renderedLines)
  }

  writeLine(pkgLine)
  writeLine(depLine)
  state.renderedLines = LINES
}

function clear(state: ProgressState): void {
  if (state.renderedLines === 0) return

  moveCursorUp(state.renderedLines)
  for (let i = 0; i < state.renderedLines; i++) {
    process.stdout.write('\r\x1B[2K\n')
  }
  moveCursorUp(state.renderedLines)
  state.renderedLines = 0
}

function formatBar(value: number, total: number): string {
  if (total <= 0) {
    return `[${'-'.repeat(BAR_WIDTH)}] 0/0`
  }

  const clamped = Math.min(value, total)
  const ratio = clamped / total
  const filled = Math.round(BAR_WIDTH * ratio)
  const empty = Math.max(0, BAR_WIDTH - filled)

  return `[${'='.repeat(filled)}${'-'.repeat(empty)}] ${clamped}/${total}`
}

function getMaxLabelWidth(): number {
  const columns = typeof process.stdout.columns === 'number' ? process.stdout.columns : 80
  return Math.max(12, Math.floor(columns / 2) - 22)
}

function clampLabel(label: string, max: number): string {
  const clean = visualLength(label) > max ? visualTruncate(label, max) : label
  const pad = max - visualLength(clean)
  return `${clean}${' '.repeat(Math.max(0, pad))}`
}

function moveCursorUp(lines: number): void {
  if (lines > 0) {
    process.stdout.write(`\x1B[${lines}A`)
  }
}

function writeLine(text: string): void {
  process.stdout.write(`\r\x1B[2K${text}\n`)
}
