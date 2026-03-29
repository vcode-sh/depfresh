import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { findUpSync } from 'find-up-simple'
import { parsePackageManagerField } from '../../io/packages/package-manager-field'
import type { PackageManagerName, PackageMeta } from '../../types'
import type { Logger } from '../../utils/logger'

export function detectPackageManager(cwd: string, packages: PackageMeta[]): PackageManagerName {
  for (const pkg of packages) {
    if (pkg.packageManager?.name) {
      return pkg.packageManager.name
    }
  }

  const manifestPm = detectPackageManagerFromManifest(cwd)
  if (manifestPm) return manifestPm

  if (findUpSync('bun.lock', { cwd }) || findUpSync('bun.lockb', { cwd })) return 'bun'
  if (findUpSync('pnpm-lock.yaml', { cwd })) return 'pnpm'
  if (findUpSync('yarn.lock', { cwd })) return 'yarn'
  return 'npm'
}

export async function runInstall(
  cwd: string,
  packages: PackageMeta[],
  logger: Logger,
): Promise<boolean> {
  const pm = detectPackageManager(cwd, packages)
  try {
    logger.info(`Running ${pm} install...`)
    execSync(`${pm} install`, { cwd, stdio: 'inherit' })
    return true
  } catch {
    logger.error(`${pm} install failed`)
    return false
  }
}

export async function runUpdate(
  cwd: string,
  packages: PackageMeta[],
  logger: Logger,
): Promise<boolean> {
  const pm = detectPackageManager(cwd, packages)
  try {
    logger.info(`Running ${pm} update...`)
    execSync(`${pm} update`, { cwd, stdio: 'inherit' })
    return true
  } catch {
    logger.error(`${pm} update failed`)
    return false
  }
}

function detectPackageManagerFromManifest(cwd: string): PackageManagerName | undefined {
  const packageJsonPath = findUpSync('package.json', { cwd })
  if (packageJsonPath) {
    try {
      const raw = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>
      if (typeof raw.packageManager === 'string') {
        return parsePackageManagerField(raw.packageManager)?.name
      }
    } catch {
      // ignore malformed manifests for PM detection fallback
    }
  }

  return undefined
}
