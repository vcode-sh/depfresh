# Taze Open PR Audit

*Audited: 2026-02-22*
*Repository: antfu-collective/taze*
*Total open PRs: 11*

---

## Full PR List

### PR #238 — fix: prevent bun catalog write clobber on `taze -w`
- **Author:** vcode-sh
- **Opened:** 2026-02-21 (1 day ago)
- **Closes:** #239
- **What it fixes:** When a bun monorepo has `workspaces.catalog` alongside regular `dependencies`/`devDependencies` in the root `package.json`, `taze -w` silently loses all catalog updates. Root cause: `loadPackage()` reads the same `package.json` independently for both `loadBunWorkspace()` and `loadPackageJSON()`, creating two separate `raw` objects. The second write clobbers the first.
- **The fix:** Read the file once in `loadPackage()` and pass the shared `raw` reference to both loaders. Also fixes hardcoded 2-space indent in `bunWorkspaces.ts` (now uses `detect-indent`) and render display name inconsistency for catalog prefixes.
- **Test coverage:** 18 new tests across 3 files. 69/69 tests pass.
- **Files changed:** `src/io/packages.ts`, `src/io/bunWorkspaces.ts`, `src/io/packageJson.ts`, `src/commands/check/render.ts`
- **Discussion:** One comment from msaeedsaeedi requesting review from antfu.
- **Gap revealed:** The write architecture has a fundamental problem — multiple loaders independently read the same file, creating separate `raw` objects that can clobber each other. This is an architectural issue that goes beyond bun catalogs. Yarn catalogs stored in `package.json` could theoretically hit the same problem.

### PR #237 — docs: add maturity-period to readme
- **Author:** cylewaitforit
- **Opened:** 2026-02-14 (8 days ago)
- **Closes:** #236
- **What it fixes:** Adds `--maturity-period` documentation to the README. This flag already exists but is undocumented.
- **Discussion:** None. antfu explicitly requested this PR in issue #236.
- **Gap revealed:** Feature documentation lags behind implementation. Features ship without README updates.

### PR #235 — chore(deps): bump @isaacs/brace-expansion from 5.0.0 to 5.0.1
- **Author:** dependabot
- **Opened:** 2026-02-03 (19 days ago)
- **What it fixes:** Security/dependency bump.
- **Discussion:** None.
- **Impact:** Low. Routine dependency maintenance.

### PR #234 — feat: support packageManager with hex hash
- **Author:** hyoban (Stephen Zhou, regular contributor)
- **Opened:** 2026-01-19 (34 days ago)
- **Closes:** #233
- **What it fixes:** Preserves the SHA-224 hash in the `packageManager` field of `package.json` when taze updates the version. Modern package managers (corepack) use `packageManager: "pnpm@9.0.0+sha224.xxxxx"` format. Taze was stripping the hash.
- **Files changed:** `src/io/bunWorkspaces.ts`, `src/io/dependencies.ts`, `src/io/packageJson.ts`, `src/io/packageYaml.ts`, `src/io/pnpmWorkspaces.ts`, `src/io/yarnWorkspaces.ts`, `src/types.ts`, `src/utils/packument.ts`, `src/utils/sha.ts`, `test/package-manager.test.ts` (10 files, 117 new test lines)
- **Discussion:** Author notes tests may be somewhat unstable. Depends on upstream `fast-npm-meta` PR being merged.
- **Gap revealed:** `packageManager` field handling is fragile. The hash preservation requires fetching metadata from a specific API endpoint. Also reveals that taze's type system doesn't model the `packageManager` field richly enough — it was treating it as a plain version string.

### PR #228 — chore(deps): bump glob from 10.4.5 to 10.5.0
- **Author:** dependabot
- **Opened:** 2025-11-18 (3 months ago)
- **What it fixes:** Security bump for glob (shell expansion vulnerability fix).
- **Discussion:** None. Rebases disabled due to age.
- **Impact:** Low-medium. Security fix in `glob` binary.

### PR #227 — chore(deps): bump js-yaml from 4.1.0 to 4.1.1
- **Author:** dependabot
- **Opened:** 2025-11-15 (3 months ago)
- **What it fixes:** **Security fix** — prototype pollution in YAML merge (`<<`) operator.
- **Discussion:** None. Rebases disabled due to age.
- **Impact:** Medium. This is a security vulnerability fix that has been sitting unmerged for 3 months.

### PR #226 — refactor: replace tinyglobby dependency
- **Author:** danielbayley (regular contributor)
- **Opened:** 2025-11-02 (3.5 months ago)
- **What it fixes:** Replaces `tinyglobby` with Node's built-in `fs.promises.glob`.
- **Files changed:** `package.json`, `pnpm-lock.yaml`, `src/io/packages.ts`
- **Discussion:** userquin (maintainer/member) raised two concerns: (1) `fs.promises.glob` requires Node 22, which breaks Node 20 support, and (2) glob pattern compatibility differences between picomatch (used by tinyglobby) and Node's built-in glob.
- **Gap revealed:** Dependency reduction is desirable but constrained by Node version support. Also reveals that taze's glob usage is non-trivial and pattern compatibility matters.
- **Status:** Likely stalled due to Node 22 requirement concern.

### PR #222 — chore(deps): bump vite from 7.1.3 to 7.1.11
- **Author:** dependabot
- **Opened:** 2025-10-20 (4 months ago)
- **What it fixes:** Security fix — `server.fs.deny` bypass via trailing slash in Vite dev server.
- **Discussion:** None. Rebases disabled due to age.
- **Impact:** Low for taze (vite is a devDependency for testing), but indicates general maintenance lag.

### PR #217 — fix: correctly find max satisfying version from unsorted arrays
- **Author:** leny-mi
- **Opened:** 2025-09-30 (almost 5 months ago)
- **Closes:** #189
- **What it fixes:** `getMaxSatisfying` assumed versions from `Object.keys()` on npm registry data were sorted. They're not. This caused taze to suggest older compatible versions instead of the latest ones. The fix adds explicit semver comparison logic.
- **Files changed:** `src/utils/versions.ts` (+7/-6), `test/versions.test.ts` (+16 lines)
- **Discussion:** Author found the same bug in 'newest' mode and fixed both. Small, focused fix with tests.
- **Gap revealed:** **Critical correctness bug** in the core version resolution logic. taze's version selection has been silently wrong for users who hit unsorted registry data. This is a fundamental reliability issue — the tool's primary job is to find the right version, and it was sometimes picking the wrong one.
- **Status:** 5 months unmerged despite being a clean, well-tested bug fix. Demonstrates maintenance backlog.

### PR #192 — feat: add support for bun catalog
- **Author:** arrudaricardo
- **Opened:** 2025-07-15 (7 months ago)
- **Closes:** #190
- **What it fixes:** Adds bun workspace catalog support (`workspaces.catalog` in `package.json`). This is the original implementation that was later merged by antfu in a different form. PR #238 builds on top of what was eventually merged.
- **Files changed:** `src/commands/check/render.ts`, `src/io/bunWorkspaces.ts` (new), `src/io/packages.ts`, `src/types.ts`, `test/bunCatalog.test.ts` (new), fixtures
- **Discussion:** 4 community members commented requesting this feature. Multiple people saying "I use bun and taze, I really need this." One commenter notes "bun's update isn't 100% reliable for monorepos."
- **Gap revealed:** High community demand for bun catalog support. The feature eventually shipped but the original contributor's PR sat for 7 months. Also reveals that bun monorepo users are an underserved audience.
- **Status:** Likely superseded by antfu's own implementation, but the PR remains open.

### PR #188 — chore(deps): bump brace-expansion from 1.1.11 to 1.1.12
- **Author:** dependabot
- **Opened:** 2025-06-11 (8 months ago)
- **What it fixes:** Security fix — ReDoS vulnerability in brace-expansion.
- **Discussion:** None. Rebases disabled due to age.
- **Impact:** Low-medium. Security fix sitting unmerged for 8 months.

---

## Patterns

### 1. Severe Maintenance Backlog
- 5 dependabot security PRs sitting unmerged for 3-8 months
- Clean, well-tested bug fixes (PR #217) unmerged for 5 months
- Feature PRs with strong community demand (PR #192) open for 7+ months
- js-yaml prototype pollution fix (#227) unmerged for 3 months

### 2. Write Architecture is Fundamentally Fragile
- PR #238 reveals that multiple loaders independently read the same file, creating separate `raw` objects
- Write order matters and can silently clobber changes
- No coordination mechanism between writers — each assumes it's the only one touching the file
- This pattern will repeat for any new workspace/catalog format added

### 3. Version Resolution Correctness Issues
- PR #217 shows that the core `getMaxSatisfying` function had a sorting assumption bug
- The tool's primary job (finding the right version) was sometimes wrong
- This class of bug is hard to detect because the wrong answer still "looks right" (it's a valid version, just not the latest)

### 4. Bun Ecosystem is Underserved
- PR #192 (bun catalog) had 7+ months of demand before being addressed
- PR #238 (bun catalog clobber) shows the initial implementation had a data-loss bug
- Multiple community members cite bun monorepo support as a key need

### 5. `packageManager` Field Handling is Fragile
- PR #234 shows the hash preservation problem
- Issue #106 asks for ignoring `packageManager` version checking
- The field has grown in complexity (corepack hashes, multiple package managers) but taze treats it simply

### 6. Community Wants Better Control Granularity
- Issue #101: filter by dep type (devDep vs dep)
- Issue #78: upgrade one-by-one with post-upgrade command
- Issue #206: ignore catalog:peers unless --peers is passed
- Issue #91: packageMode only works when mode is not set

### 7. Private Registry / Corporate Environment Support is Weak
- Issue #178: taze ignores `.npmrc` and uses `npm.antfu.dev` (antfu's fast-npm-meta)
- Issue #161: private npm packages documentation
- Issue #118: `npm_config_userconfig` env var being overwritten
- Issue #13: support changing registry (open since 2021)

### 8. Interactive Mode Has Performance Issues
- Issue #107: interactive mode flickers badly on large repos (vercel/next.js with 439 devDeps)
- The prompts library repaints everything on each keystroke
- No pagination or virtual scrolling

---

## Most Impactful PRs for a Rewrite

### Must-Address (Core Correctness / Architecture)

1. **PR #217 — Unsorted version arrays** — The core version resolution logic had a sorting assumption. A rewrite must not assume registry data ordering. Use explicit max-finding with semver comparison.

2. **PR #238 — Write clobber architecture** — The shared-raw-reference fix is a band-aid. A proper architecture should have a single file read, a unified mutation model, and a single write per file. The rewrite should treat file I/O as a transaction.

3. **PR #234 — packageManager hash preservation** — The `packageManager` field needs first-class modeling: `name@version+hash` parsing, hash fetching/preservation, and proper round-tripping.

### Should-Address (Feature Gaps)

4. **PR #192 / #238 — Bun catalog support** — Already partially implemented in taze main. A rewrite should have a clean workspace catalog abstraction that handles pnpm, bun, and yarn catalogs uniformly, with a single write path.

5. **PR #226 — Dependency reduction** — While the Node 22 requirement blocks this specific approach, a rewrite should minimize external dependencies and evaluate what can be replaced with built-in Node APIs (given a Node 22+ baseline).

### Low Priority (Maintenance)

6. **PRs #235, #228, #227, #222, #188 — Dependabot bumps** — A rewrite should use up-to-date dependencies from the start and have automated dependency management.

7. **PR #237 — Docs** — A rewrite should ensure features are documented as they ship.

---

## Insights for the "bump" Project

1. **Single-writer architecture:** Each file should be read once, mutated by all relevant processors, and written once. Never allow independent writers to clobber each other.

2. **Never assume registry data ordering:** Always use explicit comparison, never rely on iteration order of `Object.keys()` from JSON data.

3. **Model `packageManager` as a first-class type:** Parse `name@version+hash` into structured data. Preserve and update hashes.

4. **Unified catalog abstraction:** pnpm catalogs (YAML), bun catalogs (JSON in package.json), and yarn catalogs (YAML in .yarnrc.yml) should share a common interface. The write path should be catalog-format-agnostic.

5. **Private registry support from day one:** Read `.npmrc`, respect `npm_config_*` environment variables, support scoped registries. Do not hardcode any specific metadata API.

6. **Interactive mode needs virtual scrolling:** For repos with hundreds of dependencies, the current prompts-based approach fails. Consider a TUI framework with proper viewport management.

7. **Granular update control:** Users want to filter by dep type, update one-at-a-time with verification commands, and have fine-grained catalog control. Design the API and CLI to support composable filtering.

8. **Maintain formatting fidelity:** Use `detect-indent` everywhere. Never hardcode whitespace. Preserve key ordering in JSON output (issues #66, #58).

9. **Error handling for network issues:** Multiple issues (#178, #230, #44, #18) about timeouts and network failures. Need proper retry logic, timeout configuration, and clear error messages about which registry is being used.

10. **Dependency minimization:** Evaluate what can be done with Node built-ins (especially on a Node 22+ baseline). Fewer dependencies = fewer security bumps to manage = less maintenance burden.
