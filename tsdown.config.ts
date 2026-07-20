import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli/index.ts',
  },
  format: 'esm',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: false,
  dts: {
    resolver: 'oxc',
    sourcemap: false,
  },
  outExtensions: () => ({ js: '.mjs', dts: '.d.ts' }),
  banner: ({ fileName }) => (fileName === 'cli.mjs' ? '#!/usr/bin/env node' : undefined),
  deps: {
    skipNodeModulesBundle: true,
  },
  copy: [{ from: 'schemas/*.json', to: 'dist/schemas' }],
})
