# Registry Integration Proof (depfresh vs taze)

We finally did the thing everyone claims they'll do "later": integration tests with mocked real registries, not vibes.

## What We Ran

- Date: **2026-02-23**
- Command: `pnpm vitest run src/commands/check/check.registry.integration.test.ts`
- Result: **4/4 passing**

## Scenarios That Matter

| Scenario | depfresh result (integration-tested) | Why this hurts taze |
|---|---|---|
| Transient registry `500` | Retries and succeeds, still returns valid JSON + update result | Matches known "network flake" pain (for example taze issues like `#178`) |
| Scoped private registry + token auth | Routes `@scope/*` to scoped registry and forwards `Bearer` token from `.npmrc` | Private registry auth has been a recurring setup headache in taze discussions (`#13`) |
| Partial outage (`404` for one dep) | Keeps processing healthy deps, reports failures in JSON `errors[]` | Prevents "one broken dep blocks the run" behavior (`#140` class of issue) |
| All deps unresolved | Returns non-fatal JSON error entries instead of exploding the workflow | Better automation ergonomics than hard-fail-first behavior |

## Evidence Location

- Test suite: `/Users/tomrobak/_code_/depfresh/src/commands/check/check.registry.integration.test.ts`
- Existing comparison context: `/Users/tomrobak/_code_/depfresh/audit/codebase-comparison.md`

## Short Verdict

depfresh now has registry integration tests that lock down the exact failure modes teams complain about in real life: flaky registries, private auth, and partial outages.

taze can still be perfectly fine for basic happy paths.  
But if your CI lives on planet Earth, depfresh has the receipts.
