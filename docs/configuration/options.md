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
| `includeWorkspace` | `boolean` | `true` | Include workspace protocol (`workspace:*`) dependencies. |

## Filtering

| Option | Type | Default | Description |
|---|---|---|---|
| `include` | `string[]` | `undefined` | Only check packages matching these patterns. Supports regex, `/regex/flags`, and glob syntax. |
| `exclude` | `string[]` | `undefined` | Skip packages matching these patterns. Supports regex, `/regex/flags`, and glob syntax. |
| `depFields` | `Partial<Record<DepFieldType, boolean>>` | `undefined` | Control which dependency types are checked. See [depFields](#depfields). |
| `packageMode` | `Record<string, RangeMode>` | `undefined` | Per-package version strategies. See [packageMode](#packagemode). |

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
| `global` | `boolean` | `false` | Check globally installed packages for one detected package manager. |
| `globalAll` | `boolean` | `false` | Scan npm, pnpm, and bun globals together and deduplicate by package name. |

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
| `cooldown` | `number` | `0` | Minimum age in days before suggesting an update. Wait for the early adopters to find the bugs first. |
| `nodecompat` | `boolean` | `true` | Check Node engine compatibility and warn about incompatible updates. |
| `long` | `boolean` | `false` | Extended display with the package homepage URL. |
| `explain` | `boolean` | `false` | Show human-readable explanations in the interactive detail view. "Breaking change." for majors, "Bug fixes only." for patches. Only does anything with `interactive: true`. |

## Exit Behavior

| Option | Type | Default | Description |
|---|---|---|---|
| `failOnOutdated` | `boolean` | `false` | Exit with code `1` when outdated dependencies are found. Perfect for CI pipelines where you want builds to fail and developers to cry. |

## Post-Write

These only matter when `write: true`.

| Option | Type | Default | Description |
|---|---|---|---|
| `install` | `boolean` | `false` | Run package manager install after writing updates. |
| `update` | `boolean` | `false` | Run package manager update after writing. Slightly different from install, depending on your package manager's mood. |
| `execute` | `string` | `undefined` | Shell command to run after updates are written. `'npm test'`, `'make coffee'`, whatever you need. |
| `verifyCommand` | `string` | `undefined` | Command to run after each package update to verify nothing is broken. If it exits non-zero, the update is rolled back. Safety nets are underrated. |

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

## packageMode

The real power move. `packageMode` lets you set different version strategies per package using exact names, glob patterns, or regex.

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

1. **Exact name** -- checked first, wins if matched
2. **Glob patterns** -- standard glob syntax (`*`, `**`, `?`)
3. **Regex** -- strings starting with `/` are treated as regular expressions

If nothing matches, the global `mode` applies. If you set a package to `'ignore'`, depfresh pretends it doesn't exist. Sometimes that's the healthiest option.

### Available modes

| Mode | What it does |
|---|---|
| `default` | Respects the existing semver range in your `package.json` |
| `major` | Allows major version jumps. Brave. |
| `minor` | Up to minor updates. The sensible middle ground. |
| `patch` | Patch updates only. Maximum conservatism. |
| `latest` | Whatever the `latest` dist-tag points to. Living dangerously. |
| `newest` | The most recently published version, regardless of dist-tags. Chaotic neutral. |
| `next` | The `next` dist-tag. For beta enthusiasts. |
| `ignore` | Skip this package entirely. Out of sight, out of mind. |

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
