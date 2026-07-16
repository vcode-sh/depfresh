# API Overview

I exposed the internals. On purpose. You can `import` from `depfresh` and do whatever you want with your dependency graph. Build a dashboard. Wire it into your CI. Pipe it to `/dev/null` for all I care.

ESM-only, obviously. It's not 2019.

## Quick Start

For a reviewable machine workflow, use the typed contracts directly:

```ts
import { apply, createInvocationAuthority, inspect, plan } from 'depfresh'

const evidence = await inspect({ cwd: process.cwd() })
const dependencyPlan = await plan({ cwd: process.cwd(), mode: 'minor' })

console.log(evidence.repository.fingerprint, dependencyPlan.planFingerprint)

const applied = await apply(
  dependencyPlan,
  { cwd: process.cwd() },
  createInvocationAuthority({ write: true }),
)
console.log(applied.status, applied.summary)
```

Manager phases are planned and granted separately:

```ts
const dependencyPlan = await plan({
  cwd: process.cwd(),
  mode: 'minor',
  syncLockfile: true,
  verifyArgv: ['pnpm', 'test'],
})
const applied = await apply(
  dependencyPlan,
  { cwd: process.cwd() },
  createInvocationAuthority({ write: true, syncLockfile: true, verify: true }),
)
```

The plan fixes the manager/version, parsed lockfile hash, no-shell argv, timeout, allowed paths, and
verification argv. Configuration cannot supply those grants.

Exact public-npm artifact verification is an install-only authority:

```ts
const dependencyPlan = await plan({
  cwd: process.cwd(),
  mode: 'minor',
  install: true,
  verifyArtifacts: true,
})
const applied = await apply(
  dependencyPlan,
  { cwd: process.cwd() },
  createInvocationAuthority({ write: true, install: true, verifyArtifacts: true }),
)
```

The resulting authority snapshot contains separate artifact-verification and network grants. The
plan, configuration, and passive registry metadata grant neither.

These functions return data and never exit the process. `inspect()` and `plan()` are non-mutating;
`apply()` requires a separate explicit authority snapshot and exact file preconditions. Fatal
input/configuration/runtime failures throw structured errors for the caller to handle.

Global mutation has its own contract and authority:

```ts
import {
  applyGlobalPlan,
  createGlobalApplyPlan,
  createGlobalInvocationAuthority,
} from 'depfresh'

const globalPlan = await createGlobalApplyPlan(
  [{ manager: 'pnpm', name: 'typescript', expectedVersion: '5.7.2', targetVersion: '5.8.3' }],
  { cwd: process.cwd() },
)
const globalResult = await applyGlobalPlan(
  globalPlan,
  { cwd: process.cwd() },
  createGlobalInvocationAuthority(['pnpm'], { globalWrite: true, processExecute: true }),
)
```

Planning inventories the exact manager executable, supported version, global realm, and installed
package. Apply preflights all items and derives terminal truth from fresh post-command inventory.
It never claims rollback for global package-manager effects.

The legacy check API remains available:

```ts
import { check, resolveConfig } from 'depfresh'

const options = await resolveConfig({
  mode: 'minor',
  write: true,
})

const exitCode = await check(options)
process.exit(exitCode)
```

That's it. You've just built a worse version of the legacy CLI. Congratulations.

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
  globalAll: false,
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
  explainDiscovery: false,
  profile: false,
  failOnOutdated: false,
  failOnResolutionErrors: false,
  failOnNoPackages: false,
  install: false,          // invocation-only manager phase
  verifyArtifacts: false,  // invocation-only exact artifact verification
  update: false,
  strictPostWrite: false,  // legacy option; explicit use is rejected
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

### Occurrence Policy

Different update strategies for exact dependency occurrences, without coupling policy to write authority.

```ts
import { check, resolveConfig } from 'depfresh'

const options = await resolveConfig({
  mode: 'latest',
  write: true,
  policyRules: [
    {
      id: 'native-catalog-minor',
      selectors: { catalogName: 'native' },
      mode: 'minor',
    },
    {
      id: 'legacy-app-exclude',
      selectors: { workspacePath: 'apps/legacy' },
      action: 'exclude',
    },
  ],
})

await check(options)
```

---

## See Also

- [Exported Functions](./functions.md) -- every function you can import
- [Exported Types](./types.md) -- the full type catalogue
- [Error Classes](./errors.md) -- structured error handling
- [Lifecycle Callbacks](./functions.md#lifecycle-callbacks) -- hooks for fine-grained control
- [Addons](./functions.md#addons) -- reusable plugin hooks for shared workflows
