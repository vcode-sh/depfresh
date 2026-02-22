# Modern Tooling Stack Research for "bump" (2026 Rewrite)

Research date: 2026-02-22

---

## Table of Contents

1. [Recommended Stack](#recommended-stack)
2. [CLI Framework](#1-cli-framework)
3. [Build Tool](#2-build-tool)
4. [Linting & Formatting](#3-linting--formatting)
5. [Testing](#4-testing)
6. [HTTP / Fetch](#5-http--fetch)
7. [Terminal UI](#6-terminal-ui)
8. [Config Loading](#7-config-loading)
9. [Caching](#8-caching)
10. [Concurrency](#9-concurrency)
11. [Competitor Analysis](#10-competitor-analysis)
12. [Cross-Runtime Compatibility](#11-cross-runtime-compatibility)
13. [Innovation Opportunities](#12-innovation-opportunities)
14. [Effort Estimates](#13-effort-estimates)

---

## Recommended Stack

| Area | Choice | Rationale |
|------|--------|-----------|
| CLI Framework | **citty** | TypeScript-first, tiny, declarative, unjs ecosystem alignment |
| Build Tool | **tsdown** | Successor to tsup, Rolldown-powered, ESM-first, minutes-to-ms build times |
| Lint/Format | **Biome** | 10-25x faster than ESLint+Prettier, single binary, 423+ rules |
| Testing | **vitest** | Proven, fast, TypeScript-native, Vite-powered HMR in watch mode |
| HTTP Client | **Native fetch + undici Agent** | Zero-dep, HTTP/2 via undici 7, built-in caching interceptor |
| Terminal UI | **@clack/prompts** | Elegant, minimal, 80% smaller than alternatives, purpose-built for CLI |
| Config Loading | **c12** | Smart, 380kB install, 2.5x faster TS loading, unjs ecosystem |
| Cache | **SQLite (better-sqlite3)** | 180x faster than JSON for cache patterns, concurrent-safe, queryable |
| Concurrency | **Promise.allSettled + p-limit** | Simple, proven, worker threads only if CPU-bound parsing needed |

---

## 1. CLI Framework

### Comparison

| Feature | citty | cleye | commander | yargs | oclif |
|---------|-------|-------|-----------|-------|-------|
| TypeScript-first | Yes | Yes | Partial | Partial | Yes |
| Declarative API | Yes | Yes | No (fluent) | No (fluent) | Yes |
| Size (install) | ~15kB | ~12kB | ~60kB | ~200kB | ~5MB+ |
| Weekly downloads | ~2M | ~200K | ~282M | ~148M | ~1.5M |
| Subcommands | Yes | Yes | Yes (git-style) | Yes | Yes (plugin) |
| Auto help/version | Yes | Yes | Yes | Yes | Yes |
| Ecosystem | unjs | Standalone | Node.js core | Node.js core | Salesforce |

### Recommendation: **citty**

- Lightweight, TypeScript-first declarative API
- Maintained by unjs (same ecosystem as c12, unbuild, nitro)
- Active development (latest commit Jan 2026)
- Supports subcommands, type inference, conditional boolean flags
- Aligns with the unjs philosophy of minimal, composable modules
- Risk: smaller community than commander/yargs; less battle-tested

### Runner-up: commander

If stability and ecosystem breadth matter more than size/modernity, commander is the safe pick with 282M weekly downloads.

---

## 2. Build Tool

### Comparison

| Feature | tsdown | tsup | unbuild | bun build | esbuild |
|---------|--------|------|---------|-----------|---------|
| Engine | Rolldown (Rust) | esbuild | rollup | Bun native | esbuild |
| ESM-first | Yes | No (CJS-first) | Yes | Yes | No |
| DTS generation | Oxc (fast) | rollup-plugin-dts | mkdist | Experimental | No |
| Config migration | `tsdown migrate` | N/A | N/A | N/A | N/A |
| Active maintenance | Yes (Rolldown team) | No (sunset) | Yes (unjs) | Yes | Slowing |
| Build speed | ms for libs | Seconds | Seconds | ms | ms |

### Recommendation: **tsdown**

- Official successor to tsup, built on Rolldown (Rust-based bundler by Evan You's team)
- ESM-first with proper dual CJS/ESM output
- Oxc-powered DTS generation (faster than rollup-plugin-dts)
- Migration path from tsup: `tsdown migrate` command
- Minutes-to-milliseconds build improvement reported in real-world use
- Will become the foundation for Rolldown Vite's Library Mode

### Why not unbuild?

Unbuild (current taze build tool) is still viable and maintained by unjs, but tsdown is faster and more actively developed. The Rolldown ecosystem is where the JS tooling world is converging.

---

## 3. Linting & Formatting

### Comparison

| Metric | Biome v2.3 | ESLint 9 + Prettier |
|--------|-----------|---------------------|
| Speed (10K files lint) | 0.8s | 45.2s |
| Speed (10K files format) | 0.3s | 12.1s |
| Speed ratio | **10-25x faster** | Baseline |
| Rules | 423+ | 300+ (with plugins) |
| Config files | 1 (biome.json) | 2-4 files |
| Install size | Single binary | 127+ npm packages |
| Type-aware linting | Yes (v2.3) | Yes (typescript-eslint) |
| Incremental | Yes (cache) | Partial |
| Plugin ecosystem | Growing | Massive |
| Custom rules | Limited | Extensive |

### Recommendation: **Biome**

- 10-25x faster than ESLint+Prettier (Rust, multi-core)
- Single binary, single config file, zero npm dependency bloat
- Type-aware linting landed in v2.3 (Jan 2026)
- Incremental mode: first run 2.1s for 25K files, subsequent 0.05s
- Unified linter + formatter eliminates config synchronization issues

### Risk factors

- Plugin ecosystem still smaller than ESLint's
- Some niche ESLint rules (e.g., @antfu/eslint-config specifics) may lack Biome equivalents
- Migration requires mapping existing rules to Biome equivalents

---

## 4. Testing

### Comparison

| Feature | vitest | Jest | Node test runner | Bun test |
|---------|--------|------|------------------|----------|
| TypeScript | Native | Babel/SWC | Manual | Native |
| ESM | Native | Config needed | Native | Native |
| Watch mode | Vite HMR (fast) | Polling | Polling | Fast |
| Speed vs Jest | 10-20x faster | Baseline | ~1.5x faster | ~2x faster |
| Ecosystem | Large, growing | Massive | Minimal | Growing |
| Snapshot | Yes | Yes | No | Yes |
| Coverage | c8/v8 | istanbul/v8 | Built-in | Built-in |

### Recommendation: **vitest** (keep current choice)

- Already used by taze, proven and stable
- Fastest TypeScript test runner with Vite HMR-powered watch mode
- Rich ecosystem: snapshot testing, coverage, mocking, concurrent tests
- No compelling reason to switch

### Note on Bun test

Bun's test runner is fast but less mature. If targeting Bun as primary runtime, worth evaluating.

---

## 5. HTTP / Fetch

### Comparison

| Feature | Native fetch | undici 7 | ky | got |
|---------|-------------|----------|-----|-----|
| Zero-dep | Yes | Peer dep | Yes (fetch-based) | No |
| HTTP/2 | Via undici | Yes (v7) | Via fetch | Yes |
| HTTP/3 | Via undici | Yes (v7) | No | No |
| Retry | Manual | Manual | Built-in | Built-in |
| Streaming | Yes | Yes | Limited | Yes |
| Throughput (rps) | 3,122 | 4,235 | ~3,000 | 2,567 |
| Latency (ms avg) | 31 | 23 | ~30 | 38 |
| Cross-runtime | Yes | Node only | Yes | Node only |
| Caching | Manual | RFC-9111 interceptor | Manual | Manual |

### Recommendation: **Native fetch + undici Agent for connection pooling**

- Native fetch is zero-dependency and works across Node, Bun, Deno
- undici 7 provides HTTP/2+3, connection pooling (30% faster), 40% less memory
- undici's cache interceptor implements RFC-9111 caching out of the box
- undici's `compose()` API (v6.20+) enables clean interceptor chains for retry, auth, logging
- For cross-runtime: use native fetch as primary, undici Agent as optional performance enhancer on Node

### npm Registry specific

- Use `Accept: application/vnd.npm.install-v1+json` for abbreviated metadata (smaller payloads)
- Migrate to granular access tokens (classic tokens revoked Dec 2025)
- Connection pool with 128 connections, HTTP pipelining for parallel resolution

---

## 6. Terminal UI

### Comparison

| Feature | @clack/prompts | Ink (React) | Inquirer/Prompts |
|---------|---------------|-------------|------------------|
| Approach | Procedural, minimal | React component model | Procedural, classic |
| Size | 80% smaller than alternatives | Large (React dep) | Medium |
| Learning curve | Low | High (React in terminal) | Low |
| Customization | Core + Prompts layers | Full React flexibility | Plugin-based |
| Spinner | Built-in | Component | Plugin |
| Multi-step | Built-in groups | Manual state | Manual |
| Used by | Astro, SvelteKit, T3 | Gatsby, Shopify, Tap | Yeoman, many CLIs |

### Recommendation: **@clack/prompts**

- Purpose-built for CLI tools (not general terminal UIs)
- Two-layer architecture: `@clack/core` (unstyled) + `@clack/prompts` (styled)
- 80% smaller than alternatives
- Built-in spinner, multi-step groups, text/select/multiselect/confirm
- Used by major CLI tools (Astro, SvelteKit scaffolders)
- Perfect fit for interactive dependency selection mode

### When to use Ink

Only if bump needs a persistent, stateful terminal UI (like a dashboard). For prompt-based workflows, Clack is simpler and lighter.

---

## 7. Config Loading

### Comparison

| Feature | c12 | unconfig | cosmiconfig |
|---------|-----|---------|-------------|
| TS config | Native (jiti) | Native (jiti) | Needs loader plugin |
| Install size | 380kB (7 deps) | ~400kB | ~200kB + loader |
| JSON/YAML/TOML | All (confbox) | JSON only | JSON/YAML |
| Extends | Yes | No | No |
| RC file | Yes | Yes | Yes |
| Env overrides | Yes | No | No |
| Speed (cold TS) | 2.5x faster than before | Similar | Slower (loader overhead) |
| Ecosystem | unjs | unjs | Independent |

### Recommendation: **c12**

- Smart config loader by unjs, same ecosystem as citty
- Supports .ts/.js/.mjs/.json/.yaml/.toml/.jsonc configs natively
- `extends` support for shared config presets
- Environment variable overrides
- Install size dropped from 3.44MB to 380kB (7 deps)
- TS config loading 2.5x faster on cold cache
- Used by Nuxt, Nitro, and other unjs projects

---

## 8. Caching

### Comparison

| Feature | SQLite (better-sqlite3) | JSON file | Map in memory |
|---------|------------------------|-----------|---------------|
| Read perf (10K entries) | ~1ms | ~50ms (parse all) | <0.1ms |
| Write perf | ~0.5ms (single) | ~100ms (rewrite all) | <0.1ms |
| Concurrent access | Safe (WAL mode) | Unsafe (race) | N/A (single process) |
| Queryable | SQL (expiry, prefix) | Full scan | Key lookup |
| Size on disk | Compact (B-tree) | Bloated (text) | N/A |
| TTL expiry | SQL WHERE clause | Manual scan | Manual |
| Crash safety | ACID | Corrupt on crash | Lost |
| Cross-runtime | better-sqlite3 (Node), bun:sqlite (Bun) | Universal | Universal |

### Recommendation: **SQLite via better-sqlite3**

- 180x improvement over JSON for cache workloads (real-world case study)
- ACID-safe: no cache corruption on crash or kill
- WAL mode enables concurrent reads during writes
- SQL-based TTL: `DELETE FROM cache WHERE expires_at < ?` (no full scan)
- Queryable: find all cached versions for a package, bulk invalidate
- better-sqlite3 for Node.js; bun:sqlite is 3-6x faster for Bun runtime
- Fallback: provide JSON file cache as zero-dep fallback for environments without native modules

### Schema design

```sql
CREATE TABLE registry_cache (
  package TEXT NOT NULL,
  version_range TEXT NOT NULL,
  data TEXT NOT NULL,       -- JSON blob
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (package, version_range)
);
CREATE INDEX idx_expires ON registry_cache(expires_at);
```

---

## 9. Concurrency

### Strategy Comparison

| Approach | Best for | Complexity | Overhead |
|----------|----------|------------|----------|
| Promise.allSettled + p-limit | I/O-bound (fetch) | Low | None |
| Worker threads | CPU-bound (parse) | Medium | Thread creation |
| Streaming JSON (clarinet/oboe) | Large payloads | Medium | Parser overhead |
| AbortController timeouts | Request lifecycle | Low | None |

### Recommendation: **Promise.allSettled + p-limit (primary), worker threads (optional)**

For dependency resolution (primarily I/O-bound):

1. **p-limit** with configurable concurrency (default 10-20) for registry fetches
2. **Promise.allSettled** to handle partial failures gracefully
3. **AbortController** with per-request timeouts (10s default)
4. **Streaming JSON parsing** only for massive packument responses (lodash, react)
5. **Worker threads** only if adding CPU-heavy features (lockfile parsing, AST analysis)

### Pattern

```typescript
import pLimit from 'p-limit'
const limit = pLimit(options.concurrency ?? 16)

const results = await Promise.allSettled(
  deps.map(dep => limit(() => resolveWithTimeout(dep, 10_000)))
)
```

This is essentially what taze does today and it works well. No need to over-engineer.

---

## 10. Competitor Analysis

### Feature Comparison

| Feature | taze | ncu | Renovate | Dependabot |
|---------|------|-----|----------|------------|
| **Type** | CLI | CLI | Bot/CI | Bot/CI |
| **Monorepo** | Yes (pnpm/yarn/bun/npm) | Partial (workspaces) | Yes (90+ managers) | Yes (limited) |
| **Workspace catalogs** | pnpm + bun + yarn | No | pnpm only | No |
| **Interactive mode** | Yes | Yes | No (PR-based) | No (PR-based) |
| **Auto-PR** | No | No | Yes | Yes |
| **Grouped PRs** | N/A | N/A | Yes (presets) | Yes (manual config) |
| **Auto-merge** | N/A | N/A | Built-in | Needs Actions workflow |
| **Deprecation filter** | No (open issue) | No | Yes | Yes |
| **Security alerts** | No | No | Yes (Merge Confidence) | Yes (GHSA) |
| **Config file** | taze.config.ts | .ncurc.json | renovate.json | dependabot.yml |
| **Lockfile update** | No | No | Yes | Yes |
| **Multi-platform** | N/A | N/A | GitHub/GitLab/Bitbucket/Azure/Gitea | GitHub only |
| **Package managers** | npm/pnpm/yarn/bun | npm/yarn/pnpm/deno/bun | 90+ | 30+ |
| **Scheduling** | Manual | Manual | Cron-based | Cron-based |
| **Range modes** | default/major/minor/patch/latest/newest | target/greatest/newest | N/A (follows semver) | N/A |
| **Version filtering** | include/exclude regex | filter/reject | package rules | allow/ignore |
| **Peer deps** | Optional flag | Optional | Automatic | Automatic |
| **JSR support** | Yes | No | No | No |
| **Global packages** | Yes | Yes | No | No |
| **package.yaml** | Yes | No | No | No |

### What competitors do that taze doesn't

1. **Deprecation filtering** - Renovate/Dependabot skip deprecated versions; taze suggests them (issue #191)
2. **Security vulnerability detection** - No CVE/advisory integration
3. **Lockfile regeneration** - taze only updates package.json, not lockfiles
4. **Automated PRs** - No CI/CD integration for auto-updating
5. **Merge confidence** - Renovate scores update risk based on adoption/age/test results
6. **Changelog integration** - No display of what changed between versions
7. **Dependency dashboard** - No overview UI of all pending updates
8. **Update grouping** - No smart grouping of related packages (e.g., all @babel/* together)

### What taze does uniquely well

1. **All workspace catalog formats** - pnpm, bun, yarn catalog support (no competitor matches all three)
2. **JSR protocol** - Only tool supporting jsr: dependencies
3. **Interactive selection** - Cherry-pick which deps to update in terminal
4. **Range mode flexibility** - 7 different range modes (default/major/minor/patch/latest/newest/next)
5. **package.yaml** - Supports non-standard package formats
6. **Zero-config monorepo** - Auto-detects workspace structure without configuration
7. **Lightweight** - Single CLI, no bot infrastructure needed
8. **Addons system** - Extensible post-processing (e.g., VSCode extension updater)

---

## 11. Cross-Runtime Compatibility

### Runtime Status (Feb 2026)

| Runtime | npm compat | CLI suitability | Key advantage |
|---------|-----------|----------------|---------------|
| Node.js 24 | Baseline | Excellent | Universal, all packages work |
| Bun 1.2 | ~98% | Excellent | 3-4x faster startup, built-in sqlite |
| Deno 2 | ~95% | Good | Security, built-in tooling |

### Recommendation

- **Target Node.js 20+ as primary** (LTS, universal)
- **Test on Bun** (growing adoption, faster startup ideal for CLIs)
- **Deno compatibility** is nice-to-have but not priority
- Use native `fetch` (works everywhere) over Node-specific HTTP clients
- Avoid native modules when possible (better-sqlite3 has prebuilt binaries for all platforms, but limits Deno)

---

## 12. Innovation Opportunities

Things no existing dependency update tool does well (or at all):

### 1. Smart Update Scoring
Combine multiple signals into a confidence score per update:
- npm download trends (is adoption growing?)
- Time since release (maturity period)
- Breaking change detection via changelog parsing
- Test suite pass rate from community (if public CI data available)
- Deprecation chain awareness (don't suggest versions that will be deprecated soon)

### 2. Diff Preview
Show actual changelog/breaking changes inline before updating:
```
@vue/core  3.4.0 -> 3.5.0  [minor]
  - Added defineModel() macro
  - Deprecated $attrs binding syntax
  View full changelog? (y/n)
```

### 3. Update Impact Analysis
Analyze package dependency graphs to predict cascade effects:
- "Updating typescript from 5.3 to 5.6 will also require updating @types/node"
- "This update changes a peer dependency that affects 3 other packages"

### 4. Lockfile-Aware Updates
Parse lockfiles (package-lock.json, pnpm-lock.yaml, bun.lock, yarn.lock) to:
- Show actual resolved versions vs range
- Detect phantom dependencies
- Regenerate lockfile after update

### 5. CI Integration Mode
Output structured JSON/SARIF for CI pipelines:
- GitHub Actions annotation format
- PR comment with update summary
- Fail CI if critical security updates are available

### 6. Rollback Tracking
Remember what was updated and provide quick rollback:
```
bump --rollback  # undo last update
bump --history   # show update history
```

### 7. Registry Mirroring
Support private registries and offline mode:
- Verdaccio/Artifactory/GitHub Packages support
- Offline cache with explicit refresh command
- Mirror-aware caching (different TTLs per registry)

### 8. Dependency Health Dashboard
Terminal-based overview of project dependency health:
- Age distribution (how old are your deps?)
- Update velocity (how often do your deps publish?)
- Security posture (known vulnerabilities)
- License compliance

---

## 13. Effort Estimates

| Component | Effort | Notes |
|-----------|--------|-------|
| CLI framework (citty) | **Low** (1-2 days) | Straightforward migration from cac |
| Build tool (tsdown) | **Low** (1 day) | `tsdown migrate` handles most config |
| Biome setup | **Medium** (2-3 days) | Rule mapping from @antfu/eslint-config |
| vitest (keep) | **None** | Already in use |
| Native fetch migration | **Low** (1-2 days) | Replace any custom HTTP code with fetch |
| @clack/prompts | **Medium** (2-3 days) | Rewrite interactive mode with new UI |
| c12 config | **Low** (1 day) | Similar API to current unconfig usage |
| SQLite cache | **Medium** (3-4 days) | New cache layer, migration from JSON, fallback |
| Concurrency (keep pattern) | **None** | Current pattern is fine |
| Deprecation filtering | **Low** (1 day) | Add `deprecated` field check in resolves.ts |
| Changelog integration | **Medium** (3-5 days) | Fetch and parse changelogs from GitHub/npm |
| CI output mode | **Medium** (2-3 days) | JSON/SARIF output formatters |
| Lockfile awareness | **High** (5-7 days) | Parse 4 lockfile formats |
| Smart update scoring | **High** (5-7 days) | Multiple data sources, scoring algorithm |
| Update history/rollback | **Medium** (3-4 days) | SQLite storage, diff/restore logic |

### Total estimated effort for core rewrite: ~2-3 weeks
### Total with innovation features: ~5-7 weeks

---

## Sources

### CLI Frameworks
- [citty - unjs](https://github.com/unjs/citty)
- [commander vs yargs npm trends](https://npmtrends.com/commander-vs-yargs)

### Build Tools
- [Switching from tsup to tsdown - Alan Norbauer](https://alan.norbauer.com/articles/tsdown-bundler/)
- [tsdown documentation](https://tsdown.dev/guide/)
- [Migrate from tsup](https://tsdown.dev/guide/migrate-from-tsup)
- [tsdown GitHub](https://github.com/rolldown/tsdown)

### Linting
- [Biome vs ESLint 2025 Showdown](https://medium.com/@harryespant/biome-vs-eslint-the-ultimate-2025-showdown-for-javascript-developers-speed-features-and-3e5130be4a3c)
- [Biome benchmarks](https://github.com/biomejs/biome/blob/main/benchmark/README.md)
- [Biome migration guide 2026](https://pockit.tools/blog/biome-eslint-prettier-migration-guide/)
- [Biome type-aware linting comparison](https://www.solberg.is/fast-type-aware-linting)

### Testing
- [Vitest comparisons](https://vitest.dev/guide/comparisons.html)

### HTTP
- [Undici v7 announcement](https://blog.platformatic.dev/undici-v7-is-here)
- [Undici deep dive](https://blog.platformatic.dev/http-fundamentals-understanding-undici-and-its-working-mechanism)
- [Server-side HTTP clients comparison](https://sph.sh/en/posts/server-side-http-clients-comparison/)

### Terminal UI
- [Clack prompts](https://www.clack.cc/)
- [Ink - React for CLIs](https://github.com/vadimdemedes/ink)

### Config
- [c12 - unjs](https://github.com/unjs/c12)
- [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig)

### Caching
- [When JSON Sucks - Road to SQLite](https://pl-rants.net/posts/when-not-json/)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [Bun SQLite docs](https://bun.com/docs/runtime/sqlite)

### Competitors
- [Renovate bot comparison](https://docs.renovatebot.com/bot-comparison/)
- [Dependabot vs Renovate](https://appsecsanta.com/dependabot-vs-renovate)
- [npm-check-updates](https://github.com/raineorshine/npm-check-updates)

### Cross-Runtime
- [Deno vs Node.js vs Bun 2026](https://pockit.tools/blog/deno-vs-nodejs-vs-bun-2026/)
- [Node vs Bun vs Deno 2026](https://medium.com/@jickpatel611/node-vs-bun-vs-deno-in-2026-what-actually-matters-4ad00e456078)

### Concurrency
- [Node.js Worker Threads](https://nodejs.org/api/worker_threads.html)
- [Streams vs Workers](https://medium.com/@2nick2patel2/node-streams-vs-workers-pick-the-right-hammer-cf9a5ec36dff)
