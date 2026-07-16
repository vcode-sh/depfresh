import { describe, expect, it } from 'vitest'
import type { RepositoryModel } from '../types'
import { collectFingerprintSources } from './repository-projection'

describe('repository contract projection', () => {
  it('rejects conflicting hashes observed for the same physical source path', () => {
    const model = {
      schemaVersion: 1,
      rootId: 'repository-1',
      sourceFiles: [
        {
          id: 'source-1',
          path: 'package.json',
          format: 'json',
          byteHash: 'a'.repeat(64),
          parseState: 'parsed',
          indent: '  ',
          newline: 'lf',
          trailingNewline: true,
        },
      ],
      packages: [],
      catalogs: [],
      runtimeDeclarations: [
        {
          id: 'runtime-1',
          boundaryId: 'boundary-1',
          kind: 'engines-node',
          path: 'package.json',
          field: 'engines.node',
          declaredText: '>=24',
          byteHash: 'b'.repeat(64),
        },
      ],
      occurrences: [],
      relationships: { workspaceMembers: [], catalogConsumers: [] },
      diagnostics: [],
      evidenceRefs: [],
    } satisfies RepositoryModel

    expect(() => collectFingerprintSources(model)).toThrow(
      expect.objectContaining({
        code: 'ERR_CONTRACT',
        reason: 'SOURCE_SNAPSHOT_CONFLICT',
      }),
    )
  })
})
