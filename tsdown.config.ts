import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: 'esm',
  clean: true,
  dts: true,
  treeshake: true,
  target: 'node20',
  external: ['better-sqlite3'],
  banner: {
    js: '#!/usr/bin/env node',
  },
})
