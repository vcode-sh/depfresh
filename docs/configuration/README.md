# Configuration

You're here because defaults offend you. Fair enough. depfresh works perfectly fine out of the box, but if you insist on having opinions, these pages have you covered.

## Pages

- **[Config Files](./files.md)** -- Supported file formats (`depfresh.config.ts`, `.depfreshrc`, `package.json#depfresh`), zero-config defaults, private registries, `.npmrc` handling, and cache settings. Start here.

- **[Options Reference](./options.md)** -- Every option from the `depfreshOptions` interface, organised by category. Core, filtering, performance, output, paths, display, post-write, and callbacks. The exhaustive list.

- **[Workspaces](./workspaces.md)** -- Recursive scanning, nested workspace detection, workspace catalogs (pnpm, bun, yarn), and the `workspace:` protocol. For the monorepo crowd.

## Quick Config

```typescript
// depfresh.config.ts
import { defineConfig } from 'depfresh'

export default defineConfig({
  mode: 'minor',
  exclude: ['webpack'],
  packageMode: {
    'typescript': 'latest',
    '/^@types/': 'patch',
  },
})
```

That's everything. If you've read this far, you're either building something serious or procrastinating. Either way, I respect the commitment.

## See Also

- [CLI Reference](../cli/) -- all the flags
- [Programmatic API](../api/) -- using depfresh as a library
- [Output Formats](../output-formats/) -- JSON schema and table output behavior
