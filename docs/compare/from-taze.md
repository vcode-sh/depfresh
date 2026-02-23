# Migrating from taze

You've decided to leave taze. No judgment. Well, some judgment -- you should've left sooner.

The good news: depfresh started as a taze fork, so most flags and config fields are identical. The bad news: you'll have to rename a config file. Try not to pull a muscle.

## TL;DR

- **Flags are 95% identical.** Swap `npx taze` for `depfresh` and most commands just work.
- **Rename config files.** `.tazerc` becomes `.depfreshrc`. `taze.config.ts` becomes `depfresh.config.ts`.
- **Node >= 24 required.** No polyfills, no negotiation.
- **You gain:** JSON output, structured errors, SQLite cache, retry logic, proxy/TLS transport, `--verify-command`, `--cooldown`, `--nodecompat`, `--long`, `--explain`, and about a dozen other things taze users have been begging for in open GitHub issues since 2022.

---

## Flag Compatibility

Almost everything maps 1:1. If you've memorised taze flags, congratulations -- that knowledge transfers.

### Identical Flags

| Flag | Alias | Notes |
|------|-------|-------|
| `--mode` | `-m` | Same modes: `default`, `major`, `minor`, `patch`, `latest`, `newest`, `next` |
| `--write` | `-w` | |
| `--interactive` | `-I` | |
| `--include` / `--exclude` | `-n` / `-x` | Comma-separated regex patterns, same syntax |
| `--recursive` | `-r` | Default `true` in both tools |
| `--cwd` | `-C` | |
| `--force` | `-f` | |
| `--include-locked` | `-l` | |
| `--peer` | `-P` | |
| `--all` | `-a` | |
| `--group` | `-G` | |
| `--sort` | `-s` | |
| `--timediff` | `-T` | |
| `--install` | `-i` | |
| `--update` | `-u` | |
| `--silent` | -- | Maps to `--loglevel silent` |
| `--fail-on-outdated` | -- | |
| `--ignore-paths` | -- | |

### depfresh-Only Flags

These don't exist in taze. Some of them are the reason you're migrating.

| Flag | Alias | What it does | taze status |
|------|-------|-------------|-------------|
| `--output json` | `-o` | Structured JSON envelope with all packages, summary, metadata | [Issue #201](https://github.com/antfu-collective/taze/issues/201) -- still open |
| `--help-json` | -- | Machine-readable CLI schema for agent discovery | Not planned |
| `--deps-only` | -- | Only check `dependencies` | [Issue #101](https://github.com/antfu-collective/taze/issues/101) |
| `--dev-only` | -- | Only check `devDependencies` | [Issue #101](https://github.com/antfu-collective/taze/issues/101) |
| `--verify-command` | `-V` | Run command after each dep update, revert on failure | [Issue #78](https://github.com/antfu-collective/taze/issues/78) |
| `--execute` | `-e` | Run command once after all writes complete | Not available |
| `--long` | `-L` | Show homepage URLs per package | [Issue #48](https://github.com/antfu-collective/taze/issues/48) |
| `--explain` | `-E` | Human-readable update explanations in interactive mode | Not available |
| `--cooldown N` | -- | Skip versions published less than N days ago | Not available |
| `--nodecompat` | -- | Node.js engine compatibility column | Not available |
| `--refresh-cache` | -- | Bypass cache for this run | Not available (no cache) |
| `--no-cache` | -- | Alias for `--refresh-cache` | Not available |
| `--global-all` | -- | Check globals across npm, pnpm, and bun in one pass | Not available |
| `--concurrency N` | `-c` | Default `16` (taze defaults to `10`) | Flag exists, different default |
| `--timeout N` | -- | Default `10000`ms (taze defaults to `5000`ms) | Not configurable in taze |

Full flag reference: [CLI Flags](../cli/flags.md).

---

## Config Migration

### File Rename

| taze | depfresh |
|------|----------|
| `.tazerc` | `.depfreshrc` |
| `taze.config.ts` | `depfresh.config.ts` |
| `taze.config.js` / `.mjs` | `depfresh.config.js` / `.mjs` |
| `package.json` `"taze"` field | `package.json` `"depfresh"` field |

### Before (taze)

```typescript
// taze.config.ts
import { defineConfig } from 'taze'

export default defineConfig({
  mode: 'minor',
  recursive: true,
  include: ['typescript', 'vitest'],
  exclude: ['webpack'],
  packageMode: {
    'eslint*': 'latest',
    '/^@types/': 'patch',
  },
  depFields: {
    dependencies: true,
    devDependencies: true,
    optionalDependencies: false,
  },
  ignorePaths: ['packages/legacy/**'],
  write: false,
  force: false,
  peer: false,
  all: false,
})
```

### After (depfresh)

```typescript
// depfresh.config.ts
import { defineConfig } from 'depfresh'

export default defineConfig({
  // All the same field names. Shocking, I know.
  mode: 'minor',
  recursive: true,
  include: ['typescript', 'vitest'],
  exclude: ['webpack'],
  packageMode: {
    'eslint*': 'latest',
    '/^@types/': 'patch',
  },
  depFields: {
    dependencies: true,
    devDependencies: true,
    optionalDependencies: false,
  },
  ignorePaths: ['packages/legacy/**'],
  write: false,
  force: false,
  peer: false,
  all: false,

  // New things you can now configure:
  concurrency: 16,       // was hardcoded at 10 in taze
  timeout: 10_000,       // was hardcoded at 5s in taze
  retries: 2,            // taze doesn't retry
  cacheTTL: 30 * 60_000, // SQLite cache, 30min TTL
  cooldown: 7,           // skip versions < 7 days old
  nodecompat: true,      // Node engine compat column
})
```

The field names are identical. The import path changes from `'taze'` to `'depfresh'`. That's it. If this takes you more than 90 seconds, we need to talk.

Config file reference: [Configuration Files](../configuration/files.md).

---

## What You Gain

Things depfresh does that taze doesn't. This list is why you're here.

- **JSON output** (`--output json`) -- structured envelope with packages, summary, metadata, and error details. Not "pipe table output through jq and pray."
- **Structured errors** -- every error has a `.code` (`ERR_REGISTRY`, `ERR_RESOLVE`, etc.), a `.cause` chain, and a `.retryable` hint in JSON output. Parse errors like a civilised program.
- **SQLite cache** -- registry metadata cached in `~/.depfresh/cache.db` with configurable TTL. taze hits the registry every single time. Every. Time.
- **Retry with backoff** -- failed registry requests retry twice with exponential backoff. taze fails on the first network hiccup.
- **Transport policy** -- proxy support (`HTTP_PROXY`, `HTTPS_PROXY`, `.npmrc` proxy), custom CA bundles (`cafile`), `strict-ssl` toggle. All from your existing `.npmrc`. taze has [no proxy support](https://github.com/antfu-collective/taze/issues/13).
- **`--verify-command`** -- test each dependency update individually, revert failures. taze users have been [asking since 2022](https://github.com/antfu-collective/taze/issues/78).
- **`--cooldown N`** -- skip versions younger than N days. Paranoia as a feature.
- **`--nodecompat`** -- warns you when a target version drops your Node runtime.
- **`--long` / `--explain`** -- more context per dependency without leaving the terminal.
- **`--deps-only` / `--dev-only`** -- filter by dependency type, not just name patterns.
- **`--help-json`** -- machine-discoverable CLI contract. AI coding agents can introspect the full flag schema.
- **`--global-all`** -- scan npm + pnpm + bun globals in one pass, deduplicated.
- **Deterministic exit codes** -- `0` = clean, `1` = outdated (with `--fail-on-outdated`), `2` = error. Actually reliable in scripts.

---

## What Changes

Things that might bite you if you don't read this section.

| Change | taze | depfresh |
|--------|------|----------|
| Node requirement | >= 14 | **>= 24** |
| Config file names | `.tazerc`, `taze.config.ts` | `.depfreshrc`, `depfresh.config.ts` |
| Default concurrency | 10 | **16** |
| Default timeout | 5000ms | **10000ms** |
| Cache | None | SQLite at `~/.depfresh/cache.db` |
| Retry | None | 2 retries with exponential backoff |
| Flag validation | Lenient (ignores unknown values) | **Strict** -- invalid `--mode`, `--output`, `--sort`, `--loglevel` values exit with code `2` |

The Node >= 24 requirement is the only one likely to actually stop you. If you're still on Node 18, depfresh won't even start. Upgrade your runtime or stay on taze. Your call.

---

## Case Studies

Three real scenarios where taze falls over and depfresh doesn't.

### The Enterprise Monorepo

**Setup:** 200+ dependencies across 15 workspace packages. Private Artifactory registry for `@company/*` scopes. Corporate HTTPS proxy. Custom CA bundle.

**taze:** Fails silently on private packages -- [no proxy support](https://github.com/antfu-collective/taze/issues/13), no CA bundle handling, scoped registry auth is [unreliable](https://github.com/antfu-collective/taze/issues/161). Private packages show as errors mixed into stdout with no way to distinguish them from real failures. The team wraps taze in a bash script that greps for "not found" and hopes for the best.

**depfresh:** Reads `.npmrc` scoped registries, auth tokens, proxy config, and CA bundles out of the box. The [transport layer](../cli/flags.md) creates per-registry dispatchers with the correct TLS and proxy settings. Private packages resolve normally. Public packages go through the proxy. A failed `@company/legacy-thing` returns a `RegistryError` with `.status = 404` and `.code = "ERR_REGISTRY"` -- it doesn't block the other 199 dependencies.

```ini
# .npmrc -- depfresh reads this as-is
@company:registry=https://artifactory.company.com/api/npm/npm-local/
//artifactory.company.com/api/npm/npm-local/:_authToken=${ARTIFACTORY_TOKEN}
https-proxy=http://proxy.company.com:8080
cafile=/etc/pki/tls/certs/company-ca-bundle.crt
```

```bash
depfresh --output json --concurrency 8
# 15 packages, 200+ deps, partial failures isolated, JSON envelope out
```

### The CI Pipeline That Cried Wolf

**Setup:** GitHub Actions workflow that runs nightly to check for outdated deps. Should gate PRs, post results to Slack, and fail the build when major updates pile up.

**taze:** No JSON output ([Issue #201](https://github.com/antfu-collective/taze/issues/201)), so the team parses ANSI table output with regex. Network flakes crash the pipeline because taze has no retry ([Issue #44](https://github.com/antfu-collective/taze/issues/44), [Issue #18](https://github.com/antfu-collective/taze/issues/18)). Exit codes are inconsistent -- a 503 from npm looks the same as "everything is up to date." The pipeline sends a Slack alert every other night because npm had a bad 200ms.

**depfresh:** `--output json` gives a parseable envelope. `--fail-on-outdated` returns exit code `1` only for actual outdated deps, `2` for errors, `0` for clean. Built-in retry handles transient 503s without drama. The `summary` object in JSON output gives exact counts by diff type.

```yaml
# .github/workflows/deps.yml
- name: Check dependencies
  run: |
    depfresh --output json --fail-on-outdated --mode major > report.json
    echo "outdated=$(jq '.summary.total' report.json)" >> $GITHUB_OUTPUT
```

No regex. No grep. No bash gymnastics. The pipeline hasn't false-alarmed in six months.

### The AI Agent Sprint

**Setup:** AI coding agent tasked with "update all dependencies to latest minor versions, run tests, commit if green."

**taze:** The agent gets ANSI-colored table output. It tries to parse it. Half the escape codes end up in the commit message. There's no `--help-json` for the agent to discover available flags, so it hallucinates `--json` (which doesn't exist). Errors go to stderr as unstructured plaintext. The agent retries the entire command five times because it can't tell a 404 from a timeout.

**depfresh:** The agent calls `depfresh --help-json` to discover the CLI contract -- valid flags, enum values, exit codes, defaults. Then it runs `depfresh --output json --mode minor` and gets a structured envelope. Each dependency has `currentVersion`, `targetVersion`, `diff`, `source`. Errors include `.code` and `.retryable`. Non-TTY mode auto-disables colors. The agent parses the JSON, decides what to update, runs `depfresh --write --mode minor --verify-command "pnpm test"`, and commits the survivors.

```bash
# Step 1: Discover capabilities
depfresh --help-json | jq '.flags'

# Step 2: Check what's outdated
depfresh --output json --mode minor

# Step 3: Write with safety net
depfresh --write --mode minor --verify-command "pnpm test"
```

Machine-readable in, machine-readable out. No parsing ANSI tables. No guessing exit codes. The agent finishes in one loop instead of three.

---

## Quick Migration Checklist

1. **Upgrade Node to >= 24.** Non-negotiable.
2. **Install depfresh.** `pnpm add -D depfresh` or `npm install -D depfresh` or `bun add -d depfresh`.
3. **Rename config files.** `.tazerc` to `.depfreshrc`. `taze.config.ts` to `depfresh.config.ts`. Update the import from `'taze'` to `'depfresh'`.
4. **Update package.json scripts.** Replace `taze` with `depfresh` in any npm scripts.
5. **Update CI pipelines.** Swap the command. Add `--output json` if you were doing cursed regex parsing. Add `--fail-on-outdated` if you want gated checks.
6. **Remove taze.** `pnpm remove taze`. Pour one out. Or don't.
7. **Run `depfresh` once.** Verify it finds your packages. If something's off, check [Troubleshooting](../troubleshooting.md).
8. **Optional: tune new features.** Add `cacheTTL`, `cooldown`, `retries`, `concurrency` to your config. Or don't. The defaults are fine. Better than fine, actually.

That's it. You've migrated. The whole thing should take less time than the average npm install.
