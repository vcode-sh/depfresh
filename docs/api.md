# Programmatic API

I exposed the internals. On purpose. You can `import` from `bump-cli` and do whatever you want with your dependency graph. Build a dashboard. Wire it into your CI. Pipe it to `/dev/null` for all I care.

ESM-only, obviously. It's not 2019.

## Quick Start

```ts
import { check, resolveConfig } from 'bump-cli'

const options = await resolveConfig({
  mode: 'minor',
  write: true,
})

const exitCode = await check(options)
process.exit(exitCode)
```

That's it. You've just built a worse version of the CLI. Congratulations.

## Exported Functions

### `check(options)`

The main event. Loads packages, resolves dependencies against the registry, renders output, and optionally writes updates. Everything the CLI does, minus the argument parsing.

```ts
function check(options: BumpOptions): Promise<number>
```

**Returns** an exit code:
- `0` — no updates found, or updates were written successfully
- `1` — updates available (only when `failOnOutdated: true` and `write: false`)
- `2` — something went wrong

```ts
import { check, resolveConfig } from 'bump-cli'

const options = await resolveConfig({ mode: 'latest', write: true })
const code = await check(options)

if (code === 2) {
  console.error('Well that did not work')
}
```

---

### `resolveConfig(overrides?)`

Merges your overrides with config file values (`.bumprc`, `bump.config.ts`, `package.json#bump`) and `DEFAULT_OPTIONS`. Config file wins over defaults. Your overrides win over everything.

```ts
function resolveConfig(overrides?: Partial<BumpOptions>): Promise<BumpOptions>
```

**Config resolution order** (highest priority first):
1. `overrides` argument
2. Config file (`.bumprc`, `bump.config.ts`, `bump.config.js`)
3. `package.json` `"bump"` field
4. `DEFAULT_OPTIONS`

```ts
import { resolveConfig } from 'bump-cli'

// Just defaults + config file
const options = await resolveConfig()

// Override specific options
const options = await resolveConfig({
  cwd: '/path/to/project',
  mode: 'patch',
  concurrency: 4,
})
```

---

### `defineConfig(options)`

A type helper for config files. Does literally nothing at runtime. Returns exactly what you pass in. But your editor will autocomplete, and that's apparently worth an import.

```ts
function defineConfig(options: Partial<BumpOptions>): Partial<BumpOptions>
```

```ts
// bump.config.ts
import { defineConfig } from 'bump-cli'

export default defineConfig({
  mode: 'minor',
  exclude: ['typescript'],
  group: true,
})
```

---

### `loadPackages(options)`

Finds and parses `package.json` files in your project. Respects `recursive`, `ignorePaths`, `ignoreOtherWorkspaces`. Also loads workspace catalogs (pnpm, bun, yarn) and global packages if `global: true`.

```ts
function loadPackages(options: BumpOptions): Promise<PackageMeta[]>
```

```ts
import { loadPackages, resolveConfig } from 'bump-cli'

const options = await resolveConfig({ recursive: true })
const packages = await loadPackages(options)

for (const pkg of packages) {
  console.log(`${pkg.name}: ${pkg.deps.length} dependencies`)
}
```

---

### `resolvePackage(pkg, options, externalCache?, externalNpmrc?, privatePackages?)`

Resolves every dependency in a package against the registry. Handles caching, concurrency, version filtering, and the `onDependencyResolved` callback. This is where the network calls happen.

```ts
function resolvePackage(
  pkg: PackageMeta,
  options: BumpOptions,
  externalCache?: Cache,
  externalNpmrc?: NpmrcConfig,
  privatePackages?: Set<string>,
): Promise<ResolvedDepChange[]>
```

| Param | Description |
|-------|-------------|
| `pkg` | The package to resolve |
| `options` | Full bump options (mode, concurrency, timeout, etc.) |
| `externalCache?` | Reuse a cache across multiple packages. If omitted, creates and closes its own |
| `externalNpmrc?` | Pre-loaded npmrc config. If omitted, loads from disk |
| `privatePackages?` | Set of workspace package names to skip (no point hitting the registry for local deps) |

```ts
import { loadPackages, resolvePackage, resolveConfig } from 'bump-cli'

const options = await resolveConfig({ mode: 'latest' })
const packages = await loadPackages(options)

for (const pkg of packages) {
  const resolved = await resolvePackage(pkg, options)
  const updates = resolved.filter(d => d.diff !== 'none')
  console.log(`${pkg.name}: ${updates.length} updates available`)
}
```

---

### `parseDependencies(raw, options)`

Extracts dependencies from a parsed `package.json` object. Handles all standard fields, overrides, resolutions, nested overrides, protocols (`npm:`, `jsr:`), include/exclude filters, and locked version detection.

```ts
function parseDependencies(
  raw: Record<string, unknown>,
  options: BumpOptions,
): RawDep[]
```

```ts
import { parseDependencies, resolveConfig } from 'bump-cli'

const options = await resolveConfig()
const raw = JSON.parse(fs.readFileSync('package.json', 'utf-8'))
const deps = parseDependencies(raw, options)

console.log(`Found ${deps.length} dependencies`)
console.log(`${deps.filter(d => d.update).length} will be checked`)
```

---

### `writePackage(pkg, changes, loglevel?)`

Writes resolved changes back to the package file. Preserves indentation, line endings (CRLF too, you're welcome Windows users), and key order. Handles both regular `package.json` and workspace catalog files.

```ts
function writePackage(
  pkg: PackageMeta,
  changes: ResolvedDepChange[],
  loglevel?: 'silent' | 'info' | 'debug',
): void
```

```ts
import { loadPackages, resolvePackage, writePackage, resolveConfig } from 'bump-cli'

const options = await resolveConfig({ mode: 'minor' })
const [pkg] = await loadPackages(options)

const resolved = await resolvePackage(pkg, options)
const minorOnly = resolved.filter(d => d.diff === 'minor' || d.diff === 'patch')

writePackage(pkg, minorOnly, 'silent')
```

---

### `loadGlobalPackages(pm?)`

Lists globally installed packages for a given package manager. Auto-detects which PM is available if you don't specify (tries pnpm, then bun, then npm).

```ts
function loadGlobalPackages(pm?: string): PackageMeta[]
```

```ts
import { loadGlobalPackages } from 'bump-cli'

const packages = loadGlobalPackages('npm')
for (const pkg of packages) {
  for (const dep of pkg.deps) {
    console.log(`${dep.name}@${dep.currentVersion}`)
  }
}
```

---

### `writeGlobalPackage(pm, name, version)`

Updates a single global package. Shells out to the relevant package manager's install command. Not subtle.

```ts
function writeGlobalPackage(
  pm: PackageManagerName,
  name: string,
  version: string,
): void
```

```ts
import { writeGlobalPackage } from 'bump-cli'

writeGlobalPackage('npm', 'typescript', '5.7.0')
// Runs: npm install -g typescript@5.7.0
```

---

## Lifecycle Callbacks

Seven hooks. Called in order. All optional. All async-compatible. Wire them into `BumpOptions` and `check()` will call them at the right moment.

### Call Order

```
check() starts
  │
  ├─ loadPackages()
  │
  ├─ afterPackagesLoaded(pkgs)
  │
  ├─ for each package:
  │   ├─ beforePackageStart(pkg)
  │   ├─ resolvePackage()
  │   │   └─ onDependencyResolved(pkg, dep)  ← called per dep as it resolves
  │   ├─ afterPackageEnd(pkg)
  │   │
  │   └─ if writing:
  │       ├─ beforePackageWrite(pkg)  ← return false to skip
  │       └─ afterPackageWrite(pkg)
  │
  └─ afterPackagesEnd(pkgs)
```

### `afterPackagesLoaded(pkgs)`

Called once after all packages have been discovered and parsed, before any resolution starts. Good for filtering, logging, or questioning your life choices.

```ts
afterPackagesLoaded?: (pkgs: PackageMeta[]) => void | Promise<void>
```

### `beforePackageStart(pkg)`

Called before each package starts resolving. The `pkg.deps` array is populated but `pkg.resolved` is still empty.

```ts
beforePackageStart?: (pkg: PackageMeta) => void | Promise<void>
```

### `onDependencyResolved(pkg, dep)`

Called as each individual dependency finishes resolving. This is your streaming hook -- build a progress bar, update a UI, send a webhook, whatever keeps you entertained.

```ts
onDependencyResolved?: (pkg: PackageMeta, dep: ResolvedDepChange) => void | Promise<void>
```

### `afterPackageEnd(pkg)`

Called after each package is fully resolved (and optionally written). `pkg.resolved` is now populated.

```ts
afterPackageEnd?: (pkg: PackageMeta) => void | Promise<void>
```

### `beforePackageWrite(pkg)`

Called before writing changes to disk. Return `false` to skip this package. Return `true` (or nothing) to proceed. This is your last chance to prevent regrettable decisions.

```ts
beforePackageWrite?: (pkg: PackageMeta) => boolean | Promise<boolean>
```

### `afterPackageWrite(pkg)`

Called after the file has been written. The damage is done. Use this for logging, notifications, or post-write commands.

```ts
afterPackageWrite?: (pkg: PackageMeta) => void | Promise<void>
```

### `afterPackagesEnd(pkgs)`

Called once after all packages have been processed. The final callback. End of the line.

```ts
afterPackagesEnd?: (pkgs: PackageMeta[]) => void | Promise<void>
```

### Callback Examples

**Streaming progress:**

```ts
let resolved = 0
let total = 0

const options = await resolveConfig({
  mode: 'latest',
  afterPackagesLoaded(pkgs) {
    total = pkgs.reduce((sum, p) => sum + p.deps.filter(d => d.update).length, 0)
    console.log(`Checking ${total} dependencies across ${pkgs.length} packages...`)
  },
  onDependencyResolved(_pkg, dep) {
    resolved++
    process.stdout.write(`\r[${resolved}/${total}] ${dep.name}`)
  },
  afterPackagesEnd() {
    process.stdout.write('\n')
    console.log('Done.')
  },
})

await check(options)
```

**Conditional write -- skip specific packages:**

```ts
const options = await resolveConfig({
  write: true,
  mode: 'minor',
  beforePackageWrite(pkg) {
    // Never auto-update the root package
    if (pkg.name === 'my-monorepo-root') {
      console.log(`Skipping ${pkg.name}`)
      return false
    }
    return true
  },
  afterPackageWrite(pkg) {
    console.log(`Updated ${pkg.filepath}`)
  },
})

await check(options)
```

---

## Exported Types

| Type | What it is |
|------|-----------|
| `BumpOptions` | The full options object. Every flag, callback, and setting lives here |
| `CatalogSource` | A workspace catalog entry (pnpm/bun/yarn) with its deps and file path |
| `DepFieldType` | Union of dependency field names: `'dependencies'`, `'devDependencies'`, `'overrides'`, etc. |
| `DiffType` | Version diff classification: `'major'` \| `'minor'` \| `'patch'` \| `'none'` \| `'error'` |
| `NpmrcConfig` | Parsed `.npmrc` — registries, auth tokens, proxy settings |
| `OutputFormat` | Output mode: `'table'` \| `'json'` \| `'sarif'` |
| `PackageData` | Raw registry metadata for a package — versions, dist-tags, timestamps, deprecations |
| `PackageManagerField` | Parsed `packageManager` field from `package.json` (name, version, hash) |
| `PackageManagerName` | `'npm'` \| `'pnpm'` \| `'yarn'` \| `'bun'` |
| `PackageMeta` | A loaded package with its file path, raw deps, resolved changes, and indent info |
| `PackageType` | `'package.json'` \| `'pnpm-workspace'` \| `'bun-workspace'` \| `'yarn-workspace'` \| `'global'` |
| `ProvenanceLevel` | Provenance attestation: `'trusted'` \| `'attested'` \| `'none'` |
| `RangeMode` | Version resolution strategy: `'default'` \| `'major'` \| `'minor'` \| `'patch'` \| `'latest'` \| `'newest'` \| `'next'` \| `'ignore'` |
| `RawDep` | A dependency before resolution — name, current version, source field, update flag |
| `RegistryConfig` | A single registry entry — URL, auth token, scope |
| `ResolvedDepChange` | A dependency after resolution — extends `RawDep` with target version, diff, metadata |
| `SortOption` | Sort order for output: `'diff-asc'` \| `'diff-desc'` \| `'time-asc'` \| `'time-desc'` \| `'name-asc'` \| `'name-desc'` |
| `UpdateScore` | Confidence scoring for an update — confidence, maturity, adoption, breaking flag |

---

## `DEFAULT_OPTIONS`

The defaults that ship with bump. Everything you don't override gets these values.

```ts
import { DEFAULT_OPTIONS } from 'bump-cli'
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

---

## Error Classes

All errors thrown by bump extend `BumpError`, which gives you a stable `code` string for branching and an optional `cause` for wrapping underlying failures. Import them directly:

```ts
import {
  BumpError,
  RegistryError,
  CacheError,
  ConfigError,
  WriteError,
  ResolveError,
} from 'bump-cli'
```

| Class | Code | When it fires |
|-------|------|---------------|
| `BumpError` | (base) | Abstract base. Use `instanceof BumpError` to catch everything bump throws. |
| `RegistryError` | `ERR_REGISTRY` | HTTP errors from the npm/JSR registry. Has `.status` (number) and `.url` (string). 4xx errors don't retry. 5xx errors do. |
| `CacheError` | `ERR_CACHE` | SQLite failures, corrupt entries, connection issues. bump logs and falls back to memory cache -- you'll only see this if you're using the cache API directly. |
| `ConfigError` | `ERR_CONFIG` | Invalid config file, malformed regex patterns in `include`/`exclude`, bad `packageMode` entries. Thrown during `resolveConfig()` or `parseDependencies()`. |
| `WriteError` | `ERR_WRITE` | File system failures during package writes. Permission denied, disk full, the usual suspects. |
| `ResolveError` | `ERR_RESOLVE` | Network timeouts, DNS failures, fetch errors that aren't HTTP status codes. The "something went wrong between you and the registry" bucket. |

```ts
import { check, resolveConfig, RegistryError, ConfigError } from 'bump-cli'

try {
  const options = await resolveConfig({ mode: 'latest' })
  await check(options)
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`Bad config: ${error.message}`)
  } else if (error instanceof RegistryError) {
    console.error(`Registry ${error.status} at ${error.url}: ${error.message}`)
  } else {
    throw error
  }
}
```

Every error includes a `cause` property when wrapping a lower-level failure, so `error.cause` gives you the original `SyntaxError`, `TypeError`, or whatever cursed thing the runtime produced.

---

## Workflow Examples

### Custom CLI Wrapper

Build your own opinionated wrapper around bump. Because the existing CLI is apparently not opinionated enough.

```ts
import { check, resolveConfig } from 'bump-cli'

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
import { loadPackages, resolvePackage, resolveConfig } from 'bump-cli'

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
import { check, resolveConfig } from 'bump-cli'

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
