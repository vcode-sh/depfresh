# Solved Issues

Selected taze backlog items that depfresh addresses. This page highlights the high-impact ones -- for full status across every open issue and PR, see the [Coverage Matrix](./coverage-matrix.md).

## Recently Shipped

| taze item | What depfresh ships | Evidence | Verify |
|-----------|-------------------|----------|--------|
| [#164](https://github.com/antfu-collective/taze/issues/164) -- GitHub dependencies | `github:owner/repo#tag` resolution and protocol-preserving writes | `src/io/dependencies/protocols.ts`<br>`src/io/registry.ts`<br>`src/io/write/version-utils.ts`<br>`src/commands/check/check.github.integration.test.ts` | `pnpm vitest run src/commands/check/check.github.integration.test.ts` |
| [#206](https://github.com/antfu-collective/taze/issues/206) -- Peer-scoped catalogs | `catalog:peers` entries skipped unless `--peer` is passed | `src/io/catalogs/pnpm.ts`<br>`src/io/catalogs/bun.ts`<br>`src/commands/check/check.catalog-peers.test.ts` | `pnpm vitest run src/commands/check/check.catalog-peers.test.ts` |

## Open Issues Addressed

| taze issue | What depfresh ships | Evidence |
|-----------|-------------------|----------|
| [#13](https://github.com/antfu-collective/taze/issues/13), [#161](https://github.com/antfu-collective/taze/issues/161) | Private registry and scoped auth from `.npmrc` | `src/utils/npmrc.ts`, `src/io/registry.ts` |
| [#18](https://github.com/antfu-collective/taze/issues/18), [#44](https://github.com/antfu-collective/taze/issues/44), [#178](https://github.com/antfu-collective/taze/issues/178) | Timeout, retry, and error handling for registry failures | `src/io/registry.ts`, `src/io/registry.retry.test.ts` |
| [#78](https://github.com/antfu-collective/taze/issues/78) | Per-dependency verify command with rollback | `src/commands/check/write-flow.ts`, `src/io/write/backup.ts` |
| [#91](https://github.com/antfu-collective/taze/issues/91) | `packageMode` takes precedence over global mode | `src/io/resolve/resolve-dependency.ts`, `src/io/resolve-mode.ts` |
| [#101](https://github.com/antfu-collective/taze/issues/101) | `--deps-only` and `--dev-only` filters | `src/cli/normalize-args.ts`, `docs/cli/flags.md` |
| [#107](https://github.com/antfu-collective/taze/issues/107) | Stable TUI rendering (no flicker) | `src/commands/check/tui/index.ts`, `src/commands/check/tui/renderer.test.ts` |
| [#118](https://github.com/antfu-collective/taze/issues/118) | `npm_config_userconfig` env var respected | `src/utils/npmrc.ts`, `src/utils/npmrc.test.ts` |
| [#140](https://github.com/antfu-collective/taze/issues/140) | Partial failure isolation -- one broken dep does not block the run | `src/io/registry.ts`, `src/commands/check/check.registry.integration.test.ts` |
| [#173](https://github.com/antfu-collective/taze/issues/173) | Correct parsing of `name@range` override keys | `src/io/dependencies/overrides.ts`, `src/io/dependencies/dependencies.overrides.test.ts` |
| [#185](https://github.com/antfu-collective/taze/issues/185) | Prerelease channel-aware version resolution | `src/io/resolve/version-filter.ts`, `src/io/resolve/resolve.version-filter.test.ts` |
| [#201](https://github.com/antfu-collective/taze/issues/201) | Machine-readable JSON output envelope | `src/commands/check/json-output.ts`, `docs/output-formats/json.md` |
| [#239](https://github.com/antfu-collective/taze/issues/239) | Bun catalog write-clobber fix | `src/io/write/write.bun-catalog-clobber.test.ts`, `src/io/catalogs/bun.ts` |

## Open PRs Addressed

| taze PR | What depfresh ships | Evidence |
|---------|-------------------|----------|
| [#192](https://github.com/antfu-collective/taze/pull/192) | Bun catalog read/write support | `src/io/catalogs/bun.ts`, `src/io/catalogs/bun.load.test.ts`, `src/io/catalogs/bun.write.test.ts` |
| [#217](https://github.com/antfu-collective/taze/pull/217) | `maxSatisfying` correctness independent of input order | `src/utils/versions.ts`, `src/utils/versions.test.ts` |
| [#238](https://github.com/antfu-collective/taze/pull/238) | Bun catalog write-clobber fix | `src/io/write/write.bun-catalog-clobber.test.ts`, `src/io/catalogs/bun.ts` |

## Notes

- This page is intentionally selective. For complete tracking, use the [Coverage Matrix](./coverage-matrix.md).
