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
  rollup: {
    emitCJS: false,
    inlineDependencies: true,
    output: {
      banner: (chunk) =>
        chunk.fileName === 'cli.mjs' ? '#!/usr/bin/env node' : '',
    },
  },
})
