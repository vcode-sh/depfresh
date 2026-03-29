import * as p from '@clack/prompts'
import c from 'ansis'
import type { DiffType, ResolvedDepChange } from '../../types'
import { arrow, colorDiff, colorizeVersionDiff } from '../../utils/format'

const DIFF_GROUP_ORDER: DiffType[] = ['major', 'minor', 'patch']

const GROUP_COLORS: Record<string, (s: string) => string> = {
  major: c.red,
  minor: c.yellow,
  patch: c.green,
}

function getSelectionValue(depIndex: number): string {
  return String(depIndex)
}

function makeOption(dep: ResolvedDepChange, depIndex: number) {
  return {
    value: getSelectionValue(depIndex),
    label: `${dep.name}  ${dep.currentVersion}${arrow()}${colorizeVersionDiff(dep.currentVersion, dep.targetVersion, dep.diff)}  ${colorDiff(dep.diff)}`,
    hint: dep.deprecated ? c.red('deprecated') : undefined,
  }
}

function getSelectedUpdates(
  updates: ResolvedDepChange[],
  selectedValues: string[],
): ResolvedDepChange[] {
  const selectedIndices = new Set(
    selectedValues
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0),
  )

  return updates.filter((_dep, depIndex) => selectedIndices.has(depIndex))
}

async function runClackFallback(updates: ResolvedDepChange[]): Promise<ResolvedDepChange[]> {
  const grouped = new Map<DiffType, Array<{ dep: ResolvedDepChange; depIndex: number }>>()

  for (const [depIndex, dep] of updates.entries()) {
    const existing = grouped.get(dep.diff)
    if (existing) {
      existing.push({ dep, depIndex })
    } else {
      grouped.set(dep.diff, [{ dep, depIndex }])
    }
  }

  const hasStandardGroups = DIFF_GROUP_ORDER.some((d) => grouped.has(d))

  if (!hasStandardGroups) {
    const options = updates.map((dep, depIndex) => makeOption(dep, depIndex))

    const selected = await p.multiselect({
      message: 'Select dependencies to update',
      options,
      required: false,
    })

    if (p.isCancel(selected)) {
      p.cancel('Update cancelled')
      return []
    }

    return getSelectedUpdates(updates, selected as string[])
  }

  const groupOptions: Record<string, Array<{ value: string; label: string; hint?: string }>> = {}

  for (const diffType of DIFF_GROUP_ORDER) {
    const deps = grouped.get(diffType)
    if (!deps) continue

    const colorFn = GROUP_COLORS[diffType]
    const label = colorFn ? colorFn(diffType) : diffType
    groupOptions[label] = deps.map(({ dep, depIndex }) => makeOption(dep, depIndex))
  }

  const selected = await p.groupMultiselect({
    message: 'Select dependencies to update',
    options: groupOptions,
    required: false,
    selectableGroups: true,
  })

  if (p.isCancel(selected)) {
    p.cancel('Update cancelled')
    return []
  }

  return getSelectedUpdates(updates, selected as string[])
}

export async function runInteractive(
  updates: ResolvedDepChange[],
  options?: { explain?: boolean },
): Promise<ResolvedDepChange[]> {
  if (updates.length === 0) return []

  if (
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    typeof process.stdin.setRawMode === 'function'
  ) {
    try {
      const { createInteractiveTUI } = await import('./tui/index')
      return await createInteractiveTUI(updates, { explain: options?.explain ?? false })
    } catch {
      return runClackFallback(updates)
    }
  }

  return runClackFallback(updates)
}
