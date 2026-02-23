# Edge-Case Proof (depfresh vs taze)

We ran the annoying tests people usually skip, then act surprised in CI.

## What We Ran

- Date: **2026-02-23**
- Command: `node test/edge-case-proof.mjs`
- Raw report: `/Users/tomrobak/_code_/depfresh/audit/edge-case-proof-results.json`
- Raw logs: `/Users/tomrobak/_code_/depfresh/audit/edge-case-proof-artifacts/`

## Scenarios and Results

| Scenario | depfresh | taze | What this proves |
|---|---|---|---|
| Empty monorepo (no manifests) | Exit `0`, valid JSON, `meta.noPackagesFound=true` | Exit `0`, plain text only (`dependencies are already up-to-date`) | depfresh gives automation-safe state, not guesswork prose |
| 120 dependencies in one manifest | Exit `1`, valid JSON, exact `summary.total=120`, `errors=0` | Exit `1`, text table (120 rows), no JSON envelope | depfresh is directly machine-consumable at scale |
| Corrupt cache file | Corrupt `~/.depfresh/cache.db` still returns valid JSON and completes | Corrupt `$TMPDIR/taze/cache.json` crashes with `SyntaxError` from `loadCache()` | depfresh survives cache corruption; taze faceplants before resolution |

## Short Verdict

If your workflow is a human squinting at terminal output, both tools can work.  
If your workflow is agents, CI, or anything resembling 2026, depfresh has the safer edge-case behavior and the machine-readable receipts.
