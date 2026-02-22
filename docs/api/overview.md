# API Overview

I exposed the internals. On purpose. You can `import` from `depfresh` and do whatever you want with your dependency graph. Build a dashboard. Wire it into your CI. Pipe it to `/dev/null` for all I care.

ESM-only, obviously. It's not 2019.

## Quick Start

```ts
import { check, resolveConfig } from 'depfresh'

const options = await resolveConfig({
  mode: 'minor',
  write: true,
})

const exitCode = await check(options)
process.exit(exitCode)
```

That's it. You've just built a worse version of the CLI. Congratulations.

## `DEFAULT_OPTIONS`

The defaults that ship with depfresh. Everything you don't override gets these values.

```ts
import { DEFAULT_OPTIONS } from 'depfresh'
```

```ts
{
  cwd: '.',
  recursive: true,
  mode: 'default',
  write: false,
  interactive: false,
  force: false,
  includeLocked: false,
  includeWorkspace: true,
  concurrency: 16,
  timeout: 10_000,        // 10 seconds
  retries: 2,
  cacheTTL: 1_800_000,    // 30 minutes
  output: 'table',
  loglevel: 'info',
  peer: false,
  global: false,
  ignorePaths: [
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/.git/**',
  ],
  ignoreOtherWorkspaces: true,
  all: false,
  group: true,
  sort: 'diff-asc',
  timediff: true,
  cooldown: 0,
  nodecompat: true,
  long: false,
  explain: false,
  failOnOutdated: false,
  install: false,
  update: false,
}
```

## Workflow Examples

### Custom CLI Wrapper

Build your own opinionated wrapper around depfresh. Because the existing CLI is apparently not opinionated enough.

```ts
import { check, resolveConfig } from 'depfresh'

async function safeUpdate() {
  const options = await resolveConfig({
    mode: 'minor',
    write: true,
    install: true,
    exclude: ['typescript', '@types/*'],
    beforePackageWrite(pkg) {
      const majors = pkg.resolved.filter(d => d.diff === 'major')
      if (majors.length > 0) {
        console.log(`Skipping ${pkg.name} — has major updates`)
        return false
      }
      return true
    },
  })

  const code = await check(options)
  process.exit(code)
}

safeUpdate()
```

### JSON Processing Pipeline

Parse the structured output without the CLI layer.

```ts
import { loadPackages, resolvePackage, resolveConfig } from 'depfresh'

async function getOutdatedReport() {
  const options = await resolveConfig({ mode: 'latest', loglevel: 'silent' })
  const packages = await loadPackages(options)

  const report = []

  for (const pkg of packages) {
    const resolved = await resolvePackage(pkg, options)
    const outdated = resolved.filter(d => d.diff !== 'none' && d.diff !== 'error')

    if (outdated.length > 0) {
      report.push({
        package: pkg.name,
        updates: outdated.map(d => ({
          name: d.name,
          from: d.currentVersion,
          to: d.targetVersion,
          diff: d.diff,
          deprecated: d.deprecated || false,
        })),
      })
    }
  }

  return report
}
```

### Per-Package Mode Overrides

Different update strategies for different dependencies. Because not all packages deserve the same level of trust.

```ts
import { check, resolveConfig } from 'depfresh'

const options = await resolveConfig({
  mode: 'minor',
  write: true,
  packageMode: {
    // Pin TypeScript to patch updates only
    'typescript': 'patch',
    // Let test tools go wild
    'vitest': 'latest',
    '@vitest/*': 'latest',
    // Ignore things I don't want to think about
    'webpack': 'ignore',
  },
})

await check(options)
```

---

## See Also

- [Exported Functions](./functions.md) -- every function you can import
- [Exported Types](./types.md) -- the full type catalogue
- [Error Classes](./errors.md) -- structured error handling
- [Lifecycle Callbacks](./functions.md#lifecycle-callbacks) -- hooks for fine-grained control
