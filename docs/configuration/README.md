# Configuration

You're here because defaults offend you. Fair enough. depfresh works perfectly fine out of the box, but if you insist on having opinions, these pages have you covered.

## Pages

- **[Config Files](./files.md)** -- Supported file formats (TypeScript, JavaScript, JSON, `package.json#depfresh`), zero-config defaults, private registries, `.npmrc` handling, and cache settings. Start here.

- **[Options Reference](./options.md)** -- Every option from the `depfreshOptions` interface, organised by category. Core, filtering, performance, output, paths, display, invocation-only phases, addons, and callbacks. The exhaustive list.

- **[Workspaces](./workspaces.md)** -- Recursive scanning, nested workspace detection, workspace catalogs (pnpm, bun, yarn), and the `workspace:` protocol. For the monorepo crowd.

## Quick Config

```typescript
// depfresh.config.ts
import { defineConfig } from 'depfresh'

export default defineConfig({
  mode: 'latest',
  policyRules: [
    {
      id: 'native-catalog-minor',
      selectors: { catalogName: 'native' },
      mode: 'minor',
    },
  ],
})
```

Rules target repository occurrences, not just package names. See
[Full Options](./options.md#occurrence-policy) for selectors, precedence, decision traces, and the
compatibility translation for `include`, `exclude`, `mode`, and `packageMode`.

That's everything. If you've read this far, you're either building something serious or procrastinating. Either way, I respect the commitment.

## See Also

- [CLI Reference](../cli/) -- all the flags
- [Programmatic API](../api/) -- using depfresh as a library
- [Output Formats](../output-formats/) -- JSON schema and table output behavior
