import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'pathe'
import type { PackageManagerName, PackageMeta } from '../../types'
import type { Logger } from '../../utils/logger'

export function detectPackageManager(cwd: string, packages: PackageMeta[]): PackageManagerName {
  for (const pkg of packages) {
    if (pkg.packageManager?.name) {
      return pkg.packageManager.name
    }
  }

  if (existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb'))) return 'bun'
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

export async function runInstall(
  cwd: string,
  packages: PackageMeta[],
  logger: Logger,
): Promise<void> {
  const pm = detectPackageManager(cwd, packages)
  try {
    logger.info(`Running ${pm} install...`)
    execSync(`${pm} install`, { cwd, stdio: 'inherit' })
  } catch {
    logger.error(`${pm} install failed`)
  }
}

export async function runUpdate(
  cwd: string,
  packages: PackageMeta[],
  logger: Logger,
): Promise<void> {
  const pm = detectPackageManager(cwd, packages)
  try {
    logger.info(`Running ${pm} update...`)
    execSync(`${pm} update`, { cwd, stdio: 'inherit' })
  } catch {
    logger.error(`${pm} update failed`)
  }
}
