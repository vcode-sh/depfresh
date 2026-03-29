import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOptions, type CheckMocks, makePkg, makeResolved, setupMocks } from './test-helpers'

const clackMock = {
  groupMultiselect: vi.fn(),
  multiselect: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}

vi.mock('@clack/prompts', () => clackMock)

const stdinTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
const stdoutTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
const setRawModeDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'setRawMode')

function setTTY(stdinTTY: boolean, stdoutTTY: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { value: stdinTTY, configurable: true })
  Object.defineProperty(process.stdout, 'isTTY', { value: stdoutTTY, configurable: true })
}

describe('interactive fallback integration', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    mocks = await setupMocks()
    clackMock.isCancel.mockReturnValue(false)
    Object.defineProperty(process.stdin, 'setRawMode', {
      value: undefined,
      configurable: true,
      writable: true,
    })
    setTTY(true, true)
  })

  afterAll(() => {
    if (stdinTTYDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', stdinTTYDescriptor)
    }
    if (stdoutTTYDescriptor) {
      Object.defineProperty(process.stdout, 'isTTY', stdoutTTYDescriptor)
    }
    if (setRawModeDescriptor) {
      Object.defineProperty(process.stdin, 'setRawMode', setRawModeDescriptor)
    }
  })

  it('falls back to clack and preserves original update order before writing', async () => {
    const pkg = makePkg('my-app')
    const updates = [
      makeResolved({ name: 'dep-a', diff: 'major', source: 'dependencies' }),
      makeResolved({ name: 'dep-b', diff: 'minor', source: 'devDependencies' }),
      makeResolved({ name: 'dep-c', diff: 'patch', source: 'peerDependencies' }),
    ]

    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue(updates)
    clackMock.groupMultiselect.mockResolvedValue(['2', '0'])

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, write: true, interactive: true })

    expect(result).toBe(0)
    expect(clackMock.groupMultiselect).toHaveBeenCalledOnce()
    expect(mocks.writePackageMock).toHaveBeenCalledWith(pkg, [updates[0], updates[2]], 'silent')
  })
})
