# Apply Contract

`depfresh.apply` schema version 1 is the observed result of applying one reviewed immutable
`depfresh.plan` document. It never re-resolves versions.

```bash
depfresh plan --json > depfresh-plan.json
depfresh apply --json --write --plan-file depfresh-plan.json
```

The schema is exported as `depfresh/schemas/apply-v1.json`. Library callers use:

```ts
import { apply, createInvocationAuthority, validateApplyResult } from 'depfresh'

const result = await apply(plan, { cwd: process.cwd() }, createInvocationAuthority({ write: true }))
if (!validateApplyResult(result)) throw new Error('Invalid apply result')
```

Configuration cannot grant file-write authority. The CLI requires the explicit `--write` flag and
one `--plan-file`; stdin and legacy check JSON are not accepted as plan transports.

## Preconditions and phases

Before mutation, apply validates plain-data input, the plan schema and semantic fingerprint,
clone-stable repository identity, contained unique regular files, source IDs, exact byte hashes,
expected own occurrence values, and target-only Git state. Clean or ignored targets may proceed.
Staged, unstaged, added, deleted, renamed, conflicted, untracked, or changed targets conflict. A
definite non-Git directory can rely on exact file evidence; an unavailable Git probe cannot be
assumed clean. Unrelated dirty paths neither block nor change.

The result records `preflight`, `lock`, `stage`, `precommit`, `commit`, `recovery`, `inspect`, and
`cleanup` phase evidence when reached. Every active physical file is rendered once into an
exclusive same-directory stage file, preserves its mode, is fsynced, reparsed, and checked for every
requested occurrence. A byte-exact same-directory backup is also fsynced. Immediately before the
first replacement, every target identity, inode, hash, expected value, Git state, and lock owner is
rechecked. Any mismatch before replacement means zero depfresh replacements.

Files are replaced individually by same-directory atomic rename. Identity and lock ownership are
checked again before each rename. This provides atomic replacement per file, not an atomic
repository transaction. Pure Node does not expose a portable held-directory `renameat` primitive;
an attacker replacing an ancestor directory after the final pathname check is a documented OS-level
limit. Final result truth always comes from observed bytes and occurrences, not syscall return values.

## Lock and journal

The root-local `.depfresh/apply.lock/owner.json` format is version 1 and contains `runId`, random
`token`, `pid`, `host`, `startedAt`, a hash of the physical root, the plan fingerprint, and a
repository-relative journal location. Age alone never makes a lock stale. A live, foreign-host,
malformed, unreadable, permission-unknown, or recovery-bearing owner blocks. Only a valid same-host
owner proven dead and without journal evidence can be reclaimed.

New state, lock, runs, and run directories are created with mode `0700`; new owner, journal, stage,
and backup files use restrictive or source-preserving creation modes as appropriate. Owner and
journal files are created as `0600`. Existing repository directories are validated, not silently
re-permissioned.

The version-1 journal lives at `.depfresh/runs/<runId>/journal.json`. It contains only the run and
plan IDs plus repository-relative file, stage, and backup paths, original/staged SHA-256 hashes,
mode, and `staged`, `replacing`, `replaced`, `restored`, or `recovery-failed` target state. Successful
runs and complete in-process recovery remove their temporary evidence. Incomplete recovery retains
the lock, journal, stage files, and backups for manual inspection.

Do not delete a lock whose owner is live, foreign, malformed, or otherwise unknown. For a confirmed
dead crashed run, stop all apply processes, inspect the journal, verify each backup against its
`sourceHash`, atomically rename the same-directory backup over its target, and verify the final byte
hash and expected occurrences. Remove retained evidence only after every target is known. If any
owner, backup, target, or final state is ambiguous, preserve the evidence and treat the run as
`unknown`.

## Outcomes and exits

Each operation retains its plan/source/occurrence identity, relative file and nested path, expected
and requested values, observed value/hash when available, status, and stable reason. Summary counts
must exactly reconcile with operations.

- `applied`: final bytes equal the staged bytes and the requested value is observed.
- `skipped`: no change was required and the exact final value is observed.
- `conflicted`: a known precondition blocked all replacements.
- `reverted`: a failed run ended with the exact original bytes and expected value after a
  replacement boundary was reached.
- `failed`: the final state is known but the requested run contract was not satisfied.
- `unknown`: bytes, ownership, recovery, or final occurrence state could not be established.

CLI exit `0` means `applied` or `noop`; exit `1` is a schema-valid conflicted, reverted, failed, or
unknown result; exit `2` is a fatal input, authority, contract, or runtime error emitted as one
redacted `depfresh.error` document. Manager commands, lockfile synchronization, installs, global
updates, and trust verification are not part of this file phase.

An operation-free plan can still return top-level `unknown` with zero operation counts when
retained or ambiguous apply state prevents a trustworthy no-op. The preflight phase and recovery
object carry that evidence; it is exit `1`, not success.
