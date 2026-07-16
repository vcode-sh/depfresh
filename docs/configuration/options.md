# Full Options Reference

Every option from the `depfreshOptions` interface. I documented all of them because I'm a better person than whoever wrote your last dependency tool.

## Core

| Option | Type | Default | Description |
|---|---|---|---|
| `cwd` | `string` | `'.'` | Working directory. Where depfresh starts looking for packages. |
| `recursive` | `boolean` | `true` | Search for package manifests (`package.json`, `package.yaml`) in subdirectories. |
| `mode` | `RangeMode` | `'default'` | Global version resolution strategy. See [Modes](../cli/modes.md) for all modes. |
| `write` | `boolean` | `false` | Actually update the files. Without this, depfresh is just a very opinionated reporter. |
| `interactive` | `boolean` | `false` | Launch the TUI for cherry-picking updates. Vim keys, version drill-down, the works. Falls back to `@clack/prompts` in non-TTY. |
| `force` | `boolean` | `false` | Include packages even when they're already up to date. Does not bypass cache reads. |
| `includeLocked` | `boolean` | `false` | Check packages that are pinned to exact versions. |
| `includeWorkspace` | `boolean` | `true` | Include `workspace:` dependencies. Explicit-version forms like `workspace:^1.2.3` are checked against the registry; prefix-only forms like `workspace:^` and `workspace:*` are treated as local-only and skipped. |

## Filtering

| Option | Type | Default | Description |
|---|---|---|---|
| `include` | `string[]` | `undefined` | Only check dependency occurrences whose names match these patterns. Supports regex, `/regex/flags`, and glob syntax. |
| `exclude` | `string[]` | `undefined` | Skip dependency occurrences whose names match these patterns. Supports regex, `/regex/flags`, and glob syntax. |
| `depFields` | `Partial<Record<DepFieldType, boolean>>` | `undefined` | Control which dependency types are checked. See [depFields](#depfields). |
| `packageMode` | `Record<string, RangeMode>` | `undefined` | Per-dependency-resolution-name strategies. See [packageMode](#packagemode). |
| `policyRules` | `PolicyRuleInput[]` | `undefined` | Ordered occurrence rules. See [Occurrence policy](#occurrence-policy). |

## Compatibility signal policy

| Option | Type | Default | Description |
|---|---|---|---|
| `cohorts` | `CohortInput[]` | `undefined` | Explicit package families. Each requires a public unique `id`, at least two unique exact `members`, and `update-together`, `same-major`, or `same-version`. `update-together` requires all physical members to have a candidate operation or none; it does not require equal versions. Divergence blocks by default but never selects another target. |
| `signalRules` | `SignalRuleInput[]` | `undefined` | Ordered last-match-wins `warn`/`block` effects selected by family, state, reason, dependency, workspace, or explicit cohort. Rules cannot rewrite signal state or inferred suggestions. |

Signal/cohort configuration is strict plain data: unknown fields, duplicate IDs or members, empty
selectors, invalid enums, unsafe text, and references to unknown explicit cohorts fail configuration
loading. Direct planner input replaces configured arrays and records `library` or `cli` provenance;
otherwise overrides record `config` provenance. Configuration never grants apply or process authority.
Machine planning reads these values only from declarative JSON configuration or direct plain-data
input; it does not evaluate TypeScript or JavaScript config modules.

## Performance

| Option | Type | Default | Description |
|---|---|---|---|
| `concurrency` | `number` | `16` | Max parallel registry requests. Lower this if your registry starts crying. |
| `timeout` | `number` | `10000` | Request timeout in milliseconds. 10 seconds is generous. |
| `retries` | `number` | `2` | Retry count for failed requests. Because networks are unreliable and life is pain. |
| `cacheTTL` | `number` | `1800000` | Cache lifetime in milliseconds. 30 minutes by default. Set to `0` to disable. |
| `refreshCache` | `boolean` | `false` | Bypass cache reads for this run and fetch fresh registry metadata. Cache writes still happen unless `cacheTTL=0`. |

## Output

| Option | Type | Default | Description |
|---|---|---|---|
| `output` | `'table' \| 'json'` | `'table'` | Output format. `json` for machines, `table` for humans who enjoy ASCII art. |
| `loglevel` | `'silent' \| 'info' \| 'debug'` | `'info'` | How chatty depfresh should be. `debug` for when you need to file a bug report. |
| `peer` | `boolean` | `false` | Show peer dependency hints. |
| `global` | `boolean` | `false` | Inspect globally installed packages for one supported detected manager. With an explicit invocation `write`, apply each selected physical occurrence through observed global apply. |
| `globalAll` | `boolean` | `false` | Inspect npm, pnpm, and Bun globals while retaining manager-specific occurrences. With an explicit invocation `write`, apply each selected occurrence separately. |

## Paths

| Option | Type | Default | Description |
|---|---|---|---|
| `ignorePaths` | `string[]` | `['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.git/**']` | Glob patterns for directories to skip. The defaults are there for your own protection. |
| `ignoreOtherWorkspaces` | `boolean` | `true` | Skip nested monorepos (directories with their own `pnpm-workspace.yaml` or similar). Prevents accidental cross-workspace chaos. |

## Display

| Option | Type | Default | Description |
|---|---|---|---|
| `all` | `boolean` | `false` | Show all dependencies, even ones that are already up to date. Enjoy the dopamine of seeing green checkmarks. |
| `group` | `boolean` | `true` | Group results by package file. |
| `sort` | `SortOption` | `'diff-asc'` | Sort order. Options: `diff-asc`, `diff-desc`, `time-asc`, `time-desc`, `name-asc`, `name-desc`. |
| `timediff` | `boolean` | `true` | Show time since last publish. Guilt-trip yourself into updating. |
| `cooldown` | `number` | `0` | Minimum proven age in days before suggesting an update. Missing or invalid publish-time metadata is skipped while enabled. |
| `nodecompat` | `boolean` | `true` | Show legacy target engine metadata. `?node` means repository compatibility is unknown; authoritative plan signals require repository runtime evidence and never use the executor runtime. |
| `long` | `boolean` | `false` | Extended display with the package homepage URL. |
| `explain` | `boolean` | `false` | Show review-oriented release-shape notes in the interactive detail view, such as "Breaking change. Check migration guide." and "Patch release. Review changes." Only does anything with `interactive: true`. |
| `explainDiscovery` | `boolean` | `false` | Print or emit discovery diagnostics: chosen root, matched manifests, skipped manifests, and loaded catalogs. |

## Exit Behavior

| Option | Type | Default | Description |
|---|---|---|---|
| `failOnOutdated` | `boolean` | `false` | Exit with code `1` when outdated dependencies are found. Perfect for CI pipelines where you want builds to fail and developers to cry. |
| `failOnResolutionErrors` | `boolean` | `false` | Exit with code `2` when any dependency fails to resolve from the registry. |
| `failOnNoPackages` | `boolean` | `false` | Exit with code `2` when no packages are discovered in the target workspace. |

## Invocation-only mutation and phase options

These values are ignored in configuration files. Machine workflow intent belongs to `plan()` or
`depfresh plan`; matching authority belongs only to the active `apply()` or `depfresh apply`
invocation. Configuration never authorizes files, processes, lockfiles, installs, verification, or
global writes.

| Option | Type | Default | Description |
|---|---|---|---|
| `write` | `boolean` | `false` | Grant file mutation for the active invocation. |
| `syncLockfile` | `boolean` | `false` | On plan, fingerprint supported lockfile-only manager work; on apply, grant its process and lockfile writes. |
| `install` | `boolean` | `false` | On plan/apply, request or grant the stronger non-transactional install phase. |
| `verifyArgv` | `string[]` | `undefined` | Plan one exact non-empty verification argv array after manager success. |
| `verify` | `boolean` | `false` | Grant only the verification argv already fingerprinted in the plan. |
| `phaseTimeout` | `number` | `120000` | Plan the per-process timeout in milliseconds. |
| `update`, `execute`, `verifyCommand`, `strictPostWrite` | legacy | -- | Rejected shell-string/post-write compatibility paths; use plan/apply phases. |

## Addons

Addons are first-class plugins for the programmatic API and TypeScript config files. They run alongside callbacks and can hook the full check lifecycle.

| Option | Type | Default | Description |
|---|---|---|---|
| `addons` | `depfreshAddon[]` | `undefined` | Ordered addon list. Each addon can hook setup, package lifecycle, dependency resolution, and write phases. |

## Callbacks

For the programmatic API. These do nothing in config files -- they're for when you `import { check } from 'depfresh'` and want to micromanage everything.

| Callback | Signature | When it fires |
|---|---|---|
| `beforePackageStart` | `(pkg: PackageMeta) => void` | Before processing each package |
| `onDependencyResolved` | `(pkg: PackageMeta, dep: ResolvedDepChange) => void` | Each dependency is resolved from the registry |
| `beforePackageWrite` | `(pkg: PackageMeta) => boolean` | Before writing. Return `false` to skip. |
| `afterPackageWrite` | `(pkg: PackageMeta) => void` | After a package file is written |
| `afterPackagesLoaded` | `(pkgs: PackageMeta[]) => void` | After all package files are discovered and loaded |
| `afterPackageEnd` | `(pkg: PackageMeta) => void` | After a package is fully processed (resolved + rendered) |
| `afterPackagesEnd` | `(pkgs: PackageMeta[]) => void` | After all packages are done. The grand finale. |

See the [API docs](../api/) for usage examples.

---

## Occurrence policy

`policyRules` is the primary occurrence-level selection surface. Each rule is JSON-compatible,
has a stable public ID and selector object, and sets an action, a mode, or both:

```typescript
import { defineConfig } from 'depfresh'

export default defineConfig({
  mode: 'latest',
  policyRules: [
    {
      id: 'native-catalog-minor',
      selectors: { catalogName: 'native' },
      mode: 'minor',
    },
    {
      id: 'exclude-legacy-app',
      selectors: { workspacePath: 'apps/legacy' },
      action: 'exclude',
    },
  ],
})
```

The selector vocabulary is:

| Selector | Match |
|---|---|
| `dependencyName` | Existing regex, `/regex/flags`, or glob pattern dialect |
| `workspacePath` | Canonical repository-relative workspace path pattern |
| `packageName` | Manifest package-name pattern |
| `catalogName` | Default or named catalog pattern |
| `catalogRole` | Exact `direct`, `owner`, or `consumer` |
| `field` | Exact `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, `overrides`, `resolutions`, `packageManager`, `pnpm.overrides`, or `catalog` |
| `role` | Exact `dependency`, `override`, `package-manager`, `catalog-owner`, or `catalog-consumer` |
| `manager` | Exact `npm`, `pnpm`, `yarn`, or `bun` |
| `protocol` | Exact `semver`, `npm`, `jsr`, `github`, `workspace`, `catalog`, `file`, `link`, `git`, `http`, or `unknown` |
| `currentChannel` | Exact `stable` or prerelease channel identifier |
| `specifierStatus` | Exact `locked`, `range`, `dynamic`, or `invalid` |

Selectors in one rule are AND-combined; an empty selector object is a broad rule. Rules are
evaluated in order. Action and mode are independent last-match-wins dimensions, so a decision can
have different `winningActionRuleId` and `winningModeRuleId` values. `matchedRuleIds` retains every
definite match in order. Policy evaluation produces `selected`, `skipped`, or `blocked`; a check
finalizes a selected decision to `unchanged` when candidate selection produces no writable target,
retaining the exact candidate reason.

Every decision includes `matchedRuleIds`, `indeterminateRuleIds`, and separate action/mode winner
IDs. An otherwise matching manager-specific rule with unknown evidence is listed in
`indeterminateRuleIds`; a later definite rule clears only the action or mode dimension it actually
overrides. `candidateReason` is present only after selected work is finalized as unchanged.

Stable policy reasons are `POLICY_DEFAULT_INCLUDED`, `POLICY_RULE_INCLUDED`,
`POLICY_RULE_EXCLUDED`, `POLICY_MANAGER_UNKNOWN`, and `POLICY_CANDIDATE_UNCHANGED`. The last reason
retains the exact candidate-pipeline reason separately instead of collapsing unknown or blocked
candidate state into success.

`action: 'exclude'` cannot be combined with a mode. Explicit `mode: 'ignore'` is invalid; the
legacy `packageMode` sentinel is translated to exclusion. Unknown fields, non-JSON values,
duplicate or reserved IDs, invalid patterns/enums, and authority-shaped fields are rejected.

Catalog owners and consumers match independently. Only the owner decision controls a physical
catalog entry; workspace- or package-specific consumer rules never propagate into a shared owner.
Catalog manager identity comes from the catalog entity. A package manager is used only when the
owning boundary has one confirmed manager. If a manager-specific rule otherwise matches ambiguous,
missing, unsupported, or unavailable evidence, the decision is blocked unless a later definite
rule overrides the same dimension. Manager-agnostic rules remain evaluable.

Current version, channel, and specifier status come only from the repository or observed global
declaration. Policy inspection does not invent registry-derived status. Each global manager/package
occurrence is evaluated independently with its confirmed manager and installed version;
deduplicated presentation never replaces physical identity. Configuration can shape policy but
never grants global-write or process authority.

---

## packageMode

The real power move. `packageMode` lets you set different version strategies per dependency
resolution name using exact names, glob patterns, or regex.

```typescript
// depfresh.config.ts
import { defineConfig } from 'depfresh'

export default defineConfig({
  mode: 'minor', // global default
  packageMode: {
    // Exact match -- typescript gets the latest, always
    'typescript': 'latest',

    // Glob -- all ESLint packages stay on minor
    'eslint*': 'minor',

    // Glob -- scope wildcard
    '@babel/*': 'patch',

    // Regex (starts with /) -- all @types packages pinned to patch
    '/^@types/': 'patch',

    // Ignore entirely -- pretend webpack doesn't exist
    'webpack': 'ignore',
  },
})
```

### Pattern matching order

Exact names always win. Otherwise, the first matching insertion-order pattern wins; glob and regex
patterns do not form separate priority classes. The compatibility compiler reverses pattern rules,
then appends exact-name rules, so the ordered last-match-wins evaluator preserves that behavior.

If nothing matches, the global `mode` applies. Legacy `'ignore'` compiles to
`action: 'exclude'`; it is not a candidate-resolution mode. New configuration should use an
explicit policy rule.

For npm aliases, compatibility `packageMode` keys match the resolved package name: an occurrence
declared as `alias: "npm:react@^18"` is matched by the key `react`. Explicit
`policyRules[].selectors.dependencyName` instead matches the manifest occurrence name (`alias`). A
mechanical `packageMode`-to-rule rewrite must account for that distinction.

### Available modes

| Mode | What it does |
|---|---|
| `default` | Respects the existing semver range in your `package.json` |
| `major` | Allows major version jumps. Brave. |
| `minor` | Up to minor updates. The sensible middle ground. |
| `patch` | Patch updates only. Maximum conservatism. |
| `latest` | Whatever the `latest` dist-tag points to. Living dangerously. |
| `newest` | Highest eligible semantic version, regardless of dist-tags. Chaotic neutral. |
| `next` | The `next` dist-tag. For beta enthusiasts. |
| `ignore` | Legacy `packageMode` sentinel compiled to exclusion. |

## depFields

Control which dependency types depfresh checks. By default, everything is checked. Set fields to `false` to exclude them.

```typescript
import { defineConfig } from 'depfresh'

export default defineConfig({
  depFields: {
    dependencies: true,
    devDependencies: true,
    peerDependencies: false, // not my problem
    optionalDependencies: false,
    overrides: true,
    resolutions: true,
    packageManager: true,
    'pnpm.overrides': true,
    catalog: true,
  },
})
```

### Available fields

| Field | What it covers |
|---|---|
| `dependencies` | Production dependencies |
| `devDependencies` | Dev dependencies |
| `peerDependencies` | Peer dependencies. Usually someone else's problem. |
| `optionalDependencies` | Optional dependencies. The "nice to have" of the npm world. |
| `overrides` | npm overrides (`package.json#overrides`) |
| `resolutions` | Yarn resolutions (`package.json#resolutions`) |
| `packageManager` | The `packageManager` field (Corepack) |
| `pnpm.overrides` | pnpm-specific overrides |
| `catalog` | Workspace catalogs (pnpm, bun, yarn) |
