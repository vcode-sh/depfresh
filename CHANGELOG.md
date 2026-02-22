# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Semver because I'm not a psychopath.

## [0.4.0] - 2026-02-22

The "trust issues" release. Provenance tracking, Node engine compatibility, auto-install, and seven other features I implemented because taze had 28 open issues and 14 unmerged PRs collecting dust. 326 tests now. More tests than some companies have engineers.

### Added

- **Provenance tracking** -- npm Sigstore attestations classified as `trusted`, `attested`, or `none`. If your target version has *less* provenance than your current version, you get a yellow warning. Because downgrading your supply chain security silently is the kind of thing that makes security researchers cry. Credit: sxzz (Kevin Deng, Vue core) for the concept ([taze#198](https://github.com/antfu/taze/pull/198)).
- **Node engine compatibility** (`--nodecompat`) -- extracts `engines.node` from the registry for each target version, checks against your running Node with `semver.satisfies()`. Green checkmark if compatible, red cross if not. On by default because shipping broken code to production is someone else's brand, not mine. Credit: GeoffreyParrier ([taze#165](https://github.com/antfu/taze/pull/165)).
- **Auto-install** (`--install` / `-i`) -- detects your package manager from `packageManager` field or lockfile, runs `${pm} install` after writing. Catches errors gracefully because your install failing shouldn't tank the whole run. `bump -wi` is now the entire workflow. You're welcome.
- **Long display mode** (`--long` / `-L`) -- shows homepage URL under each dependency. For when you need to know where that package lives before you trust it with your codebase. Renders as an indented gray `↳ https://...` because I have aesthetic standards.
- **pnpm override key parsing** -- handles `name@version-range` format from `pnpm audit --fix`. If pnpm writes `"tar-fs@>=2.0.0 <2.1.2"` into your overrides, bump now parses the package name correctly instead of treating the whole thing as a name. Credit: taze issue [#173](https://github.com/antfu/taze/issues/173).
- **`npm_config_userconfig` support** -- respects the environment variable for custom `.npmrc` location. Enterprise setups with non-standard config paths now work. Credit: taze issue [#118](https://github.com/antfu/taze/issues/118).
- **Extra lifecycle callbacks** -- `afterPackagesLoaded`, `afterPackageEnd`, `afterPackagesEnd`. Three new hooks for the API users who want fine-grained control over the pipeline. `afterPackageEnd` fires for every package, even ones with no updates, because consistency matters.
- 50 new tests (276 -> 326 total, still 16 test files). All passing. All colocated. The test-to-feature ratio is getting suspicious.

### Credits

Ideas and bug reports from the taze ecosystem that informed this release:

- **sxzz** (Kevin Deng, Vue core) -- provenance downgrade warning concept ([taze#198](https://github.com/antfu/taze/pull/198))
- **GeoffreyParrier** -- engines.node compatibility column ([taze#165](https://github.com/antfu/taze/pull/165))
- **runyasak** -- auto-install concept discussion
- taze issues [#173](https://github.com/antfu/taze/issues/173) (override parsing), [#118](https://github.com/antfu/taze/issues/118) (npmrc config), [#48](https://github.com/antfu/taze/issues/48) (auto-install)

## [0.3.0] - 2026-02-22

The "feature parity but better" release. Twelve features, 276 tests, zero excuses. Taze has been building these for 4 years across scattered PRs. Thanks to everyone who contributed.

### Added

- **Version diff colorization** -- only the changed portion lights up red. `1.2.3` -> `1.2.`**`4`**. Taze colors the entire string. I have taste.
- **Time diff display** (`--timediff`) -- shows `~3d` (green), `~2mo` (yellow), `~1.5y` (red) next to each update. Know instantly if that "latest" version was published 3 hours ago or 3 years ago.
- **Grouping** (`--group`) -- deps grouped under `dependencies`, `devDependencies`, `optionalDependencies`, etc. On by default because chaos isn't a layout strategy. `--no-group` if you prefer a flat list.
- **Sorting** (`--sort`) -- 6 strategies: `diff-asc` (default), `diff-desc`, `time-asc`, `time-desc`, `name-asc`, `name-desc`. Major updates at top by default. Alphabetical if you're that person.
- **Cooldown period** (`--cooldown`) -- skip versions published less than N days ago. `--cooldown 7` means "I don't trust anything that's been alive for less than a week." Same. If all versions would be filtered, keeps the originals instead of failing. Taze would just shrug and error out.
- **`--all` flag** -- show all packages including up-to-date ones. Green "up to date" message for the ones that don't need your attention. JSON output includes them with empty `updates` array.
- **Progress indicator** -- `Resolving dependencies... 3/47` counter during resolution. TTY-only, respects `--output json` and `--silent`. Preserves user-supplied `onDependencyResolved` callback because I'm not a monster.
- **Catalog integration** -- pnpm, Bun, and Yarn workspace catalogs now fully wired into the resolve + write pipeline. Catalogs get resolved alongside regular deps, written back to their respective files. No manual sync. No clobbering.
- **Bun named catalogs** -- both `workspaces.catalog` (singular, default) and `workspaces.catalogs` (plural, named). `workspaces.catalogs.ui`, `workspaces.catalogs.testing`, whatever you want. Matches taze PR #238 except ours actually works end-to-end.
- **Glob patterns** -- `--include "@types/*"` and `packageMode: { "@types/*": "ignore" }` now work alongside regex. Auto-detects glob vs regex vs `/regex/flags` syntax. Taze only supports regex. Good luck typing `^@types\/.*$` in your terminal.
- **Private package filtering** -- auto-detects workspace package names from your monorepo and skips them during resolution. No more 404 errors from trying to fetch `@my-org/internal-lib` from the public registry. Taze makes you manually exclude these. I don't think you should have to.
- **Prerelease channel detection** -- if you're on `2.0.0-rc.103`, bump only suggests newer `rc` versions. Not `alpha`. Not `beta`. Just your channel. Taze suggests all prereleases regardless and lets you sort it out.
- **Positional mode argument** -- `bump major` is now shorthand for `bump --mode major`. Less typing. Same result.
- **`defineConfig()` export** -- typed config helper for `bump.config.ts`. Identity function with full type inference because we're not animals.
- **Cursor restoration** -- `restoreCursor()` on SIGINT, SIGTERM, and exit. Interactive mode will never leave your terminal cursor invisible again.
- **Wider API exports** -- `loadPackages`, `resolvePackage`, `writePackage`, `parseDependencies` all exported. Build whatever workflow you want.
- **Contextual tips** -- after checking, shows "Run `bump major` to check for major updates" and "Add `-w` to write changes to package files" when relevant. Only in table mode, only when there are updates, only when you haven't already done it. Subtle, not annoying.
- **`publishedAt` in JSON output** -- timestamps for when each target version was published. Useful for scripts that care about age.
- 117 new tests (159 -> 276 total, 12 -> 16 test files). All passing. All colocated.

### Credits

Ideas, bugs, and concepts borrowed from the taze ecosystem. These contributors filed PRs and issues that informed our implementation:

- **runyasak** -- cooldown/maturity period concept ([taze#205](https://github.com/antfu/taze/pull/205), [taze#229](https://github.com/antfu/taze/issues/229))
- **leny-mi** (Lennart Mischnaewski) -- unsorted version array bug identification ([taze#217](https://github.com/antfu/taze/pull/217))
- **sxzz** (Kevin Deng, Vue core) -- provenance downgrade warning concept ([taze#198](https://github.com/antfu/taze/pull/198))
- **hyoban** (Stephen Zhou) -- packageManager hash preservation ([taze#234](https://github.com/antfu/taze/pull/234))

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
- Removed `package-manager-detector` dependency -- was imported in package.json but never used in source. Ghost dependency. Spooky.
- Removed unused `_options` parameter from `renderTable()`. Dead code is dead.
- Tests colocated with source files. `foo.ts` gets `foo.test.ts` in the same directory. The separate `test/` folder has been ritually cremated. It's not 2017.

### Added

- 105 new tests across 8 new test files. Total: 159 tests, 12 files. All passing.
- Tests for: dependencies parsing, version resolution, SQLite cache (including memory fallback and corrupt data), registry fetching with retry logic, package discovery, write operations, check command integration, and table rendering.
- Exported `parsePackageManagerField` and `shouldSkipDependency` for direct testing.

### Credits

Bugs and improvements informed by taze contributors who filed issues and PRs that never got merged:

- **leny-mi** (Lennart Mischnaewski) -- unsorted version array bug ([taze#217](https://github.com/antfu/taze/pull/217))
- **runyasak** -- deprecated version filtering ([taze#199](https://github.com/antfu/taze/pull/199))
- **hyoban** (Stephen Zhou) -- packageManager hash preservation ([taze#234](https://github.com/antfu/taze/pull/234))
- **sxzz** (Kevin Deng) -- provenance downgrade warning ([taze#198](https://github.com/antfu/taze/pull/198))

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

[0.4.0]: https://github.com/vcode-sh/bump/releases/tag/v0.4.0
[0.3.0]: https://github.com/vcode-sh/bump/releases/tag/v0.3.0
[0.2.0]: https://github.com/vcode-sh/bump/releases/tag/v0.2.0
[0.1.0]: https://github.com/vcode-sh/bump/releases/tag/v0.1.0
