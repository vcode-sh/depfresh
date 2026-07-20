# Global Apply Contract

Global package mutation uses two strict schema-v1 documents: `depfresh.global-plan` and
`depfresh.global-apply`. They are separate from repository `depfresh.plan`/`depfresh.apply` because
package-manager global state cannot share the file journal or be rolled back.

The schemas ship at `depfresh/schemas/global-plan-v1.json` and
`depfresh/schemas/global-apply-v1.json`.

```ts
import {
  applyGlobalPlan,
  createGlobalApplyPlan,
  createGlobalInvocationAuthority,
  validateGlobalApplyResult,
} from 'depfresh'

const plan = await createGlobalApplyPlan(
  [{ manager: 'pnpm', name: 'typescript', expectedVersion: '5.7.2', targetVersion: '5.8.3' }],
  { cwd: process.cwd() },
)
const result = await applyGlobalPlan(
  plan,
  { cwd: process.cwd() },
  createGlobalInvocationAuthority(['pnpm'], { globalWrite: true, processExecute: true }),
)
if (!validateGlobalApplyResult(result)) throw new Error('Invalid global result')
```

## Identity and evidence

Each operation has a stable occurrence ID over manager, package, expected version, executable
fingerprint, and global-realm fingerprint. Its operation ID additionally binds the target and fixed
argv. The plan fingerprint covers the complete canonical document. Plain-data validation rejects
unknown fields, duplicate identities, forged argv, invalid fingerprints, and non-public paths.

Manager evidence is explicit: `confirmed`, `unavailable`, `malformed`, `timeout`, `unknown`, or
`unsupported`. An absent or broken manager never becomes a confirmed empty inventory. Supported
versions are npm `>=10.0.0 <13.0.0`, pnpm `>=10.0.0 <12.0.0`, and Bun `>=1.2.0 <2.0.0`.

## Authority and execution

Apply requires all three active-invocation grants: `globalWrite`, `processExecute`, and the exact
set of managers used by the plan. Configuration and plan data cannot grant authority. Every
manager is inventoried before any update starts. Each item is inventoried again immediately before
its command, and executable/version/global-realm evidence must still match.

Commands use a resolved executable handle, no shell, bounded output, timeout and termination
observation, and a sanitized environment:

| Manager | Inventory | Update |
| --- | --- | --- |
| npm `>=10.0.0 <13.0.0` | `list -g --depth=0 --json --ignore-scripts`; `root -g` | `install -g --ignore-scripts --no-audit --no-fund -- <name>@<version>` |
| pnpm `>=10.0.0 <12.0.0` | `list -g --depth=0 --json --ignore-scripts`; `root -g` | `add -g --ignore-scripts --ignore-pnpmfile -- <name>@<version>` |
| Bun `>=1.2.0 <2.0.0` | `pm ls -g` with an absolute realm header | `add -g --ignore-scripts <name>@<version>` |

Downgrades are always skipped. A missing or stale expected version conflicts. A target already
installed is skipped. Successful process exit is not proof: fresh post-command inventory alone
determines whether the requested version is applied.

## Results and limits

Item statuses are `applied`, `skipped`, `conflicted`, `failed`, or `unknown`. Run status is derived
only from reconciled item totals and is one of `applied`, `noop`, `partial`, `conflicted`, `failed`,
or `unknown`. The result always states `rollback: "not-supported"`.

An observed target is `applied` even if the command reported a nonzero exit after making the
change. An unchanged known version after a definite command failure is `failed`; a different known
version is `conflicted`; lost/malformed inventory or changed executable/realm evidence is
`unknown`. Unconfirmed termination stops later commands, whose outcomes remain unknown.

Earlier applied items stay applied after a later failure. There is no global transaction and no
attempted rollback. Re-plan from a fresh read-only inventory before retrying conflicted, failed, or
unknown items.

The compatibility CLI routes `depfresh --global --write` and
`depfresh --global-all --write --output json` through this engine and exposes full
`globalResults`. Ordinary `depfresh plan` remains process-free and rejects global flags.
