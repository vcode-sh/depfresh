# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Semver because I'm not a psychopath.

## [0.2.0] - 2026-02-22

The "actually test your code" release. Went from 54 tests to 159 and fixed bugs I didn't know I had. Classic.

### Fixed

- `shouldSkipDependency` had inverted logic for `workspace:` and `catalog:` protocols. It was skipping things it shouldn't and keeping things it should skip. Impressive, really.
- `cache.stats()` was called after `cache.close()` in the resolve pipeline. Worked by accident. Fixed it before it didn't.
- `JSON.parse` in `cache.get()` now handles corrupt entries instead of exploding. Deletes the bad row and moves on like a mature adult.
- 4xx registry errors (404, 403) no longer trigger retries. Because retrying "package not found" three times won't make it appear. That's not how reality works.

### Changed

- Cache and `.npmrc` loading lifted from per-package to per-run in `check()`. One SQLite open, one `.npmrc` read, regardless of monorepo size. Taze still opens one per package. I sleep well.
- Include/exclude patterns now pre-compiled once via `compilePatterns()` instead of `new RegExp()` on every dependency. Micro-optimisation? Sure. But it's the principle.
- Removed `package-manager-detector` dependency — was imported in package.json but never used in source. Ghost dependency. Spooky.
- Removed unused `_options` parameter from `renderTable()`. Dead code is dead.
- Tests colocated with source files. `foo.ts` gets `foo.test.ts` in the same directory. The separate `test/` folder has been ritually cremated. It's not 2017.

### Added

- 105 new tests across 8 new test files. Total: 159 tests, 12 files. All passing.
- Tests for: dependencies parsing, version resolution, SQLite cache (including memory fallback and corrupt data), registry fetching with retry logic, package discovery, write operations, check command integration, and table rendering.
- Exported `parsePackageManagerField` and `shouldSkipDependency` for direct testing.

### Credits

Bugs and improvements informed by taze contributors who filed issues and PRs that never got merged:

- **leny-mi** (Lennart Mischnaewski) — unsorted version array bug ([taze#217](https://github.com/antfu/taze/pull/217))
- **runyasak** — deprecated version filtering ([taze#199](https://github.com/antfu/taze/pull/199))
- **hyoban** (Stephen Zhou) — packageManager hash preservation ([taze#234](https://github.com/antfu/taze/pull/234))
- **sxzz** (Kevin Deng) — provenance downgrade warning ([taze#198](https://github.com/antfu/taze/pull/198))

## [0.1.0] - 2026-02-22

First release. Wrote it from scratch because waiting for PRs to get merged in taze was aging me faster than JavaScript frameworks.

### Added

- Full CLI with 15 flags that actually make sense. Powered by citty because I have taste.
- Config resolution via unconfig + defu. Supports `bump.config.ts`, `.bumprc`, or `package.json#bump`. Pick your poison.
- Registry fetching with p-limit concurrency. 16 parallel requests by default because patience is not a virtue, it's a bottleneck.
- SQLite cache (better-sqlite3, WAL mode). Falls back to memory if native modules aren't available. No JSON file race conditions. You're welcome.
- `.npmrc` parsing that actually works. Scoped registries, auth tokens, the whole thing. Taze ignored this for 4 years. I fixed it on day one.
- Retry with exponential backoff. 2 retries by default. I won't accidentally DDoS the npm registry.
- `--output json` for scripts and AI agents. Clean structured envelope. No ANSI codes. No log noise. Just data.
- Interactive mode with @clack/prompts. Pick what to update like a civilised person.
- Workspace catalog support for pnpm, Bun, and Yarn. Catalogs get bumped alongside your deps. No manual sync.
- 7 range modes: `default`, `major`, `minor`, `patch`, `latest`, `newest`, `next`. From cautious to chaotic, your choice.
- Include/exclude regex filtering. Update what you want, ignore what you don't. Revolutionary.
- `--deps-only` and `--dev-only` because sometimes you only want half the pain.
- Semantic exit codes: `0` = chill, `1` = updates available, `2` = something broke.
- Programmatic API with lifecycle callbacks. `beforePackageStart`, `onDependencyResolved`, `beforePackageWrite`, `afterPackageWrite`. Build whatever workflow your heart desires.
- `npm:` and `jsr:` protocol support. Because the ecosystem wasn't confusing enough.
- Nested override/resolution flattening for the brave souls running complex monorepos.
- TTY detection. No spinners in your CI logs. `NO_COLOR` respected.
- 54 tests. More than some production apps I've seen.

[0.2.0]: https://github.com/vcode-sh/bump/releases/tag/v0.2.0
[0.1.0]: https://github.com/vcode-sh/bump/releases/tag/v0.1.0
