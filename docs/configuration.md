# Configuration

You're here because defaults offend you. Fair enough. bump works perfectly fine out of the box -- zero config, no ceremony, just run `bump` and watch it tell you everything's outdated. But if you insist on having opinions about how your dependency checker behaves, read on.

## Zero Config

bump ships with sensible defaults. Here's what you get for free:

| Option | Default | What it means |
|---|---|---|
| `mode` | `'default'` | Respects existing semver ranges |
| `recursive` | `true` | Finds all `package.json` files in your project |
| `concurrency` | `16` | Registry requests in parallel |
| `timeout` | `10000` | 10 seconds per request before giving up |
| `retries` | `2` | Retry failed requests twice |
| `cacheTTL` | `1800000` | 30 minutes. Your registry isn't changing that fast. |
| `output` | `'table'` | Pretty tables for humans |
| `loglevel` | `'info'` | Normal amount of talking |
| `sort` | `'diff-asc'` | Patch updates first, majors last |
| `group` | `true` | Groups deps by package |
| `timediff` | `true` | Shows how old your versions are |
| `nodecompat` | `true` | Checks Node engine compatibility |
| `ignorePaths` | `['**/node_modules/**', ...]` | Skips the obvious |
| `ignoreOtherWorkspaces` | `true` | Skips nested monorepos |

That's the full list of things I decided for you. You're welcome.

## Config Files

bump loads config from multiple file formats. Priority order (highest wins):

1. CLI flags
2. Config file
3. Defaults

### Supported formats

**TypeScript** (recommended if you have taste):

```typescript
// bump.config.ts
import { defineConfig } from 'bump-cli'

export default defineConfig({
  mode: 'minor',
  concurrency: 8,
  include: ['typescript', 'vitest'],
  packageMode: {
    'eslint*': 'latest',
    '/^@types/': 'patch',
  },
})
```

**JavaScript**, if you must:

```javascript
// bump.config.js / bump.config.mjs
export default {
  mode: 'latest',
  write: true,
  install: true,
}
```

**JSON**, for the minimalists:

```json
// .bumprc
{
  "mode": "minor",
  "recursive": false
}
```

**package.json**, for people who think one file should do everything:

```json
{
  "name": "my-package",
  "bump": {
    "mode": "minor",
    "exclude": ["webpack"]
  }
}
```

All formats are equivalent. Pick one and pretend the others don't exist.

## Full Options Reference

Every option from the `BumpOptions` interface. I documented all of them because I'm a better person than whoever wrote your last dependency tool.

### Core

| Option | Type | Default | Description |
|---|---|---|---|
| `cwd` | `string` | `'.'` | Working directory. Where bump starts looking for packages. |
| `recursive` | `boolean` | `true` | Search for `package.json` files in subdirectories. |
| `mode` | `RangeMode` | `'default'` | Global version resolution strategy. See [CLI docs](./cli.md) for all modes. |
| `write` | `boolean` | `false` | Actually update the files. Without this, bump is just a very opinionated reporter. |
| `interactive` | `boolean` | `false` | Launch the TUI for cherry-picking updates. Vim keys, version drill-down, the works. Falls back to `@clack/prompts` in non-TTY. |
| `force` | `boolean` | `false` | Include packages even when they're already up to date. |
| `includeLocked` | `boolean` | `false` | Check packages that are pinned to exact versions. |
| `includeWorkspace` | `boolean` | `true` | Include workspace protocol (`workspace:*`) dependencies. |

### Filtering

| Option | Type | Default | Description |
|---|---|---|---|
| `include` | `string[]` | `undefined` | Only check these packages. Supports exact names. |
| `exclude` | `string[]` | `undefined` | Skip these packages. For that one dependency you're not ready to deal with. |
| `depFields` | `Partial<Record<DepFieldType, boolean>>` | `undefined` | Control which dependency types are checked. See [depFields](#depfields). |
| `packageMode` | `Record<string, RangeMode>` | `undefined` | Per-package version strategies. See [packageMode](#packagemode). |

### Performance

| Option | Type | Default | Description |
|---|---|---|---|
| `concurrency` | `number` | `16` | Max parallel registry requests. Lower this if your registry starts crying. |
| `timeout` | `number` | `10000` | Request timeout in milliseconds. 10 seconds is generous. |
| `retries` | `number` | `2` | Retry count for failed requests. Because networks are unreliable and life is pain. |
| `cacheTTL` | `number` | `1800000` | Cache lifetime in milliseconds. 30 minutes by default. Set to `0` to disable. |

### Output

| Option | Type | Default | Description |
|---|---|---|---|
| `output` | `'table' \| 'json' \| 'sarif'` | `'table'` | Output format. `json` for machines, `sarif` for security tooling, `table` for humans who enjoy ASCII art. |
| `loglevel` | `'silent' \| 'info' \| 'debug'` | `'info'` | How chatty bump should be. `debug` for when you need to file a bug report. |
| `peer` | `boolean` | `false` | Show peer dependency hints. |
| `global` | `boolean` | `false` | Check globally installed packages instead of project dependencies. |

### Paths

| Option | Type | Default | Description |
|---|---|---|---|
| `ignorePaths` | `string[]` | `['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.git/**']` | Glob patterns for directories to skip. The defaults are there for your own protection. |
| `ignoreOtherWorkspaces` | `boolean` | `true` | Skip nested monorepos (directories with their own `pnpm-workspace.yaml` or similar). Prevents accidental cross-workspace chaos. |

### Display

| Option | Type | Default | Description |
|---|---|---|---|
| `all` | `boolean` | `false` | Show all dependencies, even ones that are already up to date. Enjoy the dopamine of seeing green checkmarks. |
| `group` | `boolean` | `true` | Group results by package file. |
| `sort` | `SortOption` | `'diff-asc'` | Sort order. Options: `diff-asc`, `diff-desc`, `time-asc`, `time-desc`, `name-asc`, `name-desc`. |
| `timediff` | `boolean` | `true` | Show time since last publish. Guilt-trip yourself into updating. |
| `cooldown` | `number` | `0` | Minimum age in days before suggesting an update. Wait for the early adopters to find the bugs first. |
| `nodecompat` | `boolean` | `true` | Check Node engine compatibility and warn about incompatible updates. |
| `long` | `boolean` | `false` | Extended display with homepage, description, and repository links. |
| `explain` | `boolean` | `false` | Show human-readable explanations in the interactive detail view. "Breaking change." for majors, "Bug fixes only." for patches. Only does anything with `interactive: true`. |

### Exit Behavior

| Option | Type | Default | Description |
|---|---|---|---|
| `failOnOutdated` | `boolean` | `false` | Exit with code `1` when outdated dependencies are found. Perfect for CI pipelines where you want builds to fail and developers to cry. |

### Post-Write

These only matter when `write: true`.

| Option | Type | Default | Description |
|---|---|---|---|
| `install` | `boolean` | `false` | Run package manager install after writing updates. |
| `update` | `boolean` | `false` | Run package manager update after writing. Slightly different from install, depending on your package manager's mood. |
| `execute` | `string` | `undefined` | Shell command to run after updates are written. `'npm test'`, `'make coffee'`, whatever you need. |
| `verifyCommand` | `string` | `undefined` | Command to run after each package update to verify nothing is broken. If it exits non-zero, the update is rolled back. Safety nets are underrated. |

### Callbacks

For the programmatic API. These do nothing in config files -- they're for when you `import { check } from 'bump-cli'` and want to micromanage everything.

| Callback | Signature | When it fires |
|---|---|---|
| `beforePackageStart` | `(pkg: PackageMeta) => void` | Before processing each package |
| `onDependencyResolved` | `(pkg: PackageMeta, dep: ResolvedDepChange) => void` | Each dependency is resolved from the registry |
| `beforePackageWrite` | `(pkg: PackageMeta) => boolean` | Before writing. Return `false` to skip. |
| `afterPackageWrite` | `(pkg: PackageMeta) => void` | After a package file is written |
| `afterPackagesLoaded` | `(pkgs: PackageMeta[]) => void` | After all package files are discovered and loaded |
| `afterPackageEnd` | `(pkg: PackageMeta) => void` | After a package is fully processed (resolved + rendered) |
| `afterPackagesEnd` | `(pkgs: PackageMeta[]) => void` | After all packages are done. The grand finale. |

See the [API docs](./api.md) for usage examples.

## packageMode

The real power move. `packageMode` lets you set different version strategies per package using exact names, glob patterns, or regex.

```typescript
// bump.config.ts
import { defineConfig } from 'bump-cli'

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

If nothing matches, the global `mode` applies. If you set a package to `'ignore'`, bump pretends it doesn't exist. Sometimes that's the healthiest option.

### Available modes

| Mode | What it does |
|---|---|
| `default` | Respects the existing semver range in your `package.json` |
| `major` | Allows major version jumps. Brave. |
| `minor` | Up to minor bumps. The sensible middle ground. |
| `patch` | Patch updates only. Maximum conservatism. |
| `latest` | Whatever the `latest` dist-tag points to. Living dangerously. |
| `newest` | The most recently published version, regardless of dist-tags. Chaotic neutral. |
| `next` | The `next` dist-tag. For beta enthusiasts. |
| `ignore` | Skip this package entirely. Out of sight, out of mind. |

## depFields

Control which dependency types bump checks. By default, everything is checked. Set fields to `false` to exclude them.

```typescript
import { defineConfig } from 'bump-cli'

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

## Private Registries

bump reads your `.npmrc` files automatically. No extra config needed -- if npm can reach your private registry, so can bump.

### How it works

bump loads `.npmrc` in this order (later files override earlier ones):

1. **Global** -- `~/.npmrc` (or wherever `npm_config_userconfig` points)
2. **Project** -- nearest `.npmrc` found walking up from `cwd`

### Example .npmrc

```ini
# Default registry (optional, defaults to https://registry.npmjs.org/)
registry=https://registry.company.com/

# Scoped registry
@mycompany:registry=https://npm.mycompany.com/

# Auth token (bearer)
//npm.mycompany.com/:_authToken=your-token-here

# Or use an environment variable
//npm.mycompany.com/:_authToken=${NPM_TOKEN}
```

### Environment variable overrides

These override anything in `.npmrc`:

| Variable | What it does |
|---|---|
| `npm_config_registry` / `NPM_CONFIG_REGISTRY` | Default registry URL |
| `npm_config_proxy` / `HTTP_PROXY` / `http_proxy` | HTTP proxy |
| `npm_config_https_proxy` / `HTTPS_PROXY` / `https_proxy` | HTTPS proxy |

### Scoped registries

If you have `@mycompany` packages on a private registry and everything else on npm, bump handles that automatically:

```ini
@mycompany:registry=https://npm.mycompany.com/
//npm.mycompany.com/:_authToken=${COMPANY_NPM_TOKEN}
```

bump maps auth tokens to registries by matching the hostname. If the token URL contains the registry hostname, it gets attached. No manual wiring needed.

### Auth types

bump supports both `bearer` and `basic` auth, detected from your `.npmrc`. The `_authToken` key maps to bearer tokens, which is what most private registries use. If you're on something exotic, it probably still works. If it doesn't, [file an issue](https://github.com/nicepkg/bump/issues).

## Cache

bump caches registry responses in a SQLite database at `~/.bump/cache.db`. You didn't ask for this feature, but you're getting it anyway.

### How it works

- **Engine**: better-sqlite3 with WAL mode for fast concurrent reads
- **Location**: `~/.bump/cache.db`
- **Default TTL**: 30 minutes (`cacheTTL: 1800000`)
- **Cleanup**: expired entries are pruned automatically on startup
- **Fallback**: if better-sqlite3 can't load (native module issues, exotic platform), bump falls back to an in-memory Map. Same interface, no persistence. You won't even notice unless you check.

### Configuration

```typescript
import { defineConfig } from 'bump-cli'

export default defineConfig({
  // Cache for 1 hour
  cacheTTL: 60 * 60 * 1000,

  // Or disable caching entirely
  // cacheTTL: 0,
})
```

There's no config for the cache location. It lives at `~/.bump/cache.db` and that's final. Delete it if you want a fresh start -- bump will recreate it on the next run without complaining.

---

That's everything. If you've read this far, you're either building something serious or procrastinating. Either way, I respect the commitment.
