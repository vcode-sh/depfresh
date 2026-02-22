import type { PackageManagerName, PackageMeta } from '../../types'

export function parsePackageManagerField(raw: string): PackageMeta['packageManager'] {
  // Format: name@version or name@version+hash
  const match = raw.match(/^(npm|pnpm|yarn|bun)@([^+]+)(?:\+(.+))?$/)
  if (!match) return undefined

  return {
    name: match[1] as PackageManagerName,
    version: match[2]!,
    hash: match[3],
    raw,
  }
}
