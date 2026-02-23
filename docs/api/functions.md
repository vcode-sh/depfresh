# Exported Functions

Everything you can import and call. Each one does exactly what the name says, which is more than I can say for most npm packages.

## `check(options)`

The main event. Loads packages, resolves dependencies against the registry, renders output, and optionally writes updates. Everything the CLI does, minus the argument parsing.

```ts
function check(options: depfreshOptions): Promise<number>
```

**Returns** an exit code:
- `0` -- no updates found, or updates were written successfully
- `1` -- updates available (only when `failOnOutdated: true` and `write: false`)
- `2` -- something went wrong

```ts
import { check, resolveConfig } from 'depfresh'

const options = await resolveConfig({ mode: 'latest', write: true })
const code = await check(options)

if (code === 2) {
  console.error('Well that did not work')
}
```

---

## `resolveConfig(overrides?)`

Merges your overrides with config file values (`.depfreshrc`, `depfresh.config.ts`, `package.json#depfresh`) and `DEFAULT_OPTIONS`. Config file wins over defaults. Your overrides win over everything.

```ts
function resolveConfig(overrides?: Partial<depfreshOptions>): Promise<depfreshOptions>
```

**Config resolution order** (highest priority first):
1. `overrides` argument
2. Config file (`.depfreshrc`, `depfresh.config.ts`, `depfresh.config.js`)
3. `package.json` `"depfresh"` field
4. `DEFAULT_OPTIONS`

```ts
import { resolveConfig } from 'depfresh'

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

## `defineConfig(options)`

A type helper for config files. Does literally nothing at runtime. Returns exactly what you pass in. But your editor will autocomplete, and that's apparently worth an import.

```ts
function defineConfig(options: Partial<depfreshOptions>): Partial<depfreshOptions>
```

```ts
// depfresh.config.ts
import { defineConfig } from 'depfresh'

export default defineConfig({
  mode: 'minor',
  exclude: ['typescript'],
  group: true,
})
```

---

## `loadPackages(options)`

Finds and parses `package.json` files in your project. Respects `recursive`, `ignorePaths`, `ignoreOtherWorkspaces`. Loads workspace catalogs (pnpm, bun, yarn) only when `recursive: true`, and supports global packages when `global: true`.

```ts
function loadPackages(options: depfreshOptions): Promise<PackageMeta[]>
```

```ts
import { loadPackages, resolveConfig } from 'depfresh'

const options = await resolveConfig({ recursive: true })
const packages = await loadPackages(options)

for (const pkg of packages) {
  console.log(`${pkg.name}: ${pkg.deps.length} dependencies`)
}
```

---

## `resolvePackage(pkg, options, externalCache?, externalNpmrc?, privatePackages?)`

Resolves every dependency in a package against the registry. Handles caching, concurrency, version filtering, and the `onDependencyResolved` callback. This is where the network calls happen.

```ts
function resolvePackage(
  pkg: PackageMeta,
  options: depfreshOptions,
  externalCache?: Cache,
  externalNpmrc?: NpmrcConfig,
  privatePackages?: Set<string>,
): Promise<ResolvedDepChange[]>
```

| Param | Description |
|-------|-------------|
| `pkg` | The package to resolve |
| `options` | Full depfresh options (mode, concurrency, timeout, etc.) |
| `externalCache?` | Reuse a cache across multiple packages. If omitted, creates and closes its own |
| `externalNpmrc?` | Pre-loaded npmrc config. If omitted, loads from disk |
| `privatePackages?` | Set of workspace package names to skip (no point hitting the registry for local deps) |

```ts
import { loadPackages, resolvePackage, resolveConfig } from 'depfresh'

const options = await resolveConfig({ mode: 'latest' })
const packages = await loadPackages(options)

for (const pkg of packages) {
  const resolved = await resolvePackage(pkg, options)
  const updates = resolved.filter(d => d.diff !== 'none')
  console.log(`${pkg.name}: ${updates.length} updates available`)
}
```

---

## `parseDependencies(raw, options)`

Extracts dependencies from a parsed `package.json` object. Handles all standard fields, overrides, resolutions, nested overrides, protocols (`npm:`, `jsr:`), include/exclude filters, and locked version detection.

```ts
function parseDependencies(
  raw: Record<string, unknown>,
  options: depfreshOptions,
): RawDep[]
```

```ts
import { parseDependencies, resolveConfig } from 'depfresh'

const options = await resolveConfig()
const raw = JSON.parse(fs.readFileSync('package.json', 'utf-8'))
const deps = parseDependencies(raw, options)

console.log(`Found ${deps.length} dependencies`)
console.log(`${deps.filter(d => d.update).length} will be checked`)
```

---

## `writePackage(pkg, changes, loglevel?)`

Writes resolved changes back to the package file. Preserves indentation, line endings (CRLF too, you're welcome Windows users), and key order. Handles both regular `package.json` and workspace catalog files.

```ts
function writePackage(
  pkg: PackageMeta,
  changes: ResolvedDepChange[],
  loglevel?: 'silent' | 'info' | 'debug',
): void
```

```ts
import { loadPackages, resolvePackage, writePackage, resolveConfig } from 'depfresh'

const options = await resolveConfig({ mode: 'minor' })
const [pkg] = await loadPackages(options)

const resolved = await resolvePackage(pkg, options)
const minorOnly = resolved.filter(d => d.diff === 'minor' || d.diff === 'patch')

writePackage(pkg, minorOnly, 'silent')
```

---

## `loadGlobalPackages(pm?)`

Lists globally installed packages for a given package manager. Auto-detects which PM is available if you don't specify (tries pnpm, then bun, then npm).

```ts
function loadGlobalPackages(pm?: string): PackageMeta[]
```

```ts
import { loadGlobalPackages } from 'depfresh'

const packages = loadGlobalPackages('npm')
for (const pkg of packages) {
  for (const dep of pkg.deps) {
    console.log(`${dep.name}@${dep.currentVersion}`)
  }
}
```

---

## `writeGlobalPackage(pm, name, version)`

Updates a single global package. Shells out to the relevant package manager's install command. Not subtle.

```ts
function writeGlobalPackage(
  pm: PackageManagerName,
  name: string,
  version: string,
): void
```

```ts
import { writeGlobalPackage } from 'depfresh'

writeGlobalPackage('npm', 'typescript', '5.7.0')
// Runs: npm install -g typescript@5.7.0
```

---

## Lifecycle Callbacks

Seven hooks. Called in order. All optional. All async-compatible. Wire them into `depfreshOptions` and `check()` will call them at the right moment.

### Call Order

```
check() starts
  |
  +- loadPackages()
  |
  +- afterPackagesLoaded(pkgs)
  |
  +- for each package:
  |   +- beforePackageStart(pkg)
  |   +- resolvePackage()
  |   |   +- onDependencyResolved(pkg, dep)  <- called per dep as it resolves
  |   +- afterPackageEnd(pkg)
  |   |
  |   +- if writing:
  |       +- beforePackageWrite(pkg)  <- return false to skip
  |       +- afterPackageWrite(pkg)
  |
  +- afterPackagesEnd(pkgs)
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
