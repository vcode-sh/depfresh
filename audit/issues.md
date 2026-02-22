# Taze Open Issues Audit

**Date:** 2026-02-22
**Total open issues:** 32
**Repository:** antfu/taze
**Oldest issue:** #13 (2021-08-15) - support change registry

---

## 1. Full Categorized List

### Bugs (14 issues)

| # | Title | Opened | Comments | Notes |
|---|-------|--------|----------|-------|
| 239 | `taze -w` silently loses bun catalog updates when root package.json has regular dependencies | 2026-02-21 | 2 | **Critical** - data loss on write, our fix branch |
| 230 | 'Error: Timeout requesting' in GitHub Codespace | 2025-12-23 | 0 | Network/timeout issue in constrained environments |
| 189 | taze ignores valid updates | 2025-06-17 | 0 | Reports taze missing valid semver updates |
| 187 | `--include-locked` and `-l` works differently | 2025-06-10 | 0 | CLI flag parsing bug - short flag behaves differently |
| 185 | Taze does not detect newer prerelease versions (e.g. `2.0.0-rc.*`) | 2025-05-29 | 0 | Prerelease version detection gap |
| 178 | fetch failed, unknown error | 2025-04-22 | 4 | Corporate proxy/firewall - taze ignores .npmrc registry config |
| 173 | "Invalid package name" for pnpm overrides version range | 2025-04-01 | 0 | pnpm `overrides` with version ranges in key cause crash |
| 164 | Support for GitHub releases | 2025-03-14 | 0 | Crash on `github:` protocol deps |
| 151 | Bug: taze -w in vscode extension | 2025-01-17 | 0 | Write mode broken in VSCode extension context |
| 140 | Not updating all dependencies if there's a JSR package | 2024-08-30 | 1 | JSR packages cause other deps to be skipped |
| 107 | Interaction mode flicker issue | 2024-04-11 | 2 | Terminal UI flicker in interactive mode, labeled `bug` + `pr welcome` |
| 91 | `packageMode` option is only effective when `mode` is not set | 2023-11-29 | 0 | Config precedence logic issue |
| 71 | can't find upgrade of some package | 2023-07-08 | 6 | Likely `node-semver` edge case with `0.0.x` ranges |
| 34 | taze can't find packages that don't exist when all others are latest | 2022-06-27 | 1 | Error handling for non-existent packages |

### Feature Requests / Enhancements (13 issues)

| # | Title | Opened | Comments | Labels | Notes |
|---|-------|--------|----------|--------|-------|
| 236 | Add --maturity-period to README | 2026-02-11 | 1 | enhancement | Docs gap |
| 233 | Preserve the SHA-224 hash of `packageManager` | 2026-01-18 | 1 | enhancement | Corepack hash preservation |
| 206 | Ignore dependencies from `catalog:peers` unless `--peers` is passed | 2025-09-08 | 3 | enhancement | pnpm catalog peer dep handling |
| 201 | Add machine readable output flag | 2025-08-27 | 0 | enhancement | JSON/structured output for scripting |
| 161 | Document how to use private npm packages | 2025-02-18 | 2 | enhancement | Docs gap for private registries |
| 143 | Scan `.github/workflows` and update outdated actions | 2024-09-15 | 5 | enhancement, pr welcome | antfu approved, needs community PR |
| 106 | Support ignore version checking for packageManager | 2024-02-26 | 0 | enhancement | Ignore packageManager field |
| 101 | Allow filtering on devDep / Dep updates | 2024-01-22 | 0 | enhancement | Filter by dependency type |
| 78 | Options to run upgrade one by one and run a command after | 2023-08-31 | 3 | enhancement | Sequential upgrade with post-command |
| 63 | -g option for global packages | 2023-04-05 | 3 | enhancement | Global package support is partially broken |
| 48 | Option to show more details like `pnpm outdated --long` | 2022-10-12 | 0 | enhancement | Verbose output with homepage/changelog links |
| 13 | support change registry | 2021-08-15 | 1 | pr welcome | CLI `--registry` flag, oldest open issue |

### Sorting / Formatting Bugs (2 issues)

| # | Title | Opened | Comments | Notes |
|---|-------|--------|----------|-------|
| 66 | Wrong sort order after taze writes | 2023-06-07 | 3 | Dependency key reordering on write |
| 58 | Wrong ordering/sorting with hyphen and underscore | 2023-02-17 | 0 | Related to #66 |

### Network / Timeout Issues (3 issues)

| # | Title | Opened | Comments | Notes |
|---|-------|--------|----------|-------|
| 44 | Does not continue when network conditions change | 2022-09-13 | 0 | No timeout recovery/retry |
| 18 | Socket timeout | 2022-03-16 | 0 | Basic timeout error, no retry logic |
| 118 | `npm_config_userconfig` from env vars being overwritten | 2024-06-11 | 1 | help wanted, pr welcome |

### Questions / Other (2 issues)

| # | Title | Opened | Comments | Notes |
|---|-------|--------|----------|-------|
| 231 | Programmatic API usage | 2026-01-04 | 3 | API docs needed, antfu says "PR welcome" |
| 169 | try to use a non-npmcli api for package size and security | 2025-03-27 | 0 | Architecture concern about bundled npmcli |

---

## 2. Top Feature Requests (by community demand / comments)

Note: Reaction counts are 0 across all issues, so ranking is based on comment activity, age, and practical impact.

1. **#143 - Scan GitHub Actions** (5 comments) - antfu has approved this feature. Would extend taze beyond npm packages to GitHub Actions version management. Multiple prior art references exist.

2. **#78 - Sequential upgrade with post-command** (3 comments) - Users want `taze --oneByOne --command "npm test"` to upgrade deps one-at-a-time and run validation after each. Interactive mode (`-I`) doesn't fully solve this.

3. **#63 - Global packages (`-g`)** (3 comments) - Global package support exists but is broken on pnpm and bun. Multiple users report issues.

4. **#201 - Machine readable output** (0 comments but high utility) - JSON output flag for CI/CD scripting. Essential for programmatic usage.

5. **#101 - Filter by dep type** (0 comments) - Allow updating only devDeps or only deps separately. Useful for staged rollout strategies.

6. **#13 - Custom registry via CLI** (1 comment, oldest issue) - `--registry` flag + respect .npmrc. Open since 2021. Related to #178 (taze ignores .npmrc).

---

## 3. Critical Bugs That Need Fixing

### P0 - Data Loss / Corruption

- **#239 - Bun catalog write clobber** - `taze -w` silently drops bun catalog updates when root package.json has both catalog and regular dependencies. Second write clobbers first. **We already have a fix on branch `fix/bun-catalog-write-clobber`.**

### P1 - Broken Core Functionality

- **#178 - fetch failed / ignores .npmrc** (4 comments) - Taze ignores project and user `.npmrc` files, breaking it behind corporate proxies and with custom registries. Root cause: taze uses its own fetch logic bypassing npm's config resolution. Related to #13 and #118.

- **#140 - JSR package blocks other updates** - Having a JSR package in `package.json` causes taze to skip other outdated dependencies entirely.

- **#173 - pnpm overrides version range crash** - Overrides created by `pnpm audit --fix` (with version ranges in keys like `esbuild@<=0.24.2`) cause "Invalid package name" crash.

- **#187 - `--include-locked` vs `-l` behave differently** - Short flag `-l` doesn't work the same as `--include-locked`. CLI parsing bug.

### P2 - Significant UX Issues

- **#66 / #58 - Dependency sort order** (3 comments on #66) - taze reorders dependency keys on write, breaking eslint `jsonc/sort-key` rules. Users have offered PRs.

- **#107 - Interactive mode flicker** - Terminal UI flickers in interactive mode. Labeled `bug` + `pr welcome`.

- **#44 / #18 - No timeout retry** - Network interruption or slow registry causes permanent hang with no recovery. No retry logic exists.

---

## 4. Feature Gaps (What Users Want vs. What Taze Has)

| Gap | Issues | Impact |
|-----|--------|--------|
| **Registry/proxy support** | #13, #118, #178 | Taze is unusable in corporate environments with custom registries or proxies. The .npmrc is ignored. |
| **Machine-readable output** | #201, #231 | No JSON output for CI/CD automation. Programmatic API exists but is undocumented. |
| **Dependency type filtering** | #101 | Cannot selectively update only devDeps or only deps. |
| **GitHub Actions updating** | #143 | Competitor feature gap - Renovate does this. antfu has approved. |
| **Prerelease handling** | #185 | Cannot detect or offer prerelease version upgrades. |
| **Sequential upgrade + validation** | #78 | No way to upgrade one dep at a time and test between each. |
| **Preserve file formatting** | #66, #58, #233 | Sort order changes on write. SHA-224 hashes stripped from packageManager. |
| **Robust error handling** | #34, #164, #173 | Crashes on non-existent packages, github: protocol deps, pnpm override ranges. |
| **Network resilience** | #18, #44, #230 | No retry logic, no timeout recovery, no graceful degradation. |
| **Global package management** | #63 | `-g` flag is broken for pnpm and bun. |
| **Private package docs** | #161 | Users don't know how to configure taze for private registries. |

---

## 5. Priority Recommendations for "bump" Rewrite

### Must Fix (carry over from taze)

1. **Registry configuration** - Properly read `.npmrc` / `.yarnrc` / `bunfig.toml` for custom registries, auth tokens, and proxy settings. This is the single biggest pain point spanning issues #13, #118, #178, and #161. In corporate environments, taze is literally unusable.

2. **Write integrity** - Never clobber data on write. The bun catalog write issue (#239) is a symptom of the dual-raw-object architecture. Bump should use a single source-of-truth for each file.

3. **Network resilience** - Add retry logic with exponential backoff, proper timeout handling, and graceful degradation (#18, #44, #230). Show which packages failed and allow partial results.

4. **Preserve file formatting** - Maintain original key ordering (#66, #58), preserve hashes in packageManager (#233), respect indent style. Consider using a JSON AST parser that preserves structure rather than parse-mutate-stringify.

### Should Build (high-demand features)

5. **Machine-readable output** - JSON output mode for CI/CD pipelines (#201). Essential for programmatic consumers.

6. **Dependency type filtering** - Allow `--deps-only`, `--dev-only`, `--peer-only` flags (#101). Useful for staged upgrade strategies.

7. **GitHub Actions scanning** - Scan `.github/workflows/*.yml` for outdated action versions (#143). antfu has approved this. Differentiates from npm-only tools.

8. **Sequential upgrade mode** - Upgrade one dep at a time with a post-command hook (#78). Enables `bump --one-by-one --run "pnpm test"` workflow.

9. **Prerelease version support** - Detect and offer prerelease upgrades when the current version is already a prerelease (#185).

### Nice to Have

10. **Improved interactive mode** - Fix flicker (#107), add better monorepo UX for interactive selection.

11. **Global packages** - Fix `-g` for all package managers (#63).

12. **Documented programmatic API** - TypeScript-first API with proper docs and examples (#231).

13. **Verbose/long output** - Show changelog links, homepage, and more package metadata (#48).

---

## Issue Age Distribution

| Age | Count | Issues |
|-----|-------|--------|
| < 3 months | 4 | #239, #236, #233, #231 |
| 3-12 months | 5 | #230, #206, #201, #189, #187 |
| 1-2 years | 7 | #185, #178, #173, #169, #164, #161, #151 |
| 2-3 years | 5 | #143, #140, #118, #107, #106 |
| 3+ years | 11 | #101, #91, #78, #71, #66, #63, #58, #48, #44, #34, #18, #13 |

Over a third of open issues (11/32) are 3+ years old. The oldest (#13) has been open since August 2021.
