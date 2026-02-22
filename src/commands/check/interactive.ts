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

function makeOption(dep: ResolvedDepChange) {
  return {
    value: dep.name,
    label: `${dep.name}  ${dep.currentVersion}${arrow()}${colorizeVersionDiff(dep.currentVersion, dep.targetVersion, dep.diff)}  ${colorDiff(dep.diff)}`,
    hint: dep.deprecated ? c.red('deprecated') : undefined,
  }
}

async function runClackFallback(updates: ResolvedDepChange[]): Promise<ResolvedDepChange[]> {
  const grouped = new Map<DiffType, ResolvedDepChange[]>()

  for (const dep of updates) {
    const existing = grouped.get(dep.diff)
    if (existing) {
      existing.push(dep)
    } else {
      grouped.set(dep.diff, [dep])
    }
  }

  const hasStandardGroups = DIFF_GROUP_ORDER.some((d) => grouped.has(d))

  if (!hasStandardGroups) {
    const options = updates.map(makeOption)

    const selected = await p.multiselect({
      message: 'Select dependencies to update',
      options,
      required: false,
    })

    if (p.isCancel(selected)) {
      p.cancel('Update cancelled')
      return []
    }

    return updates.filter((u) => (selected as string[]).includes(u.name))
  }

  const groupOptions: Record<string, Array<{ value: string; label: string; hint?: string }>> = {}

  for (const diffType of DIFF_GROUP_ORDER) {
    const deps = grouped.get(diffType)
    if (!deps) continue

    const colorFn = GROUP_COLORS[diffType]
    const label = colorFn ? colorFn(diffType) : diffType
    groupOptions[label] = deps.map(makeOption)
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

  return updates.filter((u) => (selected as string[]).includes(u.name))
}

export async function runInteractive(
  updates: ResolvedDepChange[],
  options?: { explain?: boolean },
): Promise<ResolvedDepChange[]> {
  if (updates.length === 0) return []

  if (process.stdin.isTTY && process.stdout.isTTY) {
    const { createInteractiveTUI } = await import('./tui/index')
    return createInteractiveTUI(updates, { explain: options?.explain ?? false })
  }

  return runClackFallback(updates)
}
