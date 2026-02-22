import { readFileSync, writeFileSync } from 'node:fs'
import { WriteError } from '../../errors'
import type { PackageMeta } from '../../types'

export interface FileBackup {
  filepath: string
  content: string
}

export function backupPackageFiles(pkg: PackageMeta): FileBackup[] {
  const backups: FileBackup[] = []

  // Backup main package file
  let mainContent: string
  try {
    mainContent = readFileSync(pkg.filepath, 'utf-8')
  } catch (error) {
    throw new WriteError(`Failed to backup file ${pkg.filepath}`, { cause: error })
  }
  backups.push({
    filepath: pkg.filepath,
    content: mainContent,
  })

  // Backup catalog files if present
  if (pkg.catalogs?.length) {
    for (const catalog of pkg.catalogs) {
      let catalogContent: string
      try {
        catalogContent = readFileSync(catalog.filepath, 'utf-8')
      } catch (error) {
        throw new WriteError(`Failed to backup file ${catalog.filepath}`, { cause: error })
      }
      backups.push({
        filepath: catalog.filepath,
        content: catalogContent,
      })
    }
  }

  return backups
}

export function restorePackageFiles(backups: FileBackup[]): void {
  for (const backup of backups) {
    try {
      writeFileSync(backup.filepath, backup.content, 'utf-8')
    } catch (error) {
      throw new WriteError(`Failed to restore file ${backup.filepath}`, { cause: error })
    }
  }
}
