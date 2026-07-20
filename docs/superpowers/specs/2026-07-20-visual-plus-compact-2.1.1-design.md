# Visual+ Compact Output and 2.1.1 Design

**Date:** 2026-07-20

> **Historical compact semantic contract:** This historical compact semantic contract records the Plan 037 contract completed
> for the prior default projection. Its default visual composition is superseded by the in-progress
> [Plan 038 hybrid default](../../../plans/038-visual-plus-hybrid-default.md); safe-write,
> recovery, compatibility-route, and exhaustive `--long` decisions remain in force.

## Problem

Visual+ 2.1.0 correctly selects the capable-terminal path, but its default durable review is an
exhaustive audit transcript. A real Spreadoo read-only run with 87 updates produced about 725
lines. Internal operation, owner, and dependency IDs dominate the output, repeated relationship
maps duplicate information, and equal-width columns wrap each operation ID. The same run also
prints `Repository unknown` and `Package manager unknown` because startup metadata is never
enriched after discovery.

The result is complete but not usable as the default terminal experience.

## Product Contract

### Default compact view

`depfresh <mode>` and `depfresh <mode> --write` use a compact Visual+ review by default.

- Keep the check header, lifecycle truth, repository topology, severity distribution, major-risk
  cards, final exit, and write/recovery truth.
- Show bounded owner, shared-dependency, and update previews. Each preview has a deterministic
  limit and an explicit omitted-count line.
- Do not show internal operation, owner, dependency, or source-file IDs.
- Do not repeat operation IDs in target receipts.
- Keep every emitted line within the startup terminal width.
- End nonempty compact reviews with an exact hint: rerun with `--long` for the complete audit.
- Preserve complete blocking, failed, unknown, recovery, and exact affected-target evidence. A
  line budget never hides a safety-relevant non-success result.

The normal successful Spreadoo-shaped read-only journey must remain bounded to 80 durable lines at
40, 60, 80, 118, and typical wide terminal widths. This limit includes lifecycle and final receipt
output but excludes transient cursor-owned frames.

### Full audit view

`depfresh <mode> --long` retains the 2.1.0 exhaustive Visual+ audit semantics:

- every selected change;
- every owner impact entry;
- every shared physical occurrence;
- every physical target and operation membership;
- stable append-only fallback behavior in pipes, CI, and `TERM=dumb`.

`--long` may include stable internal IDs because it is an explicitly requested audit view. JSON,
interactive, global, silent, veto-capable, and public library routes remain unchanged.

### Interactive write view

`--write --interactive` continues to use the existing full-screen selection TUI. This change does
not make read-only commands interactive and does not grant write authority.

## Repository Context

Visual+ starts early enough to own discovery progress, so it cannot truthfully invent repository
metadata at startup. The renderer therefore separates the initial check heading from discovered
context:

1. `start()` writes only facts known before discovery.
2. After package discovery, the command derives repository name, effective-root-relative path,
   workspace scope, and package-manager evidence from the already loaded package inventory and
   contained root markers.
3. `setRunMetadata()` accepts that context exactly once before review, validates it, writes it
   durably, and makes it authoritative for review/finalization.

Package-manager evidence is fail-closed:

- one coherent declared manager or one unambiguous contained lockfile marker is `observed`;
- contradictory manager declarations or markers are `ambiguous`;
- unreadable candidate sources are `unavailable`;
- absence of evidence is `unknown` and is rendered only after discovery, never as a startup
  placeholder.

The command executes no manager, Git, registry, or lifecycle process to build display metadata.

## Rendering Architecture

Add an immutable detail level (`compact | full`) to Visual+ run metadata. The CLI maps `--long` to
`full`; all other eligible Visual+ invocations use `compact`.

Pure compact renderers consume the same validated `VisualPlusInsights` and authoritative snapshot
as the full renderers. They do not reconstruct identities or mutate selection. Compact selection
is deterministic:

- major-risk cards: all cards, because major risk must not be hidden;
- owner impact: first 5 by update count descending, then canonical owner order;
- shared dependencies: first 5 by occurrence count descending, then canonical dependency order;
- update preview: first 8 by `major`, `minor`, `patch`, then canonical owner/name/operation order;
- successful/read-only target summary: first 8 targets by canonical target order;
- non-success targets: all affected targets, regardless of limit.

Full renderers remain the source of exhaustive semantics. Shared helpers own omitted-count text,
sorting, sanitization, wrapping, and target outcome formatting.

## Errors and Safety

- Renderer state rejects review before discovered context and rejects a second conflicting context.
- A renderer or context-contract failure remains exit 2 and never falls back to misleading output.
- Compact mode never converts unknown, blocked, failed, conflicted, reverted, or incomplete recovery
  into success.
- Pipes and CI receive the same compact semantics without cursor control; `--long` receives the
  same complete semantics without cursor control.
- Hostile repository names, dependency names, versions, paths, and manager evidence remain
  sanitized before width calculation or output.

## Documentation and 2.1.1 Candidate

Document the compact/default and `--long` audit journeys in the CLI help, table-output guide,
README, changelog, and a dedicated `docs/releases/v2.1.1.md` candidate note.

After all implementation, source, PTY, coverage, lint, typecheck, build, package, and distribution
tests pass under the pinned Node `24.15.0`, npm `11.12.1`, and pnpm `10.33.0` toolchain:

- bump `package.json` and maintained current-version surfaces from `2.1.0` to `2.1.1` while
  leaving the versionless root `pnpm-lock.yaml` unchanged;
- preserve historical 2.1.0 release evidence unchanged;
- build and pack one local `depfresh-2.1.1.tgz` candidate;
- install that exact local candidate into Bun's global package directory so ordinary
  `bunx depfresh --version` resolves `2.1.1` on this machine;
- run a true-PTY Spreadoo read-only smoke and prove compact output, correct repository/manager
  metadata, exit 0, and unchanged repository bytes.

Do not publish to npm, push, create or move a tag, create a GitHub release, or claim hosted/public
proof without separate explicit authority and fresh external evidence.

## Verification

Verification layers are independent:

1. RED/GREEN pure section and renderer tests for compact limits, ordering, omitted counts, full
   parity, width containment, hostile text, and safety overrides.
2. Command orchestration tests for one-time discovered metadata and unchanged excluded routes.
3. True-PTY and direct-pipe tests for compact default, `--long` completeness, terminal controls,
   line budgets, exact exits, and unchanged fixture bytes.
4. Full test suite with coverage, lint, zero-warning Biome, typecheck, build, package verifier,
   practical smoke, WUN demo, release readiness, and distribution smoke. The historical
   declaration-stability baseline is not rewritten as a side effect of this patch release.
5. Local packed-artifact installation and a final Spreadoo smoke from outside this checkout.
