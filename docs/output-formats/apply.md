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

For a plan containing manager phases, callers must grant only the matching capabilities. For
example, sync plus verification uses
`createInvocationAuthority({ write: true, syncLockfile: true, verify: true })`; install uses
`install: true` instead. An artifact-verification install additionally requires
`verifyArtifacts: true`; the authority snapshot records its `artifactVerify` and `networkAccess`
grants. Plan data and configuration never grant authority.

## Preconditions and phases

Before mutation, apply validates plain-data input, the plan schema and semantic fingerprint,
clone-stable repository identity, contained unique regular files, source IDs, exact byte hashes,
expected own occurrence values, and target-only Git state. Clean or ignored targets may proceed.
Staged, unstaged, added, deleted, renamed, conflicted, untracked, or changed targets conflict. A
definite non-Git directory can rely on exact file evidence; an unavailable Git probe cannot be
assumed clean. Unrelated dirty paths neither block nor change.

The result records `preflight`, `lock`, optional `manager-preflight`, `stage`, `precommit`, `commit`,
optional `sync-lockfile` or `install`, optional `verify`, `recovery`, `inspect`, and `cleanup` phase
evidence when reached. An exact-artifact install inserts `artifact-verify` after `install` and
before generic `verify`. Every active physical file is rendered once into an
exclusive same-directory stage file, preserves its mode, is fsynced, reparsed, and checked for every
requested occurrence. A byte-exact same-directory backup is also fsynced. Immediately before the
first replacement, every target identity, inode, hash, expected value, Git state, and lock owner is
rechecked. Any mismatch before replacement means zero depfresh replacements.

Files are replaced individually by same-directory atomic rename. Identity and lock ownership are
checked again before each rename. This provides atomic replacement per file, not an atomic
repository transaction. Pure Node does not expose a portable held-directory `renameat` primitive;
an attacker replacing an ancestor directory after the final pathname check is a documented OS-level
limit. Final result truth always comes from observed bytes and occurrences, not syscall return values.

Manager preflight resolves one executable without a shell, checks its exact `--version` output and
the planned lockfile hash before source replacement, and pins the executable identity for the later
command. The fixed command runs after source replacement while the apply lock and journal remain
owned. Its sanitized environment, timeout, termination state, public argv, lifecycle suppression,
final lockfile hash/parse/affected-occurrence evidence, changed paths, unexpected paths, and
declared external effects are recorded without stdout, stderr, secrets, or stacks. On Linux and
macOS, a private per-run environment marker plus before/after same-user
PID/start/process-group identity observations run after every exit, timeout, or output-limit
termination. Marked detached descendants are terminated; any new unattributed same-user process
makes termination unknown. This conservative rule can reject a phase when an unrelated process
starts concurrently. If the baseline observer is unavailable, the command is not spawned; an
unavailable final observation after spawn is unknown. Manager phases are blocked where these
observers do not exist. Verification runs only after successful manager work and may not write any
repository path.

The schema-v1 supported command arrays are exact:

| Manager | Lockfile-only sync argv | Full-install argv |
| --- | --- | --- |
| npm 10/11 | `["install","--package-lock-only","--ignore-scripts","--no-audit","--no-fund"]` | `["install","--ignore-scripts","--no-audit","--no-fund"]` |
| pnpm 10/11 | `["install","--lockfile-only","--ignore-scripts","--ignore-pnpmfile","--no-frozen-lockfile","--config.lockfile-dir=.","--config.modules-dir=node_modules","--config.virtual-store-dir=node_modules/.pnpm","--config.node-linker=isolated","--config.enable-global-virtual-store=false","--config.enable-modules-dir=true","--config.shared-workspace-lockfile=true","--config.lockfile=true"]` | `["install","--ignore-scripts","--ignore-pnpmfile","--no-frozen-lockfile","--config.lockfile-dir=.","--config.modules-dir=node_modules","--config.virtual-store-dir=node_modules/.pnpm","--config.node-linker=isolated","--config.enable-global-virtual-store=false","--config.enable-modules-dir=true","--config.shared-workspace-lockfile=true","--config.lockfile=true"]` |
| Bun 1.2 through 1.x | `["install","--lockfile-only","--ignore-scripts","--no-progress","--no-summary"]` | `["install","--ignore-scripts","--no-progress","--no-summary"]` |

Pnpm containment arguments override project output redirects; its package store remains the declared
non-transactional manager-cache effect. Verification argv is contract-public data: absolute paths
and credential/auth-shaped flags, headers, or values are rejected rather than serialized.
Manager execution currently reconciles only registry-backed `semver` and `npm:` alias occurrence
protocols. The exact unsupported protocol vocabulary is `workspace`, `jsr`, `github`, `catalog`,
`file`, `link`, `git`, `http`, and `unknown`; these remain file-plan-only and block a requested
manager phase before apply. An `npm:` alias must reconcile its manifest alias key, exact aliased
registry package name, exact specifier, and exact resolved version. A same-version package-name swap
is a mismatch for npm, pnpm, and Bun.

## Exact npm artifact verification

Artifact verification is optional and currently supports only public-registry npm artifacts with npm
`>=11.12.0 <12.0.0 || >=12.0.0 <12.1.0`. Apply reuses the executable pinned during manager
preflight and runs the plan's fixed
`npm audit signatures --json --include-attestations --ignore-scripts` argv after a successful
install. It never runs lifecycle scripts. Each expected artifact is rebound to the final
`package-lock.json` or `npm-shrinkwrap.json` entry, exact SHA-512 integrity, installed location, and
contained non-symlink package manifest with the exact physical name/version before the verifier is
started.

The verifier receives a private `0700` temporary home and cache plus empty `0600` user/global npm
configuration and a fixed public registry. Inherited credentials and npm configuration are not
passed through. A project `.npmrc` makes verification unavailable rather than risking credential or
registry inheritance. Stdout and stderr are separately bounded to 8 MiB, parsed privately, and
discarded; public command evidence contains termination metadata but no raw verifier response,
attestation bundle, secret, or stack. Timeout and output overflow retain distinct command
termination metadata. Offline codes, expired signature-key evidence, and other malformed/tool
failures become sanitized offline, stale, or error trust reasons.

`artifactResults` records the artifact ID, boundary, installed location, package/version,
registry/integrity, final lockfile path/hash, verifier/version, evidence time, and separate
signature and provenance states. npm's JSON does not provide safe per-artifact positive signature
coverage, so a signature is never promoted to pass: exact invalid or missing records fail, otherwise
the result is `SIGNATURE_POSITIVE_COVERAGE_UNAVAILABLE`. Provenance passes only when npm supplies one
verified SLSA provenance v1 DSSE statement whose in-toto subject PURL and SHA-512 digest exactly
match the planned artifact. Presence alone never passes.

Default fail/unknown results warn and do not make trust claims. Fingerprinted ordered signal rules
may change only the effect to `warn` or `block`; results retain every matched rule ID and the winning
ID. A block invokes normal recovery. Repository mutation, lock/source/install drift, binding loss,
or verifier-home cleanup failure is failed/unknown and retains sanitized evidence. Package-manager
caches and install trees remain non-transactional. Pnpm, Bun, JSR, private-registry, custom
cryptographic, and broader native-audit claims are unsupported until an official mechanism can bind
its result to the exact artifact safely.

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

Manager phases add `manager-phase.json` and byte-exact lockfile backups to the same owned run
directory. A sync or verification failure restores planned lockfiles and then invokes source
recovery only while the exact post-command identity is still current. Unexpected paths, a hostile
or concurrently changed identity, surviving processes, escaping install paths, install trees, or
ambiguous observation remain partial/unknown and retain evidence.

Every started manager command declares at least a package-manager-cache effect. Because that effect
cannot be rolled back or inspected completely, any later manager or verification failure returns a
top-level `unknown` result and retains recovery evidence even when planned source and lockfile bytes
were restored exactly. The restored file operations remain visible as `reverted`; they do not erase
the external-effect uncertainty.

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
redacted `depfresh.error` document. Missing or mismatched grants are fatal. A wrong manager version,
stale lockfile, nonzero exit, signal, timeout, unexpected mutation, or recovery problem is a
schema-valid non-success result. Global updates use the separate
[`depfresh.global-plan`/`depfresh.global-apply` contract](./global-apply.md); package trust remains
inside the optional `artifact-verify` phase only when it was fingerprinted by the immutable plan.

An operation-free plan can still return top-level `unknown` with zero operation counts when
retained or ambiguous apply state prevents a trustworthy no-op. The preflight phase and recovery
object carry that evidence; it is exit `1`, not success.
