# Visual+ Hybrid Default Design

**Status:** Approved in conversation on 2026-07-20; implementation owned by Plan 038.

## Problem

The current eligible default CLI route is truthful, bounded, and terminal-safe, but its completed
output is a flat audit transcript. It replaced the scan-friendly v1.x dependency table with a
lifecycle rail, text summaries, bounded previews, and omitted-count lines. The result satisfies the
Plan 037 semantic contract without satisfying the product expectation that Visual+ be a visually
clear human interface.

This is a specification and acceptance gap. The current tests prove semantic completeness of the
chosen projection, line budgets, terminal cleanup, fallbacks, and exact write evidence. They do not
prove visual hierarchy or scanability. The existing table documentation also still describes the
default as a colorful table even though the eligible Visual+ route suppresses that table.

## Goal

Make ordinary eligible commands such as `depfresh major` feel like an improved v1.x interface:
show a compact truthful context header, a useful severity overview, focused major-risk information,
and one complete scan-friendly update ledger. Keep current safety and audit truth, but move technical
detail out of the default successful journey.

The result remains inline, copyable, and stable in scrollback. It is not a full-screen application.

## Non-goals

- Do not introduce OpenTUI, React, Solid, Zig, or another runtime/native dependency.
- Do not make the read-only default keyboard-driven or full-screen.
- Do not change JSON, silent, library, global, explicit interactive, or veto-capable routes.
- Do not weaken stale-safe apply, recovery, exact target evidence, exit codes, or sanitization.
- Do not publish, tag, push, or create a public 2.1.1 artifact as part of this work.
- Do not redesign the explicit `--interactive --write` selection TUI.

## Product decisions

### Default capable-terminal journey

An eligible local noninteractive table command uses the hybrid view. Its final durable output has
five ordered regions:

1. **Context** — repository name/path, workspace scope, package manager, command mode, and
   read-only/write intent.
2. **Overview** — package/declaration/update/target counts plus a proportional severity bar with
   redundant `Major`, `Minor`, and `Patch` numbers.
3. **Risk focus** — every major update, grouped by dependency identity, with current/target range,
   release age, and affected owners. Unknown compatibility stays explicitly unknown; it never
   becomes a pass.
4. **Update ledger** — every selected update exactly once in a scan-friendly table or responsive
   labeled-row form.
5. **Receipt** — one concise truthful result and exit statement. Write failures, safety blocks, and
   recovery outcomes retain the complete existing evidence required to act safely.

No successful default journey ends with a durable ten-phase lifecycle rail, bounded owner/shared
maps, an eight-item update preview, or a physical-target preview. Those are audit views, not the
primary working surface.

### Update ledger

The ledger restores the useful v1.x information architecture without reverting command truth:

- every canonical selected operation in `snapshot.changes` appears exactly once; repeated consumers
  or logical occurrences never create duplicate ledger rows and remain available under `--long`;
- rows honor the existing `--sort` semantics inside deterministic physical-owner groups;
- each row exposes dependency name, current range, target range, severity, and release age;
- a group heading identifies the owning package/catalog and physical target when the display label
  alone would be ambiguous;
- incompatible, explicitly unknown compatibility, and catalog-owned states appear as short semantic
  badges or continuation text using only current immutable selection evidence;
- ordinary unknown evidence does not repeat a long warning on every row;
- semantic values are sanitized and never truncated into ambiguity.

Existing display options remain meaningful on the hybrid route. Physical-owner grouping is always
retained so monorepo membership stays clear. Within each owner, `--group` controls dependency-source
subgroups versus a flat source column, `--sort` controls update ordering, `--timediff` controls age,
and `--nodecompat` controls compatibility detail. Any required display order or option state must
be projected explicitly from resolved command input; the renderer must not derive it from labels,
internal IDs, or incidental array order.

The current `sortDeps()` implementation is authoritative. In particular, `diff-asc` means Major,
Minor, then Patch, while `diff-desc` means Patch, Minor, then Major; documentation that says the
opposite is corrected with this work. The integration projects an explicit stable display order
from the resolved changes and selected operation mapping, then uses owner order and code-unit
identity only as deterministic tie-breakers. The renderer does not recreate time or locale sorting
from display strings.

The default may be longer than 80 lines when the repository has many updates. Density is bounded by
meaning instead of an arbitrary transcript cap: one ledger row per selected update, at most one
owner heading per represented owner, at most one heading per represented dependency source inside
that owner, all major-risk groups, constant overview chrome, and the exact receipt. No relationship
map or preview duplicates ledger membership.

### Responsive layouts

- **Wide (`>=100`)** — aligned columns for dependency, current, target, severity, and age. The owner
  is a stable group heading so long workspace paths do not consume every row.
- **Medium (`60..99`)** — aligned dependency and `current -> target` columns plus severity and age;
  exceptional evidence uses one continuation line.
- **Narrow (`<60`)** — one dependency header followed by a labeled version/severity line. Values
  wrap losslessly at grapheme boundaries.
- **Plain fallback** — the same semantic regions and complete ledger without ANSI, cursor control,
  or repeated frames. Geometry still follows the normalized width thresholds above; `plain`
  controls styling/motion rather than forcing one geometry. `TERM=dumb` uses ASCII tokens; pipes
  and CI remain deterministic.

Color is redundant: red/`Major`, yellow/`Minor`, and green/`Patch` always retain a textual or symbol
label. `NO_COLOR` changes styling only.

### Lifecycle behavior

In a capable TTY, lifecycle is one replaceable live line while work is active. It shows the current
authoritative phase; when that phase exposes authoritative progress counts it appends them, and
otherwise it shows no invented progress. It must not accumulate completed phases in scrollback.

On successful finalization the live region is cleared and replaced by the five durable regions
above. On failure, the final output names the failed or blocked phase only when that fact is
authoritative, then renders the complete existing diagnostic, target, recovery, and exit evidence.

When a modeled non-success occurs after a valid selection, context, overview, risk focus, and the
ledger remain the durable review, followed by every required non-success target/recovery fact and
the canonical receipt. An unexpected orchestration error without valid final modeled evidence keeps
the current fail-closed behavior: dispose the renderer, restore the cursor, and emit the sanitized
generic error only. It never fabricates a hybrid ledger, phase result, target result, or receipt.

Plain/constrained modes do not simulate animation by appending phase transitions. They wait for
durable facts and emit the final semantic output once, except for already-required durable errors
that must be reported when observed.

### `--long`

`--long` retains the current exhaustive Visual+ audit contract: lifecycle, complete operations,
owners, shared dependencies, occurrences, physical targets, and exact receipts. It is the technical
inspection surface and remains stable for users and packaged replay tests.

The hybrid default and exhaustive `--long` output share the same immutable run snapshot and receipt
evidence. They differ only in projection; neither reconstructs truth from display text.

### Compact receipts

A successful read-only review ends with exactly the semantic equivalent of:

```text
Review complete · 87 updates across 20 files · write not attempted
Exit 0
```

A strict successful write, where every operation and target is observed applied and recovery is not
needed, ends with exactly the semantic equivalent of:

```text
Complete · 87 updates applied across 20 files
All 20 files observed at the requested values · recovery not needed · 2.4s
Exit 0
```

Counts and duration come from the authoritative snapshot. Any skipped, blocked, failed, unknown,
partial, restored, unrecovered, retained-journal, nonzero-exit, or otherwise non-strict outcome uses
the complete existing receipt and target/recovery evidence rather than concise success copy.

### Compatibility routes

The existing eligibility predicate remains the route boundary. JSON, silent, direct library,
global/global-all, explicit interactive selection, and direct/addon veto-capable invocations retain
their current behavior. The legacy table remains an internal compatibility renderer; the hybrid
view reuses its proven formatting concepts but does not change excluded-route bytes accidentally.

## Reference composition

At a wide terminal, the successful read-only shape is:

```text
spreadu · bun workspace · major · read-only
66 packages · 619 declared · 615 eligible · 87 updates · 20 files

Major 3   Minor 43   Patch 41
███       ███████████████████████████████████████████

Breaking changes
react-dropzone  ^15.0.0 → ^19.1.1  ~0d  lab-editor, web  compat unknown
nanoid          ^5.1.16 → ^6.0.0   ~8d  default          compat unknown

web · apps/web/package.json
dependency                 current       target        severity  age
────────────────────────────────────────────────────────────────────
react-dropzone             ^15.0.0   →   ^19.1.1      Major     ~0d
posthog-js                  ^1.300.0  →   ^1.302.0     Minor     ~1d

… every remaining selected update exactly once …

Review complete · 87 updates across 20 files · write not attempted
Exit 0
```

Exact glyphs, spacing, and proportional bar allocation are implementation-plan decisions backed by
golden tests. The hierarchy and information membership above are fixed product requirements.

## Architecture

The current command controller, selection projection, run metadata, insight builder, and canonical
receipt remain authoritative. The change is isolated to renderer projection and lifecycle ownership:

- replace the current default compact section with pure hybrid context/overview/risk/ledger
  sections;
- retain current full sections for `detailLevel: 'full'`;
- make live lifecycle rendering detail-level aware so compact capable runs own one transient region;
- make constrained compact runs emit no append-only lifecycle history;
- reuse current visual-width, sanitization, sorting, version-coloring, wrapping, and theme helpers;
- preserve one renderer as the only cursor/timer owner.

Pure sections receive immutable validated input and return `readonly string[]`. They perform no I/O,
clock reads, registry access, repository reads, or identity inference.

## Error handling and safety

- Invalid or contradictory renderer evidence still fails closed with exit `2` and no success copy.
- Renderer write/timer/reentrancy failures preserve the first error and restore the cursor.
- A compact projection failure must not fall back to a misleading success table.
- Every non-success physical target and every recovery path required by the current receipt contract
  remains visible regardless of layout or output density.
- A successful read-only footer says write was not attempted; it does not claim repository
  immutability, apply, or verification.
- Pipe backpressure and normal `process.exitCode` behavior remain unchanged.

## Acceptance strategy

Acceptance must test visual composition as well as semantics.

### Pure golden coverage

Geometry goldens cover the hybrid default at 40, 60, 80, and 118 columns for a Unicode/color-capable
TTY and for capable-geometry plain direct/`TERM=dumb` fallbacks. Representative-width `NO_COLOR`
and ASCII/style goldens separately prove that styling and glyph capabilities do not change semantic
membership. The goldens assert exact section order, table grouping, severity bar, wrapping, styling
boundaries, and absence of the durable lifecycle rail and audit previews without multiplying every
style toggle across every width.

A deliberately small canonical fixture with 6–8 representative rows supplies reviewable exact
goldens at every width. The existing 76-operation Spreadu-shaped fixture separately proves complete
membership, ordering, duplicate-label separation, owner/target relationships, and line fitting.
Acceptance cannot normalize away whitespace or rely only on substring presence.

### Membership and safety invariants

- every selected operation appears exactly once in the ledger;
- every major operation appears in the ledger and every major dependency group appears once in risk
  focus;
- no operation/owner/dependency/source internal ID is rendered;
- no semantic value is lost after ANSI stripping and responsive wrapping;
- non-success targets and recovery paths are never limited;
- the current `--long` exhaustive membership contract remains unchanged.

### Built CLI and PTY proof

The retained Spreadu-shaped fixture proves capable PTY output at 40/60/80/118 columns, plain direct
pipe, slow pipe, CI, `TERM=dumb`, `NO_COLOR`, reduced motion, resize boundaries where supported,
cursor restoration, and source/packed artifact identity. Capable PTY and plain direct/`TERM=dumb`
journeys at all four widths assert non-whitespace-normalized final-screen goldens or fixed layout
signatures in addition to raw terminal controls and semantic membership.

The installed-package replay executes these same new golden journeys against the CLI loaded from the
installed tarball, never the source CLI. Replay test/suite totals, trusted failure-title
classification, verifier fixtures, and package-asset assertions change atomically so a
visual-hierarchy regression cannot become an unclassified or silently skipped installed-artifact
failure.

### Live acceptance

The locally installed candidate runs literal `bunx depfresh major` in the current Spreadoo checkout
under a true PTY. Acceptance requires:

- the approved five-region visual hierarchy;
- the operation count captured from that run's authoritative result represented exactly once (`87`
  was historical design-time context, not a fixed live expectation);
- no durable lifecycle rail or audit-preview lists;
- the locally installed Bun executable version and CLI hash match the retained tarball, while the
  rendered project package-manager name/version/sources independently match discovered repository
  evidence;
- exit `0`, visible cursor, and unchanged HEAD, index, status, diffs, and `bun.lock`;
- `bunx depfresh major --long` still exposes the exhaustive audit.

Static gates, full tests, package verification, installed-product replay, and exact Bun CLI hash must
pass before replacing the current local candidate.

## Documentation and status truth

The implementation must:

- mark the 2026-07-18 design as amended by this design for the default successful projection;
- describe Plan 037 as complete for its compact semantic contract while noting that this follow-up
  resolves the visual-composition objective;
- update table/output/release documentation to match the actual hybrid default;
- create a new Plan 038 and close it only after live Spreadoo visual acceptance;
- record the prior 2.1.1 tarball and Bun installation as superseded local evidence if package bytes
  change.

## Release boundary

The package remains an unpublished local `2.1.1` candidate unless the user separately requests a
version or publication change. A corrected tarball may replace the local Bun installation only
after all source, packed, and live gates pass. No npm publication, Git tag, push, hosted workflow,
GitHub release, or public-artifact claim is authorized.
