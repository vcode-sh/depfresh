import { basename, dirname } from 'pathe'

const MANIFEST_PRIORITY: Record<string, number> = {
  'package.yaml': 2,
  'package.json': 1,
}

export function selectPreferredManifest(filepaths: string[]): string {
  return [...filepaths].sort((a, b) => {
    const priorityDiff =
      (MANIFEST_PRIORITY[basename(b)] ?? 0) - (MANIFEST_PRIORITY[basename(a)] ?? 0)
    if (priorityDiff !== 0) return priorityDiff
    return a.localeCompare(b)
  })[0]!
}

export function dedupeManifestsByDirectory(filepaths: string[]): string[] {
  const byDirectory = new Map<string, string[]>()

  for (const filepath of filepaths) {
    const dir = dirname(filepath)
    const group = byDirectory.get(dir) ?? []
    group.push(filepath)
    byDirectory.set(dir, group)
  }

  const selected: string[] = []
  for (const dir of [...byDirectory.keys()].sort((a, b) => a.localeCompare(b))) {
    selected.push(selectPreferredManifest(byDirectory.get(dir)!))
  }

  return selected
}
