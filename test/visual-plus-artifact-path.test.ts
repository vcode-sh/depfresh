import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveVisualPlusCliPath } from './helpers/visual-plus-artifact-path.mjs'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'depfresh-visual-plus-artifact-path-'))
  roots.push(root)
  const installRoot = join(root, 'installed-package')
  const cliPath = join(installRoot, 'dist', 'cli.mjs')
  mkdirSync(join(installRoot, 'dist'), { recursive: true })
  writeFileSync(cliPath, 'export {}\n')
  return { cliPath, installRoot, root }
}

describe('Visual+ artifact CLI path', () => {
  it('uses the source distribution CLI when no artifact pair is supplied', () => {
    const selected = resolveVisualPlusCliPath({})

    expect(isAbsolute(selected.cliPath)).toBe(true)
    expect(selected.cliPath).toBe(resolve('dist/cli.mjs'))
    expect(selected.installRoot).toBeUndefined()
  })

  it('accepts only a canonical regular CLI contained by its paired install root', () => {
    const { cliPath, installRoot } = fixture()

    expect(resolveVisualPlusCliPath({ cliPath, installRoot })).toEqual({
      cliPath: realpathSync(cliPath),
      installRoot: realpathSync(installRoot),
    })
  })

  it.each([
    [{ cliPath: '/tmp/cli.mjs' }, /pair/i],
    [{ installRoot: '/tmp/install' }, /pair/i],
    [{ cliPath: 'relative-cli.mjs', installRoot: '/tmp/install' }, /absolute/i],
    [{ cliPath: '/tmp/cli.mjs', installRoot: 'relative-install' }, /absolute/i],
  ] as const)('rejects incomplete or relative artifact inputs', (input, message) => {
    expect(() => resolveVisualPlusCliPath(input)).toThrow(message)
  })

  it('rejects a CLI outside the canonical install root', () => {
    const { root, installRoot } = fixture()
    const outsideCli = join(root, 'outside-cli.mjs')
    writeFileSync(outsideCli, 'export {}\n')

    expect(() => resolveVisualPlusCliPath({ cliPath: outsideCli, installRoot })).toThrow(
      /contained/i,
    )
  })

  it('rejects a missing CLI without reflecting its input path', () => {
    const { installRoot, root } = fixture()
    const missingCli = join(root, 'private-missing-cli.mjs')

    expect(() => resolveVisualPlusCliPath({ cliPath: missingCli, installRoot })).toThrow(
      /regular file/i,
    )
    try {
      resolveVisualPlusCliPath({ cliPath: missingCli, installRoot })
    } catch (error) {
      expect(error).not.toMatchObject({ message: expect.stringContaining(missingCli) })
    }
  })

  it('rejects symlinked and non-file CLI paths', () => {
    const { cliPath, installRoot } = fixture()
    const directoryCli = join(installRoot, 'dist', 'directory.mjs')
    const symlinkCli = join(installRoot, 'dist', 'symlink.mjs')
    mkdirSync(directoryCli)
    symlinkSync(cliPath, symlinkCli)

    expect(() => resolveVisualPlusCliPath({ cliPath: directoryCli, installRoot })).toThrow(
      /regular file/i,
    )
    expect(() => resolveVisualPlusCliPath({ cliPath: symlinkCli, installRoot })).toThrow(/symlink/i)
  })
})
