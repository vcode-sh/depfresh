import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    'src/index',
    'src/cli',
    {
      builder: 'copy',
      input: 'schemas',
      outDir: 'dist/schemas',
    },
  ],
  declaration: true,
  clean: true,
  hooks: {
    'rollup:dts:options': (_context, options) => {
      options.maxParallelFileOps = 1
    },
  },
  rollup: {
    emitCJS: false,
    inlineDependencies: true,
    output: {
      banner: (chunk) =>
        chunk.fileName === 'cli.mjs' ? '#!/usr/bin/env node' : '',
    },
  },
})
