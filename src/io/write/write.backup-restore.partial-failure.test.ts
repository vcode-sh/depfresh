import * as fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { WriteError } from '../../errors'
import { restorePackageFiles } from './backup'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    writeFileSync: vi.fn(),
  }
})

describe('restorePackageFiles partial failure handling', () => {
  it('continues restoring remaining files after one restore fails', () => {
    const writeFileSyncMock = vi.mocked(fs.writeFileSync)
    let callCount = 0

    writeFileSyncMock.mockImplementation(() => {
      callCount += 1
      if (callCount === 1) {
        throw new Error('disk full')
      }
    })

    expect(() =>
      restorePackageFiles([
        { filepath: '/tmp/one.json', content: 'one' },
        { filepath: '/tmp/two.json', content: 'two' },
        { filepath: '/tmp/three.json', content: 'three' },
      ]),
    ).toThrow(WriteError)

    expect(writeFileSyncMock).toHaveBeenCalledTimes(3)
    expect(writeFileSyncMock).toHaveBeenNthCalledWith(1, '/tmp/one.json', 'one', 'utf-8')
    expect(writeFileSyncMock).toHaveBeenNthCalledWith(2, '/tmp/two.json', 'two', 'utf-8')
    expect(writeFileSyncMock).toHaveBeenNthCalledWith(3, '/tmp/three.json', 'three', 'utf-8')
  })
})
