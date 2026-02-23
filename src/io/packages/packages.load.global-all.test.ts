import { describe, expect, it, vi } from 'vitest'
import type { depfreshOptions } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { loadPackages } from './discovery'

const baseOptions = { ...DEFAULT_OPTIONS } as depfreshOptions

describe('loadPackages global mode variants', () => {
  it('uses loadGlobalPackagesAll when globalAll=true', async () => {
    const loadGlobalPackages = vi.fn(() => [])
    const loadGlobalPackagesAll = vi.fn(() => [
      {
        name: 'Global packages',
        type: 'global' as const,
        filepath: 'global:npm+pnpm+bun',
        deps: [],
        resolved: [],
        raw: {},
        indent: '  ',
      },
    ])

    vi.doMock('../global', () => ({
      loadGlobalPackages,
      loadGlobalPackagesAll,
    }))

    const packages = await loadPackages({
      ...baseOptions,
      global: true,
      globalAll: true,
      loglevel: 'silent',
    })

    expect(packages).toHaveLength(1)
    expect(packages[0]?.filepath).toBe('global:npm+pnpm+bun')
    expect(loadGlobalPackagesAll).toHaveBeenCalledTimes(1)
    expect(loadGlobalPackages).not.toHaveBeenCalled()

    vi.doUnmock('../global')
  })

  it('uses loadGlobalPackages when globalAll=false', async () => {
    const loadGlobalPackages = vi.fn(() => [
      {
        name: 'Global packages',
        type: 'global' as const,
        filepath: 'global:npm',
        deps: [],
        resolved: [],
        raw: {},
        indent: '  ',
      },
    ])
    const loadGlobalPackagesAll = vi.fn(() => [])

    vi.doMock('../global', () => ({
      loadGlobalPackages,
      loadGlobalPackagesAll,
    }))

    const packages = await loadPackages({
      ...baseOptions,
      global: true,
      globalAll: false,
      loglevel: 'silent',
    })

    expect(packages).toHaveLength(1)
    expect(packages[0]?.filepath).toBe('global:npm')
    expect(loadGlobalPackages).toHaveBeenCalledTimes(1)
    expect(loadGlobalPackagesAll).not.toHaveBeenCalled()

    vi.doUnmock('../global')
  })

  it('treats globalAll=true as global mode even when global=false', async () => {
    const loadGlobalPackages = vi.fn(() => [])
    const loadGlobalPackagesAll = vi.fn(() => [
      {
        name: 'Global packages',
        type: 'global' as const,
        filepath: 'global:npm+pnpm+bun',
        deps: [],
        resolved: [],
        raw: {},
        indent: '  ',
      },
    ])

    vi.doMock('../global', () => ({
      loadGlobalPackages,
      loadGlobalPackagesAll,
    }))

    const packages = await loadPackages({
      ...baseOptions,
      global: false,
      globalAll: true,
      loglevel: 'silent',
    })

    expect(packages).toHaveLength(1)
    expect(packages[0]?.filepath).toBe('global:npm+pnpm+bun')
    expect(loadGlobalPackagesAll).toHaveBeenCalledTimes(1)
    expect(loadGlobalPackages).not.toHaveBeenCalled()

    vi.doUnmock('../global')
  })
})
