# Taze Open Backlog Coverage Matrix

Snapshot date: **2026-02-23**

Upstream source: [antfu-collective/taze issues](https://github.com/antfu-collective/taze/issues) and [antfu-collective/taze pull requests](https://github.com/antfu-collective/taze/pulls).

Status legend:

- `shipped` — implemented, tested, and documented in depfresh.
- `partial` — some support exists, but parity is incomplete.
- `missing` — no implementation in depfresh yet.

Issue summary: **33 open** (23 shipped, 5 partial, 5 missing).

PR summary: **11 open** (4 shipped, 1 partial, 6 missing).

## Actionable Gaps

- Issues partial (5): [#34](https://github.com/antfu-collective/taze/issues/34), [#71](https://github.com/antfu-collective/taze/issues/71), [#189](https://github.com/antfu-collective/taze/issues/189), [#230](https://github.com/antfu-collective/taze/issues/230), [#233](https://github.com/antfu-collective/taze/issues/233)
- Issues missing (5): [#58](https://github.com/antfu-collective/taze/issues/58), [#66](https://github.com/antfu-collective/taze/issues/66), [#106](https://github.com/antfu-collective/taze/issues/106), [#143](https://github.com/antfu-collective/taze/issues/143), [#151](https://github.com/antfu-collective/taze/issues/151)
- PRs partial (1): [#234](https://github.com/antfu-collective/taze/pull/234)
- PRs missing (6): [#188](https://github.com/antfu-collective/taze/pull/188), [#222](https://github.com/antfu-collective/taze/pull/222), [#226](https://github.com/antfu-collective/taze/pull/226), [#227](https://github.com/antfu-collective/taze/pull/227), [#228](https://github.com/antfu-collective/taze/pull/228), [#235](https://github.com/antfu-collective/taze/pull/235)

## Open Issues

| taze issue | Title | Status | Evidence |
|---|---|---|---|
| [#13](https://github.com/antfu-collective/taze/issues/13) | support change registry | shipped | `src/utils/npmrc.ts`<br>`src/io/registry.ts`<br>`src/commands/check/check.registry.integration.test.ts` |
| [#18](https://github.com/antfu-collective/taze/issues/18) | Socket timeout | shipped | `src/io/registry.ts`<br>`src/io/registry.retry.test.ts` |
| [#34](https://github.com/antfu-collective/taze/issues/34) | taze can't find packages that don't exist when all packages are in the latest version | partial | `src/commands/check/check.registry.integration.test.ts`<br>`src/commands/check/json-output.ts` |
| [#44](https://github.com/antfu-collective/taze/issues/44) | Does not continue when network conditions change | shipped | `src/io/registry.ts`<br>`src/io/registry.retry.test.ts` |
| [#48](https://github.com/antfu-collective/taze/issues/48) | Option to show more details like `pnpm outdated --long` | shipped | `src/cli/args-schema.ts`<br>`src/commands/check/render/table-rows.ts` |
| [#58](https://github.com/antfu-collective/taze/issues/58) | Wrong ordering / sorting after tazing with hypen and underscore | missing | — |
| [#63](https://github.com/antfu-collective/taze/issues/63) | -g option for global packages | shipped | `src/cli/args-schema.ts`<br>`src/io/global.ts`<br>`docs/cli/flags.md` |
| [#66](https://github.com/antfu-collective/taze/issues/66) | Wrong sort order: Expected object keys to be in ascending order. '3dmol' should be before '@atomistics/xyz'  jsonc/sort-key | missing | — |
| [#71](https://github.com/antfu-collective/taze/issues/71) | can't find upgarde of some package | partial | `src/utils/versions.ts`<br>`src/io/registry.ts` |
| [#78](https://github.com/antfu-collective/taze/issues/78) | Options to run upgrade one by one and run a command after to check if everything is ok | shipped | `src/commands/check/write-flow.ts`<br>`src/io/write/backup.ts` |
| [#91](https://github.com/antfu-collective/taze/issues/91) | `packageMode` option is only effective when `mode` is not set | shipped | `src/io/resolve/resolve-dependency.ts`<br>`src/io/resolve-mode.ts` |
| [#101](https://github.com/antfu-collective/taze/issues/101) | Allow filtering on devDep / Dep updates | shipped | `src/cli/normalize-args.ts`<br>`docs/cli/flags.md` |
| [#106](https://github.com/antfu-collective/taze/issues/106) | support ignore version checking for packageManager | missing | — |
| [#107](https://github.com/antfu-collective/taze/issues/107) | Interaction mode flicker issue (交互模式闪烁问题) | shipped | `src/commands/check/tui/index.ts`<br>`src/commands/check/tui/renderer.test.ts` |
| [#118](https://github.com/antfu-collective/taze/issues/118) | `npm_config_userconfig` from environment variables is being overwriten | shipped | `src/utils/npmrc.ts`<br>`src/utils/npmrc.test.ts` |
| [#140](https://github.com/antfu-collective/taze/issues/140) | Not updating all dependencies if there's a JSR package | shipped | `src/io/registry.ts`<br>`src/commands/check/check.registry.integration.test.ts` |
| [#143](https://github.com/antfu-collective/taze/issues/143) | Scan `.github/workflows` directory and updated outdated actions | missing | — |
| [#151](https://github.com/antfu-collective/taze/issues/151) | Bug: taze -w in vscode extension | missing | — |
| [#161](https://github.com/antfu-collective/taze/issues/161) | Feature request - document how to use private npm packages | shipped | `docs/configuration/files.md`<br>`src/utils/npmrc.ts` |
| [#164](https://github.com/antfu-collective/taze/issues/164) | Support for GitHub releases | shipped | `src/io/dependencies/protocols.ts`<br>`src/io/registry.ts`<br>`src/io/write/version-utils.ts`<br>`src/commands/check/check.github.integration.test.ts` |
| [#169](https://github.com/antfu-collective/taze/issues/169) | try to use a non-npmcli api for package size and security | shipped | `src/io/registry.ts`<br>`package.json` |
| [#173](https://github.com/antfu-collective/taze/issues/173) | "Invalid package name" error for pnpm overrides version range | shipped | `src/io/dependencies/overrides.ts`<br>`src/io/dependencies/dependencies.overrides.test.ts` |
| [#178](https://github.com/antfu-collective/taze/issues/178) | fetch failed, unknown error | shipped | `src/io/registry.ts`<br>`src/errors.ts`<br>`src/io/registry.retry.test.ts` |
| [#185](https://github.com/antfu-collective/taze/issues/185) | Taze does not detect newer prerelease versions (e.g. `2.0.0-rc.*`) | shipped | `src/io/resolve/version-filter.ts`<br>`src/io/resolve/resolve.version-filter.test.ts` |
| [#187](https://github.com/antfu-collective/taze/issues/187) | `--include-locked` and `-l` works differently | shipped | `src/cli/args-schema.ts`<br>`src/cli/normalize-args.ts` |
| [#189](https://github.com/antfu-collective/taze/issues/189) | taze ignores valid updates | partial | `src/utils/versions.ts`<br>`src/io/resolve/resolve.mode.test.ts` |
| [#201](https://github.com/antfu-collective/taze/issues/201) | Add machine readable output flag | shipped | `src/commands/check/json-output.ts`<br>`docs/output-formats/json.md` |
| [#206](https://github.com/antfu-collective/taze/issues/206) | Ignore dependences from `catalog:peers` unless `--peers` is passed | shipped | `src/io/catalogs/pnpm.ts`<br>`src/io/catalogs/bun.ts`<br>`src/io/catalogs/pnpm.test.ts`<br>`src/io/catalogs/bun.load.test.ts`<br>`src/commands/check/check.catalog-peers.test.ts` |
| [#230](https://github.com/antfu-collective/taze/issues/230) | 'Error: Timeout requesting' has occurred for a few packages in GitHub Codespace when updating dependencies. | partial | `src/io/registry.ts`<br>`src/cli/args-schema.ts` |
| [#231](https://github.com/antfu-collective/taze/issues/231) | Question: programmatic API usage | shipped | `src/index.ts`<br>`docs/api/overview.md`<br>`docs/api/functions.md` |
| [#233](https://github.com/antfu-collective/taze/issues/233) | Preserve the SHA-224 hash of `packageManager` | partial | `src/io/packages/package-manager-field.ts`<br>`src/io/write/package-json.ts`<br>`src/io/write/package-yaml.ts` |
| [#236](https://github.com/antfu-collective/taze/issues/236) | Add --maturity-period to README | shipped | `docs/cli/flags.md`<br>`README.md` |
| [#239](https://github.com/antfu-collective/taze/issues/239) | bug: `taze -w` silently loses bun catalog updates when root package.json has regular dependencies | shipped | `src/io/write/write.bun-catalog-clobber.test.ts`<br>`src/io/catalogs/bun.ts` |

## Open PRs

| taze PR | Title | Status | Evidence |
|---|---|---|---|
| [#188](https://github.com/antfu-collective/taze/pull/188) | chore(deps): bump brace-expansion from 1.1.11 to 1.1.12 | missing | — |
| [#192](https://github.com/antfu-collective/taze/pull/192) | feat: add support for bun catalog | shipped | `src/io/catalogs/bun.ts`<br>`src/io/catalogs/bun.load.test.ts`<br>`src/io/catalogs/bun.write.test.ts` |
| [#217](https://github.com/antfu-collective/taze/pull/217) | fix: correctly find max satisfying version from unsorted arrays | shipped | `src/utils/versions.ts`<br>`src/utils/versions.test.ts` |
| [#222](https://github.com/antfu-collective/taze/pull/222) | chore(deps): bump vite from 7.1.3 to 7.1.11 | missing | — |
| [#226](https://github.com/antfu-collective/taze/pull/226) | refactor: replace tinyglobby dependency | missing | — |
| [#227](https://github.com/antfu-collective/taze/pull/227) | chore(deps): bump js-yaml from 4.1.0 to 4.1.1 | missing | — |
| [#228](https://github.com/antfu-collective/taze/pull/228) | chore(deps): bump glob from 10.4.5 to 10.5.0 | missing | — |
| [#234](https://github.com/antfu-collective/taze/pull/234) | feat: support packageManager with hex hash | partial | `src/io/packages/package-manager-field.ts`<br>`src/io/write/package-json.ts`<br>`src/io/write/package-yaml.ts` |
| [#235](https://github.com/antfu-collective/taze/pull/235) | chore(deps): bump @isaacs/brace-expansion from 5.0.0 to 5.0.1 | missing | — |
| [#237](https://github.com/antfu-collective/taze/pull/237) | docs: add maturity-period to readme | shipped | `docs/cli/flags.md`<br>`README.md` |
| [#238](https://github.com/antfu-collective/taze/pull/238) | fix: prevent bun catalog write clobber on `taze -w` | shipped | `src/io/write/write.bun-catalog-clobber.test.ts`<br>`src/io/catalogs/bun.ts` |

Machine-readable snapshot: `audit/taze-open-backlog-2026-02-23.json`.
