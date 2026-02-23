# Registry & Edge-Case Testing

Integration tests that verify depfresh handles the registry failure modes and edge cases that teams actually hit in production.

## Registry Integration Tests

- Test suite: `src/commands/check/check.registry.integration.test.ts`
- Run: `pnpm vitest run src/commands/check/check.registry.integration.test.ts`

| Scenario | depfresh behavior |
|----------|------------------|
| Transient registry `500` | Retries with backoff, returns valid JSON with update results |
| Scoped private registry + token auth | Routes `@scope/*` to scoped registry, forwards `Bearer` token from `.npmrc` |
| Partial outage (`404` for one dep) | Continues processing healthy deps, reports failures in JSON `errors[]` array |
| All deps unresolved | Returns non-fatal JSON error entries instead of crashing the workflow |

These scenarios map to long-standing taze issues: [#178](https://github.com/antfu-collective/taze/issues/178) (network failures), [#13](https://github.com/antfu-collective/taze/issues/13) (private registry auth), [#140](https://github.com/antfu-collective/taze/issues/140) (partial failures blocking runs).

## Edge-Case Tests

| Scenario | depfresh behavior |
|----------|------------------|
| Empty monorepo (no manifests) | Exit `0`, valid JSON with `meta.noPackagesFound=true` |
| 120 dependencies in one manifest | Exit `1`, valid JSON, exact `summary.total=120`, `errors=0` |
| Corrupt cache file | Completes normally with valid JSON output (SQLite handles corruption gracefully) |

## Why This Matters

If your workflow relies on parsing tool output programmatically -- CI pipelines, AI agents, automation scripts -- these edge cases determine whether a tool fails gracefully or blows up your pipeline. depfresh tests for these scenarios explicitly.

## Related

- [Coverage Matrix](./coverage-matrix.md) -- Full issue/PR tracking
- [Migrating from taze](./from-taze.md) -- Practical migration guide
