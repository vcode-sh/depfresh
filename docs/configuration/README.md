# Configuration

You're here because defaults offend you. Fair enough. depfresh works perfectly fine out of the box, but if you insist on having opinions, these pages have you covered.

## Pages

- **[Config Files](./files.md)** -- Supported file formats (TypeScript, JavaScript, JSON, `package.json#depfresh`), zero-config defaults, private registries, `.npmrc` handling, and cache settings. Start here.

- **[Options Reference](./options.md)** -- Every option from the `depfreshOptions` interface,
  including explicit cohorts and ordered signal-effect policy.

- **[Workspaces](./workspaces.md)** -- Recursive scanning, nested workspace detection, workspace catalogs (pnpm, bun, yarn), and the `workspace:` protocol. For the monorepo crowd.

## Quick Config

```typescript
// depfresh.config.ts
import { defineConfig } from 'depfresh'

export default defineConfig({
  mode: 'latest',
  policyRules: [
    {
      id: 'payments-catalog-minor',
      selectors: { catalogName: '^payments$' },
      mode: 'minor',
    },
  ],
})
```

Rules target repository occurrences, not just package names. See
[Full Options](./options.md#occurrence-policy) for selectors, precedence, decision traces, and the
compatibility translation for `include`, `exclude`, `mode`, and `packageMode`.
Compatibility signal policy is documented under
[Compatibility signal policy](./options.md#compatibility-signal-policy).

For a one-run exact exclusion, prefer the CLI-only `--exclude-workspace <path>` or
`--exclude-catalog <name>` flags. They bind to repository evidence after inspection and do not add
top-level config fields or change the library API. Persistent patterns still belong in
`policyRules`.

`depfresh plan` and `plan()` intentionally do not evaluate executable configuration. Define
`cohorts` and `signalRules` as plain data in `.depfreshrc`, `depfresh.config.json`, or
`package.json#depfresh`, or pass them directly to `plan()`:

```json
{
  "cohorts": [
    { "id": "react-family", "members": ["react", "react-dom"], "strategy": "same-major" }
  ],
  "signalRules": [
    {
      "id": "block-peer-failures",
      "selectors": { "family": "peer", "state": "fail" },
      "effect": "block"
    }
  ]
}
```

That's everything. If you've read this far, you're either building something serious or procrastinating. Either way, I respect the commitment.

## See Also

- [CLI Reference](../cli/) -- all the flags
- [Programmatic API](../api/) -- using depfresh as a library
- [Output Formats](../output-formats/) -- JSON schema and table output behavior
