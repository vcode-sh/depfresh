# Config Files

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

## Config File Formats

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
