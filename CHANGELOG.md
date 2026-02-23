# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Semver because I'm not a psychopath.

## [0.10.0] - 2026-02-23

The "contracts are contracts, not vibes" release. Tightened CLI behavior so invalid inputs fail fast, made machine output explicit enough for automation that doesn't enjoy guesswork, and stopped pretending SARIF existed when it didn't. Then went back and made the whole thing properly agent-friendly because half-measures are for people who commit on Fridays.

### Breaking

- **`--output sarif` removed from runtime contract** -- SARIF was advertised but not implemented. That's trust debt. `OutputFormat` now supports only `table` and `json`, and `--output sarif` is rejected with exit code `2` like any other invalid enum.
- **Invalid enum flags now hard-fail** -- `--mode`, positional mode shorthand (`depfresh <mode>`), `--output`, `--sort`, and `--loglevel` no longer silently fall back. Invalid values now return exit code `2` with a clear error message.

### Added

- **Machine-discoverability endpoint** -- `depfresh --help-json` and `depfresh capabilities --json` now expose a JSON contract with flags, aliases, defaults, enum values, and exit-code semantics. AI agents can discover behavior without scraping prose docs like it's 2009.
- **Versioned JSON envelope metadata** -- `meta.schemaVersion` added (`1`) so downstream automation can lock to a known contract.
- **Explicit execution-state fields in JSON output** -- added:
  - `meta.noPackagesFound`
  - `meta.didWrite`
  - `summary.scannedPackages`
  - `summary.packagesWithUpdates`
  - `summary.plannedUpdates`
  - `summary.appliedUpdates`
  - `summary.revertedUpdates`
  This removes ambiguity between "no packages", "up to date", and "planned updates reverted by verify-command".
- **Non-TTY stderr breadcrumb** -- when stdout isn't a TTY and output is `table`, depfresh now prints `Tip: Use --output json for structured output. Run --help-json for CLI capabilities.` to stderr. Agents are stateless. They don't remember your last hint. This fires every time, goes to stderr so it never pollutes piped stdout, and stays silent in JSON mode because that would be insulting.
- **Structured JSON errors** -- when `--output json` is active and something explodes, you now get a proper JSON error envelope instead of a plaintext stderr scream. Includes `error.code`, `error.message`, `error.retryable`, and the usual `meta` block. Works in both the check command catch and the CLI top-level catch. Because an agent parsing `"Fatal error: something"` from stderr is not "machine-readable", it's "machine-suffering".
- **Resolution errors surfaced in JSON envelope** -- deps that fail registry resolution (diff: `error`) were silently filtered out. Now they appear in the `errors[]` array with `name`, `source`, `currentVersion`, and `message`. Your agent can see what broke instead of wondering why a dependency vanished from the output.
- **Enhanced capabilities schema** -- `--help-json` now includes:
  - `version` -- CLI version from package.json, so agents know what they're talking to
  - `workflows` -- 4 pre-built agent recipes: `checkOnly`, `safeUpdate`, `fullUpdate`, `selective`. Copy-paste commands, no guesswork
  - `flagRelationships` -- which flags require or conflict with others (`install` requires `write`, `deps-only` conflicts with `dev-only`). Agents stop generating invalid flag combinations
  - `configFiles` -- every supported config file pattern so agents know where to look
  - `jsonOutputSchema` -- concise field descriptions of the JSON envelope shape. A schema for the schema. We've gone full meta
- **Agent and integration docs** -- added quickstarts for Codex/Claude Code/Gemini CLI (`docs/agents/README.md`) plus GitHub Actions and thin MCP wrapper guidance (`docs/integrations/README.md`).

### Fixed

- **`recursive: false` now actually means root-only** -- discovery now loads only root `package.json` in non-recursive mode and skips workspace catalog loading there. Previously `recursive` was effectively ignored during package file discovery.

### Changed

- **Docs/runtime parity sweep** -- CLI, configuration, API, troubleshooting, and output docs now match actual runtime behavior (strict enum validation, JSON schema v1 fields, capabilities endpoint, no SARIF claims).
- **package.json keywords** -- added `ai`, `agent`, `machine-readable`, `json`, `automation`. SEO for robots, by robots.

### Stats

- 22 new tests. Total suite now 537 passing tests. Build, typecheck, lint clean.

## [0.9.2] - 2026-02-22

The "fine, it's called depfresh now" release. Final naming cleanup, zero feature work.

### Changed

- **Last rename sweep** -- replaced remaining `bump` references with `depfresh` across docs, CLI/API naming, and config conventions. Same behavior, less identity crisis.

## [0.9.1] - 2026-02-22

The "every file was too long and I have standards" release. Full codebase modularisation. Every production file that crept past 200 LOC got split into focused single-responsibility modules. Every test file over 250 LOC got the same treatment. Docs too, because why stop. Zero behaviour changes, zero new features, zero regressions. Just a codebase that doesn't make you scroll for 30 seconds to find the function you're looking for.

### Changed

- **Codebase modularisation** -- 10 production files split into focused directories with barrel re-exports. `types.ts`, `cli.ts`, `format.ts`, `dependencies.ts`, `resolve.ts`, `write.ts`, `packages.ts`, `check/index.ts`, `render.ts`, and `tui/renderer.ts` all decomposed into single-responsibility modules. No file above 200 LOC. Import paths unchanged because barrel exports exist for a reason.
- **Shared pattern engine** -- deduplicated glob-to-regex logic from `dependencies.ts` and `resolve-mode.ts` into `src/utils/patterns.ts`. One pattern compiler to rule them all.
- **Test suite split** -- 5 oversized test files (largest: 1,522 LOC) broken into 33 focused test files grouped by behaviour. Same 515 tests, just organised like an adult wrote them.
- **Documentation split** -- `api.md`, `cli.md`, `configuration.md`, and `output-formats.md` each split into subdirectories with index pages. For the 3 people who read docs, you're welcome.

### Stats

- 141 source files (up from ~30). 62 test files (up from 29). 515/515 tests passing. Typecheck, lint, build all clean. The codebase grew in files and shrank in complexity. That's the whole point.

## [0.9.0] - 2026-02-22

The "make it pretty and throw proper errors" release. Progress bars so you can watch your dependencies resolve in real time. CJK character width handling so the table doesn't fall apart when someone names their package in kanji. Terminal overflow so narrow terminals get truncated columns instead of broken layouts. And a typed error hierarchy because `catch (e: any)` was getting embarrassing. 19 new tests across 5 new test files. The kind of release that sounds cosmetic until you try using the tool in a 60-column tmux pane.

### Added

- **Multi-bar progress display** -- dual progress bars during dependency resolution. Top bar tracks packages, bottom bar tracks individual deps within the current package plus a running total. Updates in real-time as registry calls complete. Suppressed automatically for `--output json`, `--silent`, and non-TTY environments. Labels truncate on narrow terminals. Clears itself when done, leaving a clean terminal for the results table. Zero new dependencies.
- **CJK / Unicode-aware column alignment** -- `visualLength()` handles double-width CJK characters (Hangul, CJK Unified Ideographs, fullwidth forms), zero-width combining marks, variation selectors, and control characters. Table columns now align correctly regardless of whether your package names contain ASCII, Japanese, Korean, or emoji. The `padEnd` and `padStart` utilities are Unicode-aware. `visualTruncate()` adds `…` at the correct visual boundary without splitting a wide character.
- **Terminal overflow handling** -- table columns shrink to fit your terminal width. Priority order: name column first, then current version, then target version, then source. Minimum widths enforced so nothing collapses entirely. Only activates in TTY mode -- non-TTY output preserves full widths. `render-layout.ts` calculates optimal column widths, `render.ts` applies them. CJK-aware throughout.
- **Error class hierarchy** -- `depfreshError` base class with `code: string` for reliable branching. Five subclasses: `RegistryError` (HTTP failures, includes `.status` and `.url`), `CacheError` (SQLite issues), `ConfigError` (invalid patterns, bad config files), `WriteError` (file system failures), `ResolveError` (network timeouts, DNS failures). All include `.cause` for wrapping lower-level errors. Integrated into registry, config, write, cache, and pattern compilation paths. Exported from the public API for `instanceof` checks.
- **Strict pattern validation** -- `parseDependencies()` now throws `ConfigError` for invalid `include`/`exclude` regex patterns instead of silently skipping them. The public `compilePatterns()` utility retains silent skip behaviour for backwards compatibility. Invalid `/regex/flags` syntax is caught and wrapped with the original error as `cause`.

### Stats

- 19 new tests across 5 new files (496 → 515 total, 24 → 29 test files). Progress bar rendering, terminal overflow truncation, CJK visual width, Unicode-aware padding/truncation, error class hierarchy, strict pattern validation. All passing. All colocated.

## [0.8.0] - 2026-02-22

The "I built a TUI from scratch because Ink ships React" release. The interactive mode got evicted from its `@clack/prompts` flat-list apartment and moved into a custom readline penthouse with vim navigation, per-dependency version drill-down, viewport scrolling, and a keyboard help bar. Also replaced the config loader, wrote a docs site, and rewrote the README. 69 new tests because apparently I have a compulsion.

### Added

- **Custom interactive TUI** -- full readline-based terminal UI replacing the `@clack/prompts` checkbox list. Two views: a grouped list with colour-coded severity, and a detail drill-down showing every available version per dependency. All rendered in-place below the table output. Zero new dependencies. `@clack/prompts` preserved as a non-TTY fallback because not everyone deserves nice things.
- **Per-dependency version drill-down** -- press `→` or `l` on any dependency to see its full version history. Diff type, age, dist-tags, deprecation warnings, Node engine compatibility, provenance level. Pick any version, not just the one I picked for you. Press `←` to go back. Revolutionary UX from 1985.
- **Vim navigation** -- `j`/`k` to move, `g`/`G` to jump to first/last, `space` to toggle, `a` to select all, `h`/`l` for drill-down. Page up/down for the scroll wheel enthusiasts. Because arrow keys are for people who haven't seen the light.
- **Viewport scrolling** -- handles terminal resize, follow-scroll cursor tracking, overflow indicators. Works in terminals smaller than your ambitions. `SIGWINCH` handled because I'm not an animal.
- **`--explain` / `-E` flag** -- human-readable explanations in the version detail view. "Breaking change. Check migration guide." for majors. "Bug fixes only. Safe to update." for patches. Deprecation and provenance warnings appended. For the AI agents and juniors who want to know *why*, not just *what*.
- **Keyboard help bar** -- context-aware help at the bottom of both views. Changes between list and detail mode. Because discoverability isn't a dirty word, it's just usually ignored.
- **State machine architecture** -- pure functional state transitions, modular decomposition (model, list, detail, layout), thin facade pattern. Every state change is a pure function. No side effects. No "it works if you squint". Testable by design. Largest module: 167 LOC.
- **Documentation site** (`docs/`) -- CLI reference, configuration guide, programmatic API docs, output format specs, and a troubleshooting page. Split into five files so you can pretend you'll read more than one.
- **README rewrite** -- features section, proper structure, less rambling. Still sarcastic. Just organised sarcasm now.

### Changed

- **Config loader rewrite** -- replaced `unconfig` (antfu) with a custom loader using `jiti` for TypeScript files and native `import()` for JavaScript. Supports 15 config file patterns including `depfresh.config.ts`, `.depfreshrc.json`, and `package.json#depfresh`. One fewer dependency. Same behaviour. Better error messages when your config file is cursed.

### Stats

- 69 new tests (427 → 496 total, 18 → 24 test files). TUI module fully covered: viewport, detail, state, keymap, renderer, index. Interactive gate tests for TTY and fallback paths. All passing. All colocated. The test-to-line ratio is now genuinely concerning.

## [0.7.0] - 2026-02-22

The "correctness nobody asked for" release. Five features that fix the paper cuts real users actually hit. Windows line endings, nested monorepos, CI exit codes, working directories, and timestamps for your current deps. The kind of stuff that sounds boring until you waste 45 minutes debugging why git shows every line changed in your `package.json`. 22 new tests because I'm not shipping vibes.

### Breaking

- **Exit code 1 is now opt-in** -- `depfresh` no longer returns exit code 1 when outdated deps are found. This surprised every CI pipeline that just wanted to *check* without failing the build. Add `--fail-on-outdated` to get the old behavior. If you're piping exit codes in scripts, update them. If you weren't, congrats, nothing changes.

### Added

- **`--cwd` / `-C` flag** -- run depfresh from any directory. `depfresh --cwd ./packages/foo` checks that package without `cd`-ing around like it's 2004. Scripts and monorepo tooling can now point depfresh at specific paths without changing the working directory.
- **`--fail-on-outdated` flag** -- opt-in exit code 1 when updates are available. For CI pipelines that want to gate on outdated deps. Off by default because "your deps are slightly behind" shouldn't be a build failure.
- **CRLF line ending preservation** -- Windows users no longer get every line flagged as changed in git after depfresh writes. Detects `\r\n` in the original file, preserves it after `JSON.stringify`. Also applied to Bun catalog writes. The fix took 3 lines. The debugging took 3 hours. Classic.
- **`--ignore-other-workspaces`** (on by default) -- stops depfresh from wandering into nested monorepos. If your project contains a git submodule or a separate workspace root, those packages are now skipped automatically. Walks up from each `package.json` looking for `.git`, `pnpm-workspace.yaml`, `.yarnrc.yml`, or `workspaces` in a parent `package.json`. Disable with `--no-ignore-other-workspaces` if you enjoy chaos.
- **`currentVersionTime` in resolve output** -- the publish timestamp of your *currently installed* version, not just the target. JSON output now includes `currentVersionTime` when available. AI agents and scripts can calculate how old your current deps are without a second registry call.
- 42 new tests (385 -> 427 total, 18 test files). CRLF detection, line ending preservation, nested workspace filtering, exit code behavior, cwd config resolution, currentVersionTime population. Plus 20 bug-hunting tests for edge cases: wildcard version coercion, mixed line endings, CRLF without trailing newlines, CRLF with protocol prefixes, deeply nested workspace detection, JSON output envelope coverage, config defaults for new options, bun catalog CRLF writes. Zero bugs found. The code is annoyingly correct.

### Credits

Ideas informed by the taze ecosystem:

- taze issue [#183](https://github.com/antfu/taze/issues/183) -- CRLF line ending preservation on Windows
- taze issue [#56](https://github.com/antfu/taze/issues/56) -- exit code 1 should be opt-in for CI

## [0.6.0] - 2026-02-22

The "run whatever you want after" release. One feature. Clean. Surgical. No scope creep. The antithesis of every sprint planning meeting you've ever attended.

### Fixed

- **Post-write hooks false positives** -- `--execute`, `--install`, and `--update` hooks fired when updates were *detected* but never actually *written*. Three scenarios: `beforePackageWrite` returns `false` for all packages, interactive mode with 0 selections, or `--verify-command` reverts every dep. Hooks now track whether anything was actually written to disk. Exit code logic unchanged -- still reports updates available when they exist, even if you chose not to write them. The kind of bug that only bites you at 2am when you're wondering why your post-update script ran on an untouched codebase.

### Added

- **Execute command** (`--execute` / `-e`) -- runs any shell command once after all packages are written. `depfresh -w --execute "pnpm test"` updates your deps then runs your tests. `depfresh -w --execute "git add -A && git commit -m 'chore: deps'"` for the dangerously automated. Runs before `--install`/`--update` so your custom command operates on freshly written files before lockfile regeneration. If the command fails, depfresh logs it and moves on -- your deps were already updated, the command is a bonus. Different from `--verify-command` which runs per-dep with rollback. This one is fire-and-forget, post-write, no safety net. You asked for it.
- 18 new tests (367 -> 385 total). Guards: skips on no write, no updates, undefined, empty string. Order: runs before install, runs before update. Isolation: execute failure doesn't block install. Scope: runs exactly once across multiple packages. Edge case: fires even when `beforePackageWrite` blocks all writes (consistent with install/update). All passing.

## [0.5.0] - 2026-02-22

The "I trust nothing" release. Four features that let you verify every single dependency update before committing, manage global packages like a real CLI should, and group your interactive selections so you can actually see what you're about to break. 41 new tests because paranoia is a feature, not a bug. 367 total. At this point the tests outnumber the lines they're testing.

### Added

- **Enhanced interactive mode** -- `p.groupMultiselect` replaces the flat list. Dependencies grouped by severity: major (red), minor (yellow), patch (green). Click a group header to select/deselect all. Because scrolling through 47 deps in a flat list is not "interactive", it's "punishment". Falls back to flat multiselect for edge cases.
- **Global package support** (`--global` / `-g`) -- checks npm, pnpm, or bun global packages. Auto-detects your package manager. `depfresh -g` lists outdated globals, `depfresh -gw` updates them. Parses three different output formats because every PM had to be special. Yarn skipped because Berry deprecated global packages and I respect that decision more than they do.
- **Verify command** (`--verify-command` / `-V`) -- runs a command after each individual dep update. Fails? Reverts. Passes? Keeps it. `depfresh -w -V "pnpm test"` updates one dep at a time, runs your tests, and rolls back the ones that break. Bisecting dependency issues manually is for people who enjoy suffering.
- **Update flag** (`--update` / `-u`) -- runs `pm update` instead of `pm install` after writing. Takes precedence over `--install`. For when you want your lockfile to actually reflect what you just changed instead of optimistically hoping `install` figures it out.
- **Backup and restore** -- `backupPackageFiles()` and `restorePackageFiles()` exported from the write module. Captures file contents before mutations, restores on failure. Powers the verify flow but available for API users who enjoy living dangerously.
- 41 new tests (326 -> 367 total, 16 -> 18 test files). Interactive tests mock @clack/prompts. Global tests mock child_process. Verify tests mock the entire write pipeline. All passing. All colocated.

## [0.4.0] - 2026-02-22

The "trust issues" release. Provenance tracking, Node engine compatibility, auto-install, and seven other features I implemented because taze had 28 open issues and 14 unmerged PRs collecting dust. 326 tests now. More tests than some companies have engineers.

### Added

- **Provenance tracking** -- npm Sigstore attestations classified as `trusted`, `attested`, or `none`. If your target version has *less* provenance than your current version, you get a yellow warning. Because downgrading your supply chain security silently is the kind of thing that makes security researchers cry. Credit: sxzz (Kevin Deng, Vue core) for the concept ([taze#198](https://github.com/antfu/taze/pull/198)).
- **Node engine compatibility** (`--nodecompat`) -- extracts `engines.node` from the registry for each target version, checks against your running Node with `semver.satisfies()`. Green checkmark if compatible, red cross if not. On by default because shipping broken code to production is someone else's brand, not mine. Credit: GeoffreyParrier ([taze#165](https://github.com/antfu/taze/pull/165)).
- **Auto-install** (`--install` / `-i`) -- detects your package manager from `packageManager` field or lockfile, runs `${pm} install` after writing. Catches errors gracefully because your install failing shouldn't tank the whole run. `depfresh -wi` is now the entire workflow. You're welcome.
- **Long display mode** (`--long` / `-L`) -- shows homepage URL under each dependency. For when you need to know where that package lives before you trust it with your codebase. Renders as an indented gray `↳ https://...` because I have aesthetic standards.
- **pnpm override key parsing** -- handles `name@version-range` format from `pnpm audit --fix`. If pnpm writes `"tar-fs@>=2.0.0 <2.1.2"` into your overrides, depfresh now parses the package name correctly instead of treating the whole thing as a name. Credit: taze issue [#173](https://github.com/antfu/taze/issues/173).
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
- **Prerelease channel detection** -- if you're on `2.0.0-rc.103`, depfresh only suggests newer `rc` versions. Not `alpha`. Not `beta`. Just your channel. Taze suggests all prereleases regardless and lets you sort it out.
- **Positional mode argument** -- `depfresh major` is now shorthand for `depfresh --mode major`. Less typing. Same result.
- **`defineConfig()` export** -- typed config helper for `depfresh.config.ts`. Identity function with full type inference because we're not animals.
- **Cursor restoration** -- `restoreCursor()` on SIGINT, SIGTERM, and exit. Interactive mode will never leave your terminal cursor invisible again.
- **Wider API exports** -- `loadPackages`, `resolvePackage`, `writePackage`, `parseDependencies` all exported. Build whatever workflow you want.
- **Contextual tips** -- after checking, shows "Run `depfresh major` to check for major updates" and "Add `-w` to write changes to package files" when relevant. Only in table mode, only when there are updates, only when you haven't already done it. Subtle, not annoying.
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
- Config resolution via unconfig + defu. Supports `depfresh.config.ts`, `.depfreshrc`, or `package.json#depfresh`. Pick your poison.
- Registry fetching with p-limit concurrency. 16 parallel requests by default because patience is not a virtue, it's a bottleneck.
- SQLite cache (better-sqlite3, WAL mode). Falls back to memory if native modules aren't available. No JSON file race conditions. You're welcome.
- `.npmrc` parsing that actually works. Scoped registries, auth tokens, the whole thing. Taze ignored this for 4 years. I fixed it on day one.
- Retry with exponential backoff. 2 retries by default. I won't accidentally DDoS the npm registry.
- `--output json` for scripts and AI agents. Clean structured envelope. No ANSI codes. No log noise. Just data.
- Interactive mode with @clack/prompts. Pick what to update like a civilised person.
- Workspace catalog support for pnpm, Bun, and Yarn. Catalogs get depfreshaded alongside your deps. No manual sync.
- 7 range modes: `default`, `major`, `minor`, `patch`, `latest`, `newest`, `next`. From cautious to chaotic, your choice.
- Include/exclude regex filtering. Update what you want, ignore what you don't. Revolutionary.
- `--deps-only` and `--dev-only` because sometimes you only want half the pain.
- Semantic exit codes: `0` = chill, `1` = updates available, `2` = something broke.
- Programmatic API with lifecycle callbacks. `beforePackageStart`, `onDependencyResolved`, `beforePackageWrite`, `afterPackageWrite`. Build whatever workflow your heart desires.
- `npm:` and `jsr:` protocol support. Because the ecosystem wasn't confusing enough.
- Nested override/resolution flattening for the brave souls running complex monorepos.
- TTY detection. No spinners in your CI logs. `NO_COLOR` respected.
- 54 tests. More than some production apps I've seen.

[0.10.0]: https://github.com/vcode-sh/depfresh/releases/tag/v0.10.0
[0.9.2]: https://github.com/vcode-sh/depfresh/releases/tag/v0.9.2
[0.9.1]: https://github.com/vcode-sh/depfresh/releases/tag/v0.9.1
[0.9.0]: https://github.com/vcode-sh/depfresh/releases/tag/v0.9.0
[0.8.0]: https://github.com/vcode-sh/depfresh/releases/tag/v0.8.0
[0.7.0]: https://github.com/vcode-sh/depfresh/releases/tag/v0.7.0
[0.6.0]: https://github.com/vcode-sh/depfresh/releases/tag/v0.6.0
[0.5.0]: https://github.com/vcode-sh/depfresh/releases/tag/v0.5.0
[0.4.0]: https://github.com/vcode-sh/depfresh/releases/tag/v0.4.0
[0.3.0]: https://github.com/vcode-sh/depfresh/releases/tag/v0.3.0
[0.2.0]: https://github.com/vcode-sh/depfresh/releases/tag/v0.2.0
[0.1.0]: https://github.com/vcode-sh/depfresh/releases/tag/v0.1.0
