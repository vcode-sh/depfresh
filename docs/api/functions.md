# Exported Functions

Everything you can import and call. Each one does exactly what the name says, which is more than I can say for most npm packages.

## `check(options, authority?)`

The main event. Loads the repository occurrence model, applies ordered policy before registry work,
resolves selected dependencies, renders output, and optionally writes updates. Skipped and blocked
occurrences do not reach the registry. A selected occurrence with no candidate target is finalized
as unchanged with the exact candidate reason.

```ts
function check(options: depfreshOptions, authority?: InvocationAuthority): Promise<number>
```

**Returns** an exit code:
- `0` -- no updates found, or updates were written successfully
- `1` -- updates available (only when `failOnOutdated: true` and `write: false`)
- `2` -- something went wrong, strict resolution/discovery failed, or a retired post-write option was requested

```ts
import { check, resolveConfig } from 'depfresh'

const options = await resolveConfig({ mode: 'latest', write: true })
const code = await check(options)

if (code === 2) {
  console.error('Well that did not work')
}
```

When `authority` is omitted, `check()` creates an immutable authority snapshot from the options
supplied by that direct library call. Config-file values cannot grant authority because
`resolveConfig()` removes invocation-only options before merging. Advanced wrappers may pass an
explicit `InvocationAuthority`; an option that requests more than that object grants fails with
reason `AUTHORITY_REQUIRED` before discovery or side effects.

---

## `resolveConfig(overrides?)`

Merges your overrides with config file values (`.depfreshrc`, `depfresh.config.ts`, `package.json#depfresh`) and `DEFAULT_OPTIONS`. Config file wins over defaults. Your overrides win over everything. Invocation-only options are retained only when supplied directly in `overrides`; config-file values for `write`, install/update/command execution, and global writes are ignored. Policy compiles in defaults/config/library order with traced provenance; CLI normalization uses the CLI invocation layer and preserves include/exclude array replacement.

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

## Policy functions

`compilePolicy(layers)` strictly validates JSON-compatible explicit rules and translates legacy
mode, `packageMode`, include, and exclude inputs into one ordered list. `createPolicyContexts(model)`
derives registry-free current version/channel/status and manager evidence for every modeled
occurrence. `evaluatePolicy(policy, context)` and `evaluateRepositoryPolicy(model, policy)` are pure
and deterministic. `finalizePolicyDecision(decision, candidateReason)` records an unchanged
candidate outcome without discarding its policy trace. `validatePolicyRules(value)` validates and
normalizes a rule array without compiling compatibility inputs.

```ts
function validatePolicyRules(value: readonly unknown[]): PolicyRuleInput[]
function compilePolicy(layers: readonly PolicyInputLayer[]): CompiledPolicy
function createPolicyContexts(model: RepositoryModel): PolicyOccurrenceContext[]
function evaluatePolicy(policy: CompiledPolicy, context: PolicyOccurrenceContext): PolicyDecision
function evaluateRepositoryPolicy(model: RepositoryModel, policy: CompiledPolicy): PolicyDecision[]
function finalizePolicyDecision(
  decision: PolicyDecision,
  candidateReason: PolicyCandidateReason,
): PolicyDecision
```

```ts
import { compilePolicy, evaluateRepositoryPolicy, inspectRepository } from 'depfresh'

const model = await inspectRepository({ cwd: process.cwd() })
const policy = compilePolicy([
  { source: 'defaults', mode: 'latest' },
  {
    source: 'library',
    policyRules: [
      {
        id: 'native-catalog-minor',
        selectors: { catalogName: 'native' },
        mode: 'minor',
      },
    ],
  },
])
const decisions = evaluateRepositoryPolicy(model, policy)
```

Policy provenance does not grant authority. Named reusable profiles, inspect/plan envelopes, and
versioned global occurrences are outside this API contract.

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

## `inspect(options)`, `plan(options)`, and `apply(plan, options, authority)`

`inspect()` returns the schema-v1 process-free repository evidence contract. `plan()` returns the
schema-v1 registry-aware plan with one terminal decision per occurrence and exact future file
operations. Neither function writes stdout/stderr, changes exit state, writes repository/cache
files, or runs package-manager/lifecycle/configured commands. Fatal failures throw structured
errors.

```ts
function inspect(options: InspectOptions): Promise<InspectResult>
function plan(options: PlanOptions): Promise<PlanResult>
function apply(
  plan: PlanResult,
  options: ApplyOptions,
  authority: InvocationAuthority,
): Promise<ApplyResult>
```

```ts
import {
  apply,
  createInvocationAuthority,
  inspect,
  plan,
  validateApplyResult,
  validateInspectResult,
  validatePlanResult,
} from 'depfresh'

const evidence = await inspect({ cwd: process.cwd() })
const dependencyPlan = await plan({ cwd: process.cwd(), mode: 'latest' })

if (!validateInspectResult(evidence) || !validatePlanResult(dependencyPlan)) {
  throw new Error('Unsupported contract')
}

const applied = await apply(
  dependencyPlan,
  { cwd: process.cwd() },
  createInvocationAuthority({ write: true }),
)
if (!validateApplyResult(applied)) throw new Error('Unsupported apply contract')
```

`plan()` reads only declarative JSON configuration. Set `asOf` to a canonical UTC timestamp when
cooldown is positive. `syncLockfile` or `install` fingerprints one supported manager phase;
`verifyArgv` fingerprints one exact non-empty argv array, and `phaseTimeout` bounds every planned
process. These values express future intent and grant no authority. See
[Inspect and Plan Contracts](../output-formats/inspect-plan.md) for the schemas, fingerprints,
terminal vocabulary, and compatibility boundary.

Manager phase planning currently accepts only registry-backed `semver` and `npm:` alias occurrence
protocols. Other protocols retain exact file operations but make requested manager execution
blocked before apply.

`apply()` accepts plain schema-v1 plan data, never re-resolves it, and throws before lock acquisition
for a forged contract or missing/mismatched authority. A manager plan requires independent
`processExecute` and `lockfileWrite` grants; install and verification additionally require `install`
and `verifyCommand`. Operational stale, dirty, lock, staging, manager, verification, recovery, and
observation states return a schema-valid result. See the
[Apply Contract](../output-formats/apply.md) for exact phases and recovery limits.

The module also exports authoritative inspect, plan, apply, and error schema descriptors, runtime assertion/type-guard helpers,
canonical JSON and fingerprint helpers, plus pure `buildLegacyCheckJsonResult()` and
`buildLegacyCheckJsonError()` compatibility builders.

---

## `inspectRepository(options)`

Builds the versioned, deterministic, read-only repository model. It reads contained manifests,
workspace markers, catalogs, supported lockfiles, and declared Node runtime files; hashes exact
source bytes; and records exact dependency occurrences, boundary ownership, evidence conclusions,
and target-file Git state. The fixed Git adapter uses argument arrays, sanitizes inherited Git
control variables, probes nested Git boundaries separately, disables optional locks and helper
features, and does not refresh or mutate the index. It does not contact registries, evaluate runtime
compatibility, write files, run lifecycle scripts or package managers, or exit the process.

```ts
function inspectRepository(options: InspectRepositoryOptions): Promise<RepositoryModel>
```

```ts
import { inspectRepository } from 'depfresh'

const model = await inspectRepository({ cwd: process.cwd() })
console.log(model.schemaVersion, model.occurrences.length)
```

Unlike process-free `inspect()`, this lower-level compatibility API retains the fixed read-only Git
probe. See [Repository Model](./repository-model.md) for IDs, hashes, diagnostics, and
forward-version behavior.

---

## `loadPackages(options)`

Finds and parses package manifests (`package.json`, `package.yaml`) in your project. For local
repositories it evaluates occurrence policy and returns selected, exactly linked dependencies with
their policy decision. It respects `recursive`, `ignorePaths`, and `ignoreOtherWorkspaces`, and
loads workspace catalogs only when `recursive: true`. Global modes keep their legacy non-model path.

When both `package.yaml` and `package.json` exist in a directory, `package.yaml` is selected.

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

Resolves every selected dependency in a package against the registry. An attached occurrence policy
decision supplies the effective mode; otherwise standalone/manual callers retain legacy
`mode`/`packageMode` behavior. Candidate safety remains authoritative.

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
| `privatePackages?` | Set of workspace package names normally skipped for local-only refs. Explicit-version `workspace:` refs still resolve against the registry. |

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

Extracts dependencies from a parsed package manifest object (JSON or YAML). Handles all standard fields, `packageManager`, overrides, resolutions, nested overrides, protocols (`npm:`, `jsr:`, `github:`, `workspace:`), standalone include/exclude compatibility filtering, and locked version detection. Repository checks defer that filtering until occurrence policy evaluation so later explicit rules can override compatibility inputs.

```ts
function parseDependencies(
  raw: Record<string, unknown>,
  options: depfreshOptions,
): RawDep[]
```

```ts
import { parseDependencies, resolveConfig } from 'depfresh'

const options = await resolveConfig()
const raw = JSON.parse(fs.readFileSync('package.json', 'utf-8')) // package.yaml works too after YAML parsing
const deps = parseDependencies(raw, options)

console.log(`Found ${deps.length} dependencies`)
console.log(`${deps.filter(d => d.update).length} will be checked`)
```

---

## `writePackage(pkg, changes, loglevel?)`

Writes resolved changes back to the package file. Preserves indentation, line endings (CRLF too, you're welcome Windows users), and key order. Handles regular manifest files (`package.json`, `package.yaml`) and workspace catalog files.

```ts
function writePackage(
  pkg: PackageMeta,
  changes: ResolvedDepChange[],
  loglevel?: 'silent' | 'info' | 'debug',
): WriteOutcome[]
```

```ts
import { loadPackages, resolvePackage, writePackage, resolveConfig } from 'depfresh'

const options = await resolveConfig({ mode: 'minor' })
const [pkg] = await loadPackages(options)

const resolved = await resolvePackage(pkg, options)
const minorOnly = resolved.filter(d => d.diff === 'minor' || d.diff === 'patch')

const outcomes = writePackage(pkg, minorOnly, 'silent')
```

---

## `loadGlobalPackages(pm?)`

Lists globally installed packages for one package manager. Auto-detects which PM is available if you don't specify (tries pnpm, then bun, then npm).

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

## `loadGlobalPackagesAll()`

Lists globally installed packages across npm, pnpm, and bun in one pass. Results are deduplicated by package name. If a package exists in multiple managers, write mode targets every matching manager.

```ts
function loadGlobalPackagesAll(): PackageMeta[]
```

```ts
import { loadGlobalPackagesAll } from 'depfresh'

const packages = loadGlobalPackagesAll()
for (const dep of packages[0]?.deps ?? []) {
  console.log(`${dep.name}@${dep.currentVersion}`)
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
): boolean
```

```ts
import { writeGlobalPackage } from 'depfresh'

writeGlobalPackage('npm', 'typescript', '5.7.0')
// Runs: npm install -g typescript@5.7.0
```

---

## Lifecycle Callbacks

Seven hooks. Called in order. All optional. All async-compatible. Wire them into `depfreshOptions` and `check()` will call them at the right moment.

If you need reusable behavior across projects, use `options.addons` with `depfreshAddon` objects. Callbacks stay project-local; addons are composable plugins.

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
  |       +- afterPackageWrite(pkg, changes)
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

### `afterPackageWrite(pkg, changes)`

Called after the file has been written. The damage is done. Use this for logging, notifications, or post-write commands. Receives the package and the list of changes that were applied.

```ts
afterPackageWrite?: (pkg: PackageMeta, changes: ResolvedDepChange[]) => void | Promise<void>
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

### Addons

Addons are executed in array order (`options.addons`). For each lifecycle event, depfresh calls:
1. The legacy callback (if present)
2. Each addon hook in order

For `beforePackageWrite`, returning `false` from any callback/addon skips writing that package.

```ts
import { check, resolveConfig, type depfreshAddon } from 'depfresh'

const metricsAddon: depfreshAddon = {
  name: 'metrics',
  setup(ctx) {
    console.log(`run ${ctx.runId} started at ${ctx.startedAt.toISOString()}`)
  },
  afterPackageWrite(_ctx, pkg, changes) {
    console.log(`${pkg.name}: ${changes.length} updates written`)
  },
}

const options = await resolveConfig({
  write: true,
  addons: [metricsAddon],
})

await check(options)
```

### Built-in Addons

depfresh ships with one built-in addon:

```ts
import { createVSCodeAddon } from 'depfresh'

const options = await resolveConfig({
  write: true,
  addons: [createVSCodeAddon()],
})

await check(options)
```

`createVSCodeAddon()` syncs the `engines.vscode` field with the `@types/vscode` version when writing updates. Niche, but if you're building VS Code extensions, it saves a manual step.

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
  afterPackageWrite(pkg, changes) {
    console.log(`Updated ${pkg.filepath} (${changes.length} changes)`)
  },
})

await check(options)
```
