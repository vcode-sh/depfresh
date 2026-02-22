import c from 'ansis'
import type { ResolvedDepChange } from '../../../types'

export function renderSummary(
  updates: ResolvedDepChange[],
  log: (...args: unknown[]) => void,
): void {
  const major = updates.filter((u) => u.diff === 'major').length
  const minor = updates.filter((u) => u.diff === 'minor').length
  const patch = updates.filter((u) => u.diff === 'patch').length

  const parts: string[] = []
  if (major) parts.push(c.red(`${major} major`))
  if (minor) parts.push(c.yellow(`${minor} minor`))
  if (patch) parts.push(c.green(`${patch} patch`))

  log(`  ${parts.join(c.gray(' | '))}  ${c.gray(`(${updates.length} total)`)}`)
  log()
}
