# Safe Write and Visual+ v2 Design

## Status

- **Date**: 2026-07-18
- **Decision**: approved for implementation planning
- **Release sequence**: `2.0.2` correctness hotfix, then `2.1.0` command lifecycle and Visual+ v2
- **Primary human interface**: durable inline terminal output
- **Rejected primary direction**: full-screen Focus TUI and an OpenTUI runtime migration

## Incident evidence

This design responds to the observed `bunx depfresh major -w` run against the Spreadu monorepo.
The failure has a proven code and runtime chain:

```text
git ls-files output at repository root: 1,250,160 bytes
  -> spawnSync default buffer terminated the child with ENOBUFS
     after 1,114,112 captured bytes
  -> repository VCS evidence became VCS_PROBE_FAILED
  -> apply preflight became VCS_UNAVAILABLE
  -> 41 operations targeting the root package.json became unknown
  -> the legacy adapter converted VCS_UNAVAILABLE to WRITE_FAILED
  -> the terminal printed 41 misleading "Write unknown" warnings
```

The same probe from `apps/docs` produced 5,329 bytes and succeeded. The run consequently applied
35 occurrence updates across 13 child manifests before the root plan failed. The root
`package.json`, including its Bun catalog, was unchanged. Fourteen physical targets participated
in the intended run, so the repository was left partially updated even though each individual
file apply retained its local safety guarantees. The process returned exit code `2`, but the
human output did not communicate the partial result or the safe next action clearly.

The implementation explains the incident:

- `src/repository/vcs.ts` enumerates the complete tracked-file index with synchronous buffered
  `git ls-files`, even when only a small exact target set matters.
- `src/commands/apply/legacy.ts` projects the detailed apply result into a narrow compatibility
  outcome and maps every unknown reason outside its allow-list to `WRITE_FAILED`.
- `src/commands/check/run-check.ts` processes and writes packages sequentially after resolution,
  creating an independent legacy plan for each package instead of one plan for the command.
- `src/commands/check/progress.ts` models discovery, evidence, resolution, and rendering, but not
  preflight, mutation, observation, recovery, or the final safety verdict.

## Product goal

Make a write run feel controlled, legible, and trustworthy from the first scan through the final
observed result. The command must:

1. know whether every selected target can be changed before the first replacement;
2. preserve the exact reason when evidence is unavailable or a phase is blocked;
3. show every selected update once, with useful hierarchy rather than repetitive alarms;
4. expose the real lifecycle, including mutation, observation, and recovery;
5. end with an unambiguous statement of what changed, what did not, and what the user should do;
6. retain complete and readable output in terminal scrollback, pasted logs, CI, pipes, and narrow
   terminals.

Premium quality means semantic continuity, information hierarchy, restrained motion, and exact
receipts. It does not mean decorative ASCII art or an alternate-screen dashboard.

## Non-goals

- No repository-wide atomicity claim. Replacement is atomic per physical file; multi-file
  recovery remains best effort and must report uncertainty honestly.
- No full-screen or alternate-screen default interface.
- No OpenTUI, Bun, Zig, native renderer, graphics protocol, or terminal-specific image dependency.
- No hidden updates, collapsed failure totals, or details available only in debug mode.
- No structural change to JSON envelopes, silent output, library authority, or the rule that
  unknown never becomes success merely for visual convenience. The legacy write-outcome reason
  vocabulary receives the additive `VCS_UNAVAILABLE` value required to stop misclassification.
- No automatic install, lockfile update, commit, push, or recovery action without the existing
  explicit invocation authority.
- No long, staggered, bouncing, or keyboard-triggered animation.

## Release 2.0.2: correctness and trust hotfix

The patch release is intentionally narrow. It repairs the shipped failure mode before the broader
renderer and orchestration work lands.

### Exact-target VCS evidence

Replace the complete-index tracked-file query with exact-target queries. The adapter must bind
every requested repository-relative target to Git without enumerating irrelevant tracked paths.
Git 2.50.1 does not provide `ls-files --pathspec-from-file`, so targets are passed after the `--`
option terminator as no-shell argument arrays split into bounded batches. The fixed Git binary,
disabled optional locks, sanitized Git environment, containment rules, and read-only behavior
remain unchanged.

The process boundary still needs an explicit output limit. Exceeding it becomes the new repository
diagnostic `VCS_OUTPUT_LIMIT_EXCEEDED`, distinct from `VCS_EXECUTABLE_MISSING`,
`VCS_NOT_REPOSITORY`, and the remaining `VCS_PROBE_FAILED` cases. Diagnostic detail must be
bounded and sanitized; raw Git output and raw errors never reach human or JSON output.

This fix must prove that:

- a repository whose complete tracked index exceeds the former buffer succeeds for a small exact
  target set;
- clean, tracked, untracked, ignored, renamed, and conflicted exact targets retain their current
  classification;
- pathspec metacharacters are escaped or treated literally as required by the selected Git
  invocation; leading dashes, newlines, Unicode, and repository-boundary paths cannot broaden the
  query or inject arguments;
- Git index, worktree bytes, status, and optional-lock state remain unchanged.

### Preserve the preflight cause

Extend the legacy write outcome vocabulary so the compatibility path can represent a safely
blocked VCS preflight. The public compatibility reason is `VCS_UNAVAILABLE`; the associated
repository diagnostic retains the narrower cause such as `VCS_OUTPUT_LIMIT_EXCEEDED`.

The human patch-release message is grouped by physical target and phase. For the reproduced root
case it must communicate, in plain language:

```text
Safety block · preflight could not confirm Git state for package.json
No replacement was attempted for this file.
Reason: Git evidence exceeded the safe output boundary (VCS_OUTPUT_LIMIT_EXCEEDED)
```

It must never call a preflight block a write failure. If earlier package transactions were already
applied by the 2.0.x orchestration, the final receipt must explicitly say that the run is partial,
list the applied and blocked physical-file counts, and return exit code `2`.

### Patch acceptance

`2.0.2` is ready only when the oversized-index reproduction is green, the real reason survives
the compatibility projection, repeated occurrence warnings are grouped by one physical cause,
existing machine contracts validate, and focused plus full gates pass. It does not claim to solve
the package-by-package transaction boundary; that limitation remains documented until `2.1.0`.

## Release 2.1.0: one command lifecycle

### Renderer-neutral run model

The check command creates one renderer-neutral run model. Renderers observe state transitions and
immutable snapshots; they do not infer correctness from log strings.

```text
discover -> inspect -> resolve -> review -> preflight -> stage -> apply -> observe -> complete
                                                           \-> recover -> observe -> complete
```

The model owns:

- repository scope and physical targets;
- declared, eligible, selected, and unresolved occurrence counts;
- update severity and age metadata already available from resolution;
- exact operation-to-owner and shared-declaration relationships;
- phase state: pending, active, passed, skipped, blocked, failed, or unknown;
- one command result containing operations, physical-file results, phases, recovery evidence,
  diagnostics, elapsed time, and exit status.

Only a currently active asynchronous phase may animate. A completed state is immutable and
rendered durably once.

### Global collection before mutation

Resolution and package lifecycle hooks may still run in deterministic package order, but local
writes do not occur inside that loop. Instead:

1. resolve all packages using the current shared resolve context;
2. run selection and `beforePackageWrite` decisions without mutation;
3. collect every selected physical occurrence, including shared catalog ownership;
4. reject ambiguous or unsupported requests before plan creation;
5. build one immutable plan rooted at the effective repository root;
6. invoke the stale-safe apply engine once for all local physical targets;
7. project the one apply result back to per-package internal outcomes and human/JSON summaries;
8. run post-write manager, install, execute, or verification phases only when their existing
   authorities and the complete preceding result allow them.

The command preserves deterministic source and operation order. A physical catalog entry is one
operation owned by its catalog source, not duplicated for each consumer.

### Command-level preflight and apply

The existing apply engine already validates all plan target groups before acquiring the write
lock and replacing files. The 2.1.0 check path must use that property by supplying all selected
targets in the single plan.

The run has one repository-local lock, one journal identity, and one recovery result. Before the
first replacement it confirms every target's:

- containment and regular-file identity;
- source bytes and expected values;
- parseability and formatting contract;
- exact VCS target state;
- absence of conflicting recovery evidence;
- required invocation authority.

The engine rechecks the relevant identity and staleness conditions before each rename, as it does
today. A failure discovered before the first replacement marks every not-executed operation as
blocked or unknown and guarantees the receipt `No files were changed`. A failure after replacement
begins enters observation or recovery and may never use that sentence unless final observation
proves every target has its original bytes.

### Honest atomicity and recovery

The product language is exact:

- each target replacement is atomic;
- the command preflights all targets before any replacement;
- the command is not an atomic repository transaction;
- recovery across physical files is best effort;
- incomplete or unobservable recovery is partial or unknown, never success.

The final run model retains the journal ID, restored paths, unrecovered paths, and known external
effects whenever the apply result provides them. Recovery guidance names the journal or command
supported by the implementation; it never suggests rerunning blindly.

## Visual+ v2 human interface

Visual+ v2 is the default human table experience for both read-only checks and writes. It is an
inline renderer with stable scrollback. It may temporarily redraw only its small live lifecycle
region; dependency rows and final receipts are written durably once.

### Information hierarchy

The capable-TTY write journey uses these sections in order:

1. **Run header** — command mode, repository name/path, workspace scope, package manager evidence,
   and write intent.
2. **Lifecycle rail** — discover, inspect, resolve, review, preflight, apply, observe, and
   complete.
3. **Repository topology** — a count flow such as
   `66 packages -> 616 declared -> 612 eligible -> 76 updates -> 14 files`.
4. **Update distribution** — major, minor, and patch counts with proportional bars and numeric
   labels; color is supplementary only.
5. **Risk focus** — every major update and compatibility uncertainty, with exact owner and age.
6. **Package impact map** — selected updates grouped by physical owner, making multi-file blast
   radius visible before a write.
7. **Shared surface map** — dependencies declared in more than one owner, with all physical
   occurrences and the single catalog owner where applicable.
8. **Complete change list** — every selected dependency row exactly once, grouped by owner.
9. **Apply transaction** — every physical target and its current phase/result.
10. **Final receipt** — plain-language verdict, exact totals, elapsed time, exit code, and one
    safe next action when action is needed.

For the approved Spreadu preview, the renderer shows all 76 selected rows across 15 owner groups,
all 14 physical targets, the 18 repeated dependency names and their 39 physical occurrences, and
both major-update blast-radius cards. No row or target may be replaced by an ellipsis or a summary
count. Large outputs remain long by design, but hierarchy makes the result scannable and every fact
remains copyable.

### Functional "wow" elements

Visual interest comes from relationships and state, not decoration:

- the topology rail connects scope to the exact number of mutations;
- the distribution bar makes update severity visible at a glance;
- the package impact map reveals where changes land physically;
- the shared surface map reveals declarations that can drift together;
- major blast-radius cards connect one upgrade to all affected owners and known runtime evidence;
- the transaction target grid changes from pending through observed final state;
- the final receipt visually resolves the entire lifecycle into success or a safety block.

Every graphic has a text and numeric representation. No meaning depends on color, animation,
Unicode box drawing, terminal width, or a graphics protocol.

### Complete row contract

Each change row exposes the information needed to review the operation:

```text
dependency  current -> target  diff  age  compatibility
```

The owner header gives the repository-relative physical file. Catalog rows identify the catalog
name and source. Repeated declarations are cross-referenced to the shared surface map. Unknown
compatibility is written as `unknown` in narrow/plain modes; unexplained tokens such as `?node`
may appear only when a visible legend on the same screen defines them.

Rows use sanitized terminal text and visual-width measurement. Package names, paths, registry
metadata, control sequences, bidirectional controls, zero-width formatting characters, and wide
graphemes cannot escape the layout or inject terminal behavior.

### Success receipt

A successful write ends with a stable receipt equivalent to:

```text
Complete · 76 updates applied across 14 files
Applied 76  Blocked 0  Not attempted 0  Failed 0  Unknown 0
All 14 target files were observed at the requested values. Recovery was not needed.
Exit 0
```

The exact nouns pluralize correctly. `Complete` is reserved for an observed result that satisfies
the current success contract.

### Safety-block receipt

A command-level preflight block before any replacement ends with a stable receipt equivalent to:

```text
Safety block · no files were changed
Applied 0  Blocked 76  Not attempted 76  Failed 0  Unknown 76
Preflight could not confirm Git state for package.json.
Reason: Git evidence exceeded the safe output boundary (VCS_OUTPUT_LIMIT_EXCEEDED)
Fix the Git evidence problem, then rerun the same command. Exit 2.
```

`Blocked` describes the policy/phase decision. `Not attempted` says mutation did not start.
`Unknown` describes the unconfirmed evidence/final outcome. These dimensions are not collapsed.

If any replacement occurred, the headline instead says `Partial result` or `Recovery incomplete`,
lists applied/restored/unrecovered physical files, and never says `no files were changed` without
byte-level final observation.

## Capability and fallback matrix

The same run model supplies every mode. Fallback means reduced presentation, not reduced truth.

| Environment | Presentation | Motion | Completeness |
| --- | --- | --- | --- |
| TTY, color, wide | Full hierarchy and maps | Active phase only | Complete |
| TTY with `NO_COLOR` | Same hierarchy, no color meaning | Monochrome phase | Complete |
| Reduced motion | Same hierarchy | State changes only | Complete |
| Narrow TTY | Stacked sections and wrapped details | Safe active phase only | Complete |
| `TERM=dumb` | Plain ASCII sequential output | None | Complete |
| Non-TTY, CI, or pipe | Durable sequential text | None | Complete plain text |
| `--output json` | Existing machine envelope and contracts | None | Contract-defined |
| Silent/library | Existing behavior and callbacks | None | No unsolicited output |

The renderer chooses capability once at startup and has one cursor owner. It never emits repeated
animation frames into a pipe or pasted transcript. Resizing a capable TTY changes future live
frames; already durable output is never erased or rewritten.

Width behavior is verified at 40, 60, 80, and 118 columns plus the current extremely narrow
8/10-column safety cases. At narrow widths, content moves to additional lines instead of being
silently truncated. Decorative rules disappear before semantic labels or values.

## Motion contract

- Produce visible feedback within 100 ms when work continues asynchronously.
- Animate only the active phase, using one restrained indicator or progress fill.
- Stop timers before durable output, process completion, thrown errors, signals, or renderer
  teardown.
- Resolve a phase to one stable line; never leave a spinner in scrollback.
- Do not animate dependency-row entrance, keyboard navigation, focus, selection, help, or copy.
- Do not delay success or error output to finish an animation.
- Disable periodic redraw for non-TTY, CI, pipes, `TERM=dumb`, and reduced motion.

## Result and exit semantics

Human output derives from the apply phases and operation results rather than string matching.

- `applied`: requested value was observed after replacement.
- `blocked`: a known precondition or authority prevented mutation.
- `not attempted`: replacement did not start for this operation.
- `failed`: a known operation failed and final state is known.
- `reverted`: original value was observed after recovery.
- `unknown`: required evidence or final state could not be confirmed.

The final receipt always exposes applied, blocked, not-attempted, failed, and unknown totals;
reverted appears whenever non-zero or recovery ran. Counts reconcile to the selected operation
and physical-target inventories. Grouped human diagnostics retain exact operation details under
their physical cause without printing the same warning repeatedly.

Legacy check exit behavior remains:

- `0` for a complete check/write result without a blocking failure;
- optional `1` for outdated dependencies under `--fail-on-outdated` without writing;
- `2` for configuration/error paths, failed required resolution, safety block, incomplete write,
  incomplete recovery, or unknown write state.

Normal CLI completion sets `process.exitCode` and returns so large piped output drains completely.
Immediate process exit remains reserved for signal termination.

## Integration boundaries

- Addons keep deterministic package lifecycle order. `beforePackageWrite` participates in global
  collection. After the single apply, each accepted package receives its existing selected-change
  argument in `afterPackageWrite`, then `afterPackageEnd`; internal write-result hooks receive the
  matching projected operation outcomes. Packages rejected by `beforePackageWrite` retain the
  current rule that `afterPackageWrite` is not called.
- Interactive selection supplies the same global selected-operation set. It does not own the
  apply loop.
- Global package-manager updates retain their separate global state machine and explicit global,
  process, and manager authority. They are not mixed into the local file transaction claim.
- JSON output keeps its existing envelope and schema version, with the documented additive
  `VCS_UNAVAILABLE` write-outcome reason. Any other renderer-only model stays internal unless a
  separately versioned machine-contract design is approved.
- Existing formatting preservation, catalog ownership, stale checks, journal containment, and
  unknown-on-ambiguity rules remain mandatory.

## Verification strategy

### Correctness tests

- Unit tests for exact-target Git classification and `VCS_OUTPUT_LIMIT_EXCEEDED`.
- A generated Git fixture whose complete tracked index exceeds the old default buffer while the
  exact target query remains bounded.
- Injection/containment cases for hostile path bytes and Git-like pathspec syntax.
- Compatibility tests proving `VCS_UNAVAILABLE` is never rewritten to `WRITE_FAILED`.
- A multi-package fixture in which a late target fails preflight; assert every manifest is
  byte-identical and the receipt says no files changed.
- Staleness injected before the first replacement and between target renames.
- Observation failure, completed recovery, partial recovery, unknown recovery, and retained
  journal evidence.
- Catalog ownership and repeated-consumer reconciliation.
- Callback ordering and exactly-once outcome projection.

### Terminal journey tests

Run the built CLI through a real PTY for:

- read-only complete output;
- successful 14-target write;
- preflight safety block before replacement;
- partial apply followed by completed recovery;
- incomplete/unknown recovery;
- resolution failure combined with available updates;
- interruption and terminal cleanup.

Snapshots cover 40, 60, 80, and 118 columns, color and `NO_COLOR`, Unicode and hostile terminal
text, reduced motion, `TERM=dumb`, non-TTY, CI, and a pipe with slow consumption. Tests assert no
horizontal overflow, no orphaned cursor state, no repeated live frames in durable output, all
selected rows exactly once, all physical targets exactly once, reconciled totals, exact exit code,
and final filesystem bytes.

### Spreadu-shaped acceptance fixture

The deterministic acceptance fixture preserves the incident's relevant scale and relationships:

- 66 packages;
- 616 declared dependencies;
- 612 eligible dependencies;
- 76 selected updates across 15 owner groups;
- 14 physical target files;
- 18 repeated dependency names across 39 physical occurrences;
- 2 major-update blast-radius cards;
- a root Git index larger than the former synchronous buffer boundary.

The success and safety-block previews must both render the complete 76 rows correctly. The safety
case proves zero changed target bytes; the success case proves all 14 target files and all 76
requested values were observed.

## Documentation and rollout

`2.0.2` documents the exact Git evidence defect, grouped safety-block language, remaining
package-by-package limitation, exit code `2`, and safe recovery guidance for partial 2.0.x runs.

`2.1.0` updates the README, table-output guide, troubleshooting guide, CLI capability description,
and release notes with:

- the command-level preflight guarantee and per-file atomicity boundary;
- success, safety-block, partial, and recovery-incomplete examples;
- full Visual+ v2 capable and fallback examples;
- the meaning of every result state and exit code;
- the distinction between plain `-w`, interactive selection, JSON, and global writes.

Rollout is complete only after the built and packed CLI pass the same PTY and filesystem journeys.
Local proof is not public release proof; publishing needs the repository's separate immutable-tag
release workflow and hosted/public artifact verification.

## Acceptance criteria

The design is implemented when all of the following are true:

1. A large Git index cannot block a small exact target set merely by exceeding the old buffer.
2. No VCS preflight reason is exposed as generic `WRITE_FAILED`.
3. Normal local `-w` creates one plan and invokes one apply lifecycle for every selected local
   physical target.
4. Every target is preflighted before the first replacement.
5. Known preflight failure before replacement leaves all targets byte-identical and says so.
6. Partial or unknown final state is never rendered as complete or safe-to-rerun without guidance.
7. Visual+ v2 renders the complete change list, relationship maps, target transaction, and final
   receipt without horizontal overflow or terminal-control injection.
8. Capable, narrow, colorless, dumb, CI, pipe, JSON, and library modes retain their stated truth.
9. Motion is limited to active asynchronous state and leaves stable scrollback.
10. Focused tests, full tests with coverage, typecheck, lint, build, packed verification, PTY
    journeys, and Git-immutability checks pass.

## Stop conditions

Implementation stops for a new design decision rather than silently weakening the contract if:

- global collection cannot preserve current addon or interactive-selection semantics;
- a schema change is required for existing JSON, plan, or apply v1/v2 consumers;
- exact-target Git evidence cannot retain every currently supported target state;
- the one-plan path would bypass existing invocation authority or recovery protections;
- the complete Visual+ output cannot remain readable and safe at the required terminal widths;
- new runtime or native dependencies become necessary;
- unrelated work overlaps the files owned by an implementation plan.

## Locked decisions

- Ship the VCS/reason hotfix as `2.0.2`; do not wait for the renderer redesign.
- Ship command-level apply and Visual+ v2 together as `2.1.0`.
- Visual+ v2 is the primary default human terminal interface.
- The output is inline, complete, copyable, and stable in scrollback.
- All selected rows and all physical targets are shown; summaries do not replace details.
- Functional visualizations and restrained lifecycle motion provide the "wow" effect.
- Non-TTY and constrained terminals receive the same truth without animation or cursor control.
- Full-screen Focus TUI/OpenTUI is not part of this design.
