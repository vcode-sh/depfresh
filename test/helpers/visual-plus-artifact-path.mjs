import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export function resolveVisualPlusCliPath(options) {
  const cliPath = options.cliPath
  const installRoot = options.installRoot
  if (cliPath === undefined && installRoot === undefined) {
    return { cliPath: join(sourceRoot, 'dist', 'cli.mjs'), installRoot: undefined }
  }
  if (typeof cliPath !== 'string' || typeof installRoot !== 'string') {
    throw new Error('Artifact CLI and install root must be supplied as a pair')
  }
  if (!(isAbsolute(cliPath) && isAbsolute(installRoot))) {
    throw new Error('Artifact CLI and install root must be absolute paths')
  }

  let cliStat
  try {
    cliStat = lstatSync(cliPath)
  } catch {
    throw new Error('Artifact CLI must be a regular file')
  }
  if (cliStat.isSymbolicLink()) throw new Error('Artifact CLI must not be a symlink')
  if (!cliStat.isFile()) throw new Error('Artifact CLI must be a regular file')

  let canonicalCliPath
  let canonicalInstallRoot
  try {
    canonicalCliPath = realpathSync(cliPath)
    canonicalInstallRoot = realpathSync(installRoot)
  } catch {
    throw new Error('Artifact CLI and install root must resolve canonically')
  }
  const containment = relative(canonicalInstallRoot, canonicalCliPath)
  if (containment === '' || containment.startsWith('..') || isAbsolute(containment)) {
    throw new Error('Artifact CLI must be contained by the canonical install root')
  }
  return { cliPath: canonicalCliPath, installRoot: canonicalInstallRoot }
}
