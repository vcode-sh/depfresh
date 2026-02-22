# Taze Architecture Analysis

**Date:** 2026-02-22
**Version analyzed:** 19.9.2
**Branch:** fix/bun-catalog-write-clobber

---

## 1. Architecture Diagram

```
CLI Entry (src/cli.ts)
  |
  v
Config Resolution (src/config.ts)
  |  - unconfig loader (taze.config.ts / .tazerc.json)
  |  - deepmerge: defaults -> config file -> CLI args
  |
  v
+---> check (src/commands/check/index.ts)
|       |
|       v
|    CheckPackages API (src/api/check.ts)
|       |
|       +---> loadPackages (src/io/packages.ts)
|       |       |
|       |       +---> loadPackageJSON (src/io/packageJson.ts)
|       |       +---> loadPackageYAML (src/io/packageYaml.ts)
|       |       +---> loadPnpmWorkspace (src/io/pnpmWorkspaces.ts)
|       |       +---> loadBunWorkspace (src/io/bunWorkspaces.ts)
|       |       +---> loadYarnWorkspace (src/io/yarnWorkspaces.ts)
|       |
|       +---> resolvePackage (src/io/resolves.ts)
|       |       |
|       |       +---> getPackageData
|       |       |       +---> fetchPackage (src/utils/packument.ts)
|       |       |       |     uses: fast-npm-meta, npm-registry-fetch, ofetch
|       |       |       +---> fetchJsrPackageMeta
|       |       |       +---> File-based JSON cache (os.tmpdir()/taze/cache.json)
|       |       |
|       |       +---> resolveDependency
|       |       |       +---> getVersionOfRange
|       |       |       +---> updateTargetVersion
|       |       |       +---> getDiff (semver comparison)
|       |       |
|       |       +---> p-limit concurrency control (default: 10)
|       |
|       +---> renderPackages (src/commands/check/render.ts)
|       |       uses: src/render.ts (table formatting, colorization)
|       |
|       +---> promptInteractive (src/commands/check/interactive.ts)
|       |       uses: readline, @posva/prompts
|       |
|       +---> writePackage (src/io/packages.ts)
|               dispatches to specific writers per package type
|
+---> checkGlobal (src/commands/check/checkGlobal.ts)
        |
        +---> npm ls --global --json
        +---> pnpm ls --global --json
        +---> resolvePackage (same as above)

Addons (src/addons/)
  +---> addonVSCode - syncs engines.vscode with @types/vscode

Utils (src/utils/)
  +---> versions.ts    - semver range parsing/manipulation
  +---> packument.ts   - npm/JSR registry metadata fetching
  +---> npm.ts         - @npmcli/config loading
  +---> sort.ts        - dependency sort (time/diff/name)
  +---> time.ts        - time difference formatting
  +---> diff.ts        - diff type constants/colors
  +---> config.ts      - packageMode matching
  +---> dependenciesFilter.ts - include/exclude filtering
  +---> package.ts     - pnpm/yarn package path parsing

Progress Bar: cli-progress (MultiBar)
Colors: ansis
```

---

## 2. Dependency Audit

### Production Dependencies (12)

| Package | Current | Status | Notes |
|---------|---------|--------|-------|
| `@antfu/ni` | ^28.2.0 | OK | Package manager detection + run commands. Actively maintained. |
| `cac` | ^6.7.14 | **Stale** | Last major update was 2020. v6.7.14 is the latest. No TypeScript ESM-first rewrite. Functional but unmaintained. |
| `find-up-simple` | ^1.0.1 | OK | Minimal ESM-only find-up. |
| `ofetch` | ^1.5.1 | OK | Used only as the `fetch` implementation passed to `fast-npm-meta`. |
| `package-manager-detector` | ^1.6.0 | OK | From unjs ecosystem. |
| `pathe` | ^2.0.3 | OK | Cross-platform path utilities. |
| `pnpm-workspace-yaml` | ^1.5.0 | OK | Comment-preserving YAML for pnpm-workspace.yaml. |
| `restore-cursor` | ^5.1.0 | OK | Restores terminal cursor on exit. |
| `tinyexec` | ^1.0.2 | OK | Lightweight exec. |
| `tinyglobby` | ^0.2.15 | OK | Fast glob replacement. |
| `unconfig` | ^7.4.2 | OK | Config file loader from unjs. Supports TS, JSON, etc. |
| `yaml` | ^2.8.2 | OK | Full YAML parser for package.yaml support. |

### Dev Dependencies (23)

| Package | Current | Status | Notes |
|---------|---------|--------|-------|
| `@antfu/eslint-config` | ^7.0.1 | OK | Flat config ESLint setup. |
| `@antfu/utils` | ^9.3.0 | OK | Used for `toArray`, `notNullish`, `createControlledPromise`. |
| `@npmcli/config` | 10.3.1 | **Pinned, risky** | Pinned to exact version. Used for `.npmrc` loading. Heavy dependency. |
| `@posva/prompts` | ^2.4.4 | **Consider replacing** | Fork of `prompts`. Low maintenance. Could use `@clack/prompts` or `consola`. |
| `@types/cli-progress` | ^3.11.6 | OK | |
| `@types/debug` | ^4.1.12 | OK | |
| `@types/node` | ^25.0.9 | OK | |
| `@types/npm-package-arg` | ^6.1.4 | **Outdated** | Package `npm-package-arg` is at v13, types may be stale. |
| `@types/npm-registry-fetch` | ^8.0.9 | **Outdated** | Package `npm-registry-fetch` is at v19. |
| `@types/semver` | ^7.7.1 | OK | |
| `ansis` | ^4.2.0 | OK | Fast terminal colors. Good choice over chalk. |
| `bumpp` | ^10.4.0 | OK | Version bumping for releases. |
| `cli-progress` | ^3.12.0 | **Consider replacing** | CJS package. Could use a lighter ESM alternative. |
| `debug` | ^4.4.3 | OK | Standard debug logging. |
| `deepmerge` | ^4.3.1 | **Outdated** | v4 is CJS. `deepmerge` v5+ or `defu` from unjs would be better. |
| `detect-indent` | ^7.0.2 | OK | |
| `eslint` | ^9.39.2 | OK | |
| `fast-npm-meta` | ^1.0.0 | OK | Fast npm registry metadata. From unjs. |
| `npm-package-arg` | ^13.0.2 | OK | |
| `npm-registry-fetch` | ^19.1.1 | OK | Fallback for non-npmjs registries. |
| `p-limit` | ^7.2.0 | OK | Concurrency limiter. |
| `semver` | ^7.7.3 | OK | Core semver operations. |
| `tsx` | ^4.21.0 | OK | |
| `typescript` | ^5.9.3 | OK | |
| `ufo` | ^1.6.3 | OK | URL utilities from unjs. |
| `unbuild` | ^3.6.1 | OK | Build tool from unjs. |
| `vitest` | ^4.0.17 | OK | |

### Key Dependency Observations

1. **`cac`** is functionally complete but unmaintained. The antfu ecosystem has moved to `citty` for newer projects.
2. **`deepmerge` v4** is CJS-only. Should migrate to `defu` (unjs, already used in the ecosystem) or `deepmerge` v5+.
3. **`@npmcli/config`** is pinned and extremely heavy for just reading `.npmrc`. Loading npm config is hacky (patching `loadDefaults`, saving/restoring `process.env`).
4. **`cli-progress`** is CJS and heavy for what it does. Could be replaced with a simpler custom implementation or `consola`.
5. **`@posva/prompts`** works but is a fork with uncertain maintenance. `@clack/prompts` is the modern choice.
6. **`@types/npm-package-arg`** and **`@types/npm-registry-fetch`** are significantly behind their runtime counterparts.

---

## 3. Performance Bottlenecks

### 3.1 Registry Fetching (Critical Path)
- **p-limit concurrency = 10 by default.** For monorepos with 100+ packages, this is the primary bottleneck.
- No retry logic. A single timeout (5000ms hard-coded) causes the entire dependency to be marked as error.
- No HTTP connection pooling or keep-alive configuration.
- The `fetchPackage` function dynamically imports `npm-package-arg` on every call (`await import('npm-package-arg')`). This dynamic import is cached by Node but adds unnecessary overhead.

### 3.2 Cache System
- **Single monolithic JSON file** at `~/.taze/cache.json` (actually `os.tmpdir()/taze/cache.json`).
- Entire cache is loaded into memory at startup and dumped at the end.
- For repos with 500+ dependencies, this JSON file can be >10MB.
- Cache TTL is 30 minutes, applied per-entry but the file-level mtime check means the entire cache is discarded if the file is older than 30 minutes.
- **Race condition:** No file locking. Concurrent taze runs can corrupt the cache.
- Cache uses `JSON.stringify` without any streaming - blocks event loop for large caches.

### 3.3 Package Loading
- In `loadPackages`, two separate glob calls are made for `**/package.yaml` and `**/package.json` sequentially. Could be parallelized.
- The `ignoreOtherWorkspaces` feature calls `findUp` for `.git`, `pnpm-workspace.yaml`, and `.yarnrc.yml` for every nested package. This is O(n * depth) filesystem lookups.

### 3.4 npm Config Loading
- `@npmcli/config` is loaded once and cached, but the initial load is very slow (>100ms) due to the complexity of npm's config system.
- The hack with saving/restoring `process.env` is fragile and not thread-safe.

### 3.5 Write Path
- Bun workspace catalog writes re-read the file from disk even though the content is already in memory (fixed in current branch).
- `writePackageJSON` calls `dumpDependencies` for every dep field even if there are no changes.
- `detect-indent` re-reads the file on every write to determine indentation.

---

## 4. Code Quality Issues

### 4.1 Type Safety Gaps
- `PackageMeta` union type is well-designed but the `raw` field varies per type (Record | null | Document). Consumers need type guards.
- `getByPath`/`setByPath` in `dependencies.ts` use `any` extensively. No type safety on nested object access.
- `flatten` in `dependencies.ts` recursively walks objects with no depth limit - potential stack overflow on deeply nested overrides.
- Several `catch {}` blocks silently swallow errors without any logging or debug output.

### 4.2 Module Boundary Issues
- `src/render.ts` and `src/commands/check/render.ts` have confusing naming. The top-level `render.ts` has both low-level table utilities AND interactive UI constants (`FIG_CHECK`, `FIG_POINTER`, etc.).
- `src/io/resolves.ts` contains both caching logic AND resolution logic AND version comparison logic. This file does too much.
- `builtinAddons` is imported in `writePackageJSON` AND `writePackageYAML` AND `check/index.ts` (in the check command). The addon execution path is unclear - addons may run twice.

### 4.3 Code Duplication
- `isDepFieldEnabled` is duplicated identically in `packageJson.ts` and `packageYaml.ts`.
- `allDepsFields` array is duplicated identically in `packageJson.ts` and `packageYaml.ts`.
- The `fileTypes` detection block for determining "package.yaml" vs "package.json" is repeated 3 times in `check/index.ts`.
- `writeYaml` helper is duplicated across `pnpmWorkspaces.ts` and `yarnWorkspaces.ts`.

### 4.4 Error Handling
- `fetchPackage` returns an error-carrying object instead of throwing. This means callers must check for `.error` on every return value.
- JSR metadata fetch uses `fetch().then(r => r.json())` without checking `r.ok`. A 404 from JSR would produce a confusing parse error instead of a clear "not found".
- The timeout mechanism uses `Promise.race` with `setTimeout` but never clears the timeout on success, causing timer leaks.

### 4.5 Style & Patterns
- `ansis` import alias varies: `c` in most files. Consistent.
- `eslint-disable` comments at the top of several files (`render.ts`, `interactive.ts`, `checkGlobal.ts`). Multiple regex-related disables in `render.ts` for the `ansiRegex` function - this should use a library or be moved to utils.
- The `ansiRegex` and `stripAnsi` functions in `render.ts` are reimplemented from `strip-ansi`/`ansi-regex`. Since `ansis` is already used, could use its built-in strip function.

---

## 5. Module-by-Module Recommendations

### src/cli.ts
- **Keep** the general structure. Clean and simple.
- **Replace `cac`** with `citty` (from unjs). Better TypeScript support, maintained, aligns with the rest of the unjs ecosystem used in this project.
- The `restoreCursor()` call at the end of the file runs synchronously at module load time, which is the wrong place. It should be in a cleanup handler.

### src/config.ts
- **Keep `unconfig`**. It is well-maintained and the right tool for this job.
- **Replace `deepmerge`** with `defu` from unjs. It is ESM-only, lighter, and designed for config merging (with proper defaults handling).

### src/io/resolves.ts
- **Refactor into 3 modules:**
  - `src/cache.ts` - Cache loading/dumping/TTL logic
  - `src/io/resolves.ts` - Dependency resolution only
  - `src/utils/versions.ts` (extend) - `getDiff`, `getVersionOfRange`, `updateTargetVersion`
- **Add retry logic** for registry fetches (1 retry with exponential backoff).
- **Add AbortController** timeouts instead of `Promise.race` with `setTimeout`.
- **Fix cache race condition** with `proper-lockfile` or OS-level advisory locks.

### src/io/packages.ts
- **Keep** overall structure.
- **Parallelize** the yaml + json glob calls.
- **Extract** shared `isDepFieldEnabled` and `allDepsFields` into a shared constants module.

### src/io/bunWorkspaces.ts
- **Current branch** fixes the shared `raw` object clobber bug. Good fix.
- **Keep** the `existingRaw` parameter pattern.
- Write path re-reads file for indent detection despite already having the content. Cache indent on load.

### src/io/pnpmWorkspaces.ts & src/io/yarnWorkspaces.ts
- Nearly identical structure. The `writeYaml` helper is literally the same function.
- **Extract** shared `writeYaml` into a common utility.
- Both use `pnpm-workspace-yaml` for parsing. Good library choice.

### src/io/packageJson.ts & src/io/packageYaml.ts
- `isDepFieldEnabled` and `allDepsFields` are duplicated.
- `writePackageJSON` applies `builtinAddons` internally but `check/index.ts` also applies addons. **Double addon execution risk.**

### src/utils/packument.ts
- **Critical:** Dynamic import of `npm-package-arg` on every call. Should be top-level import or lazy-loaded once.
- **Critical:** Dynamic import of `npm-registry-fetch` for non-npm registries. Same issue.
- JSR fetch does not validate response status.
- The npm registry path uses two different registry fetch mechanisms (`fast-npm-meta` for npmjs.org, `npm-registry-fetch` for custom registries). This branching is necessary but could be cleaner.

### src/utils/npm.ts
- **The worst module in the codebase.** It patches internal npm config behavior, saves/restores `process.env`, and depends on `@npmcli/config` which is a massive dependency.
- **Replace** with direct `.npmrc` parsing. The `rc` or `ini` package can parse `.npmrc` files directly. Alternatively, use `npm-registry-fetch`'s own config resolution.

### src/render.ts
- **Split concerns:** Move `ansiRegex`/`stripAnsi`/`visualLength` to a utils module.
- Replace hand-rolled `ansiRegex` with `ansis`'s built-in `ansis.strip()` if available, or import `strip-ansi`.
- The `createSliceRender` function is complex but necessary for interactive mode scrolling. Keep but add comments.

### src/commands/check/index.ts
- **Three identical `fileTypes` blocks** (lines ~122, ~139, ~153). Extract to a helper function.
- The `builtinAddons` application at line 103 may conflict with addon application in `writePackageJSON`. Audit the addon execution path.

### src/commands/check/interactive.ts
- Well-structured with the renderer pattern.
- Uses `process.exit()` on Escape key (line 99) - should resolve the promise with empty result instead.
- The `no-fallthrough` eslint-disable suggests switch fallthrough is intentional but should be explicit with comments.

### src/commands/check/checkGlobal.ts
- `npm ls --global --json` and `pnpm ls --global --json` are run in parallel. Good.
- Missing bun global packages support.
- Missing yarn global packages support.

### src/addons/vscode.ts
- Clean and focused. **Keep.**

### src/filters/diff-sorter.ts
- Tiny module with single function. Could be inlined into `resolves.ts` or `sort.ts`.

---

## 6. What to Keep vs What to Rewrite

### Keep As-Is
- **Type system** (`src/types.ts`) - Well-designed discriminated union types. Clean interfaces.
- **API surface** (`src/api/check.ts`) - Event-driven callback pattern works well.
- **Addon system** - Simple, extensible. Good pattern.
- **Version utilities** (`src/utils/versions.ts`) - Solid semver logic.
- **Dependencies filter** (`src/utils/dependenciesFilter.ts`) - Clean regex-based filtering.
- **Workspace catalog loaders** (pnpm, bun, yarn) - Good structure, minor DRY fixes needed.
- **Interactive mode** (`interactive.ts`) - Complex but well-structured renderer pattern.

### Refactor (Improve without Rewriting)
- **`src/io/resolves.ts`** - Split into cache + resolution + version modules.
- **`src/render.ts`** - Extract utility functions, remove hand-rolled ansi-strip.
- **`src/commands/check/index.ts`** - Remove duplicated `fileTypes` blocks, clarify addon execution path.
- **Package loaders** - Extract shared `allDepsFields` and `isDepFieldEnabled`.

### Replace
- **`cac`** with `citty` - Modern, maintained, better TypeScript.
- **`deepmerge`** with `defu` - ESM-only, lighter, better config merging.
- **`@npmcli/config`** with direct `.npmrc` parsing - Removes the heaviest and hackiest dependency.
- **`@posva/prompts`** with `@clack/prompts` or `consola` prompts - Modern, better DX.
- **`cli-progress`** with custom progress or `consola` - CJS removal, lighter.

### Add
- **Retry logic** for registry fetches.
- **AbortController** timeouts (replace `Promise.race`).
- **Cache locking** for concurrent runs.
- **Bun/Yarn global packages** support in `checkGlobal`.
- **Structured logging** (replace scattered `console.log`/`debug` with a unified logger).

---

## 7. Build System Notes

### Current: unbuild v3.6.1
- Uses rollup with `inlineDependencies: true` - all deps are bundled into output.
- Two entry points: `src/index` (library) and `src/cli` (binary).
- ESM-only output with Node16 declarations.
- `clean: true` ensures fresh builds.

### Assessment
- unbuild is appropriate for this project. It handles the dual entry point well.
- The `inlineDependencies: true` is necessary because taze ships as a single CLI binary.
- **No change recommended** for the build system. unbuild is well-maintained and works correctly.

### Alternatives Considered
- **tsdown** (successor to tsup) - Would work but offers no significant advantage for this project.
- **Bun build** - Not ready for library/dual-entry builds with proper .d.ts generation.
- **Rolldown** - Still experimental.

---

## 8. Testing Assessment

### Current State
- **17 test files** covering most modules.
- **vitest v4** with 10s timeout.
- **Fixture-based tests** for workspace catalogs (pnpm, bun, yarn).
- **No test coverage configuration.**
- **`pnpm test` runs `unbuild` before vitest.** This is slow for development iteration.

### Coverage Gaps
- No tests for `src/utils/npm.ts` (npm config loading).
- No tests for `src/commands/check/index.ts` (the main check command orchestration).
- No tests for `src/commands/check/checkGlobal.ts`.
- No tests for `src/render.ts` beyond `render.test.ts` which only has a minimal test.
- No tests for `src/log.ts`.
- No tests for `src/config.ts` (config file loading/merging).
- No integration tests for the full CLI flow beyond `cli.test.ts` which just checks the binary runs.

### Recommendations
- Add vitest coverage configuration (`--coverage`).
- Add tests for config resolution with fixture config files.
- Add snapshot tests for render output.
- The `test` script should not require `unbuild` for unit tests. Keep `unbuild && vitest` for CI, add `vitest` for local dev.

---

## 9. Summary of Priority Improvements

### High Priority
1. **Replace `@npmcli/config`** with direct `.npmrc` parsing - removes biggest tech debt.
2. **Add retry logic** to registry fetches - reliability improvement.
3. **Fix cache race condition** - concurrent runs can corrupt data.
4. **Fix double addon execution** - addons may run in both `writePackageJSON` and `check/index.ts`.

### Medium Priority
5. **Replace `deepmerge` with `defu`** - ESM alignment, smaller bundle.
6. **Split `resolves.ts`** into cache/resolution/version modules.
7. **Extract duplicated code** (allDepsFields, isDepFieldEnabled, fileTypes detection, writeYaml).
8. **Replace `cli-progress`** - remove CJS dependency.
9. **Add test coverage** for untested modules.

### Low Priority
10. **Replace `cac` with `citty`** - works fine, but modernization.
11. **Replace `@posva/prompts`** - works fine, but `@clack/prompts` is nicer.
12. **Add bun/yarn global packages** to `checkGlobal`.
13. **Replace hand-rolled `ansiRegex`** with library/built-in.
14. **Structured logging** to replace `debug`/`console.log` mix.
