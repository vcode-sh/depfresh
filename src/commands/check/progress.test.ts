import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { depfreshOptions, PackageMeta } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { visualLength } from '../../utils/format'
import { createCheckProgress } from './progress'

const baseOptions = { ...DEFAULT_OPTIONS, output: 'table', loglevel: 'info' } as depfreshOptions

function makePkg(name: string, eligible: number, skipped = 0): PackageMeta {
  return {
    name,
    type: 'package.json',
    filepath: `/tmp/${name}/package.json`,
    deps: Array.from({ length: eligible + skipped }, (_, index) => ({
      name: `dep-${index}`,
      currentVersion: index < eligible ? '^1.0.0' : '1.0.0',
      source: 'dependencies',
      update: index < eligible,
      parents: [],
    })),
    resolved: [],
    raw: { name },
    indent: '  ',
  }
}

describe('createCheckProgress', () => {
  const originalIsTTY = process.stdout.isTTY
  const originalColumns = process.stdout.columns
  const originalCi = process.env.CI
  const originalTerm = process.env.TERM
  let writeSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    delete process.env.CI
    process.env.TERM = 'xterm-256color'
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 120 })
  })

  afterEach(() => {
    vi.useRealTimers()
    writeSpy.mockRestore()
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: originalIsTTY })
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: originalColumns })
    restoreEnvironment('CI', originalCi)
    restoreEnvironment('TERM', originalTerm)
  })

  it('returns null without emitting cursor control for machine and redirected output', () => {
    expect(createCheckProgress({ ...baseOptions, output: 'json' })).toBeNull()
    expect(createCheckProgress({ ...baseOptions, loglevel: 'silent' })).toBeNull()
    expect(createCheckProgress({ ...baseOptions, loglevel: 'debug' })).toBeNull()
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false })
    expect(createCheckProgress(baseOptions)).toBeNull()
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it('returns null in CI and dumb terminals even when stdout is a TTY', () => {
    process.env.CI = '1'
    expect(createCheckProgress(baseOptions)).toBeNull()
    delete process.env.CI
    process.env.TERM = 'dumb'
    expect(createCheckProgress(baseOptions)).toBeNull()
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it('shows every expensive phase and coherent declaration counts', () => {
    const packages = [makePkg('alpha', 2, 1), makePkg('beta', 1)]
    const progress = createCheckProgress(baseOptions)

    progress!.onPackagesDiscovered(packages)
    progress!.onRepositoryInspectionStart()
    progress!.onPackagesReady(packages)
    progress!.onDependencyProcessed()
    progress!.onRenderingStart()
    progress!.onPackageRendered()
    progress!.done()

    const output = writtenOutput(writeSpy)
    expect(output).toContain('Discovering packages')
    expect(output).toContain('Inspecting repository evidence')
    expect(output).toContain('Resolving dependencies')
    expect(output).toContain('1/3')
    expect(output).toContain('Rendering results')
    expect(output).toContain('1/2')
    expect(output).toContain('2 packages · 4 declared · 3 eligible · 1 pinned')
  })

  it('coalesces dependency ticks and flushes the final state', () => {
    vi.useFakeTimers()
    const progress = createCheckProgress(baseOptions)
    progress!.onPackagesReady([makePkg('alpha', 4)])
    writeSpy.mockClear()

    progress!.onDependencyProcessed()
    progress!.onDependencyProcessed()
    progress!.onDependencyProcessed()
    expect(writeSpy).not.toHaveBeenCalled()

    vi.advanceTimersByTime(50)
    expect(writtenOutput(writeSpy)).toContain('3/4')

    writeSpy.mockClear()
    progress!.onDependencyProcessed()
    progress!.done()
    expect(writtenOutput(writeSpy)).toContain('4/4')
  })

  it('does not describe other skipped ranges as pinned versions', () => {
    const pkg = makePkg('alpha', 1)
    pkg.deps.push({
      name: 'policy-skipped',
      currentVersion: '^2.0.0',
      source: 'dependencies',
      update: false,
      parents: [],
    })
    const progress = createCheckProgress(baseOptions)
    progress!.onPackagesReady([pkg])

    expect(writtenOutput(writeSpy)).toContain('0 pinned · 1 other skipped')
    progress!.done()
  })

  it('relinquishes cursor ownership while durable output is written', () => {
    const progress = createCheckProgress(baseOptions)
    progress!.onPackagesReady([makePkg('alpha', 1)])
    writeSpy.mockClear()

    progress!.suspend(() => process.stdout.write('DURABLE TABLE\n'))

    const output = writtenOutput(writeSpy)
    const durableIndex = output.indexOf('DURABLE TABLE')
    expect(durableIndex).toBeGreaterThan(-1)
    expect(output.slice(0, durableIndex)).toContain('\x1B[2K')
    expect(output.slice(durableIndex)).toContain('Resolving dependencies')
    progress!.done()
  })

  it('retains cursor ownership across asynchronous durable output and failures', async () => {
    const progress = createCheckProgress(baseOptions)
    progress!.onPackagesReady([makePkg('alpha', 1)])
    writeSpy.mockClear()

    await expect(
      progress!.suspendAsync(async () => {
        process.stdout.write('ASYNC DURABLE\n')
        throw new Error('expected failure')
      }),
    ).rejects.toThrow('expected failure')

    const output = writtenOutput(writeSpy)
    expect(output.indexOf('ASYNC DURABLE')).toBeGreaterThan(-1)
    expect(output.slice(output.indexOf('ASYNC DURABLE'))).toContain('Resolving dependencies')
    progress!.done()
  })

  it('uses a readable fallback when a TTY reports zero columns', () => {
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 0 })
    const progress = createCheckProgress(baseOptions)

    expect(writtenOutput(writeSpy)).toContain('Discovering packages')
    progress!.done()
  })

  it.each([8, 10])('keeps every progress row within a %i-column terminal', (columns) => {
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: columns })
    const progress = createCheckProgress(baseOptions)
    progress!.onPackagesReady([makePkg('alpha', 3, 1)])
    progress!.suspend(() => process.stdout.write('DURABLE\n'))
    progress!.done()

    const writes: string[] = writeSpy.mock.calls.map((call: unknown[]) => String(call[0]))
    const visibleLines = writes
      .filter((line) => line.endsWith('\n'))
      .map((line) => line.replace('\r', '').replace('\x1B[2K\n', ''))
      .filter((line) => line.length > 0 && line !== 'DURABLE\n')

    expect(visibleLines.every((line) => visualLength(line) <= columns)).toBe(true)
    expect(writtenOutput(writeSpy)).not.toContain('\x1B[3A')
  })
})

function writtenOutput(writeSpy: ReturnType<typeof vi.spyOn>): string {
  return writeSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('')
}

function restoreEnvironment(name: 'CI' | 'TERM', value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
