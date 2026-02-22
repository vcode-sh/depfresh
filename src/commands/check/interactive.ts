import * as p from '@clack/prompts'
import c from 'ansis'
import type { ResolvedDepChange } from '../../types'
import { arrow, colorDiff, colorVersion } from '../../utils/format'

export async function runInteractive(updates: ResolvedDepChange[]): Promise<ResolvedDepChange[]> {
  const options = updates.map((dep) => ({
    value: dep.name,
    label: `${dep.name}  ${dep.currentVersion}${arrow()}${colorVersion(dep.targetVersion, dep.diff)}  ${colorDiff(dep.diff)}`,
    hint: dep.deprecated ? c.red('deprecated') : undefined,
  }))

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
