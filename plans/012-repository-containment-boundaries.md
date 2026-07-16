# Plan 012: Repository containment and nested workspace boundaries

## Contract

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: 011
- **Planned at**: `8eea9c5` plus completed plan 009, 2026-07-15
- **Status**: DONE

## Objective

Establish one canonical repository root and guarantee that discovery, catalogs, includes, symlinks,
and later writes cannot escape it. Detect nested workspace roots and exclude their descendants from
mutation by default while still reporting them diagnostically.

## Owned files

- `src/io/packages/discovery.ts`, `src/io/packages/workspace-discovery.ts`
- root/package-manager discovery helpers used by those modules
- catalog path resolution only where needed to enforce containment
- new pure canonical-path/containment helpers and focused fixtures
- discovery documentation and `CHANGELOG.md`

Dependency resolution, policy selection, writes, and repository-model serialization are out of
scope.

## Required semantics

- Canonicalize root and candidate paths using real filesystem identity where available.
- A candidate must be inside the root by path component, not string prefix.
- Reject `..`, absolute external paths, symlink escapes, and catalog files outside the root.
- Detect nested repository/workspace roots by marker evidence. Report the boundary and skip its
  descendants for mutation unless a future explicit option targets that nested root separately.
- Read-only discovery may report blocked/external candidates without reading secrets from them.
- Case behavior must follow the host filesystem and remain deterministic in serialized paths.

## Implementation tasks

1. Add adversarial fixtures for prefix collisions, `..`, absolute globs, symlinked packages,
   symlinked catalogs, missing paths, nested workspaces, and root invocation from a descendant.
2. Create a pure canonical containment API returning allowed/blocked plus stable reason codes.
3. Resolve the effective root once and require all discovery/catalog paths to pass the helper.
4. Add nested-root detection and prune mutation candidates while preserving diagnostic entries.
5. Ensure excluded nested descendants cannot re-enter through recursive globs, catalog consumers,
   includes, or duplicate path spellings.
6. Document canonical root selection, ambiguity, symlink policy, and nested-workspace behavior.

## Acceptance evidence

- every adversarial escape is blocked with a stable reason;
- valid in-root symlinks and ordinary workspaces keep working;
- nested roots are visible but not mutable by default;
- no filesystem read/write target escapes the canonical root in the focused harness;
- focused discovery tests and all repository gates pass.

## STOP conditions

Stop if the same physical file can receive two canonical identities, root evidence is ambiguous, or
an existing supported workspace format requires crossing the selected root. Report the ambiguity;
do not guess.

## Completion record

Implementation completed on 2026-07-15 without changing package version `1.2.0`:

- Added one containment contract for repository paths. It rejects explicit parent components,
  checks lexical containment by path component, resolves the root and candidate through the host
  filesystem, rejects physical symlink escapes, and returns the canonical real path for every
  allowed identity. Missing roots, missing candidates, traversal, outside-root paths, symlink
  escapes, and duplicate identities have stable diagnostic reasons.
- Root detection now canonicalises descendant and symlinked invocations to one physical root.
  Workspace patterns reject absolute and parent-traversal forms before globbing. Matched manifests
  pass containment before parsing, and in-root symlink spellings deduplicate to one package and one
  future write target.
- Catalog discovery for pnpm, Bun, and Yarn stops at the selected root and validates candidates
  before parsing. Package-manager detection used by install/update does the same for manifests and
  lockfiles, so a parent marker or external symlink cannot choose a command or receive a write.
- Nested boundaries recognise contained `pnpm-workspace.yaml`, `.yarnrc.yml`, manifest
  `workspaces`, and `.git` evidence. Read-only discovery can keep a nested root visible while
  filtering descendants; write discovery excludes both the nested root and descendants regardless
  of the broad read-only option.
- Adversarial fixtures cover path-prefix collisions, legitimate dot-prefixed components, explicit
  `..`, POSIX and Windows-style absolute patterns, missing paths, external and in-root package
  symlinks, duplicate physical manifests, symlinked root invocation, external workspace markers,
  external and in-root catalogs, nested write candidates, parent lockfiles, and external
  package-manager manifests and lockfiles.

Passing evidence:

- `pnpm typecheck` — passed.
- `pnpm lint` — passed, 210 files checked.
- focused containment and workspace suite — 12 files, 95 tests passed.
- `pnpm test:run` — 102 files, 984 tests passed.
- `pnpm build` — passed.
- `pnpm test:smoke` — passed, 26 checks and 52 registry requests.
- exact Node 24.15.0 focused suite — 12 files, 116 tests passed.
- exact Node 24.15.0 built CLI — reported `1.2.0`; library import passed.
- dist inspection and `npm pack --dry-run --json` — passed; 23 files, both entry points present,
  `node:sqlite` remains a builtin import, and `better-sqlite3` is absent.
- `git diff --check` — passed.

Final verification replay completed on 2026-07-16 without changing package version `1.2.0`:

- `pnpm install --frozen-lockfile` passed under isolated home, cache, and pnpm-store directories;
  pnpm reported that the lockfile was up to date, closing the former external blocker.
- Independent review found two duplicate-identity regressions introduced across the original and
  later repository-model paths. One physical catalog file could be claimed as both pnpm and Yarn,
  and manifest symlink spellings could produce duplicate repository source IDs. Retained RED tests
  reproduced both failures. Ambiguous cross-manager catalog aliases are now excluded with
  `catalog:DUPLICATE_IDENTITY`, while legitimate named catalogs remain distinct; repository source
  assembly deduplicates canonical physical paths before entities are emitted.
- The focused two-file regression suite passed 21 tests, and independent re-review returned
  `APPROVED` with no findings.
- `pnpm typecheck`, `pnpm lint`, and strict warning-as-error Biome checks passed; Biome checked 225
  files with no warnings or fixes.
- The expanded 23-file containment, package, catalog, repository-model, evidence, and VCS suite
  passed 255 tests in each of three consecutive runs. The same 255 tests passed on exact Node
  `24.15.0`.
- `pnpm test:run` passed 109 files and 1,076 tests. `pnpm build` and `pnpm test:smoke` passed; smoke
  exercised 26 CLI checks and 52 mock-registry requests.
- The exact-Node built CLI reported `1.2.0`; the built library exposed `inspectRepository()`,
  `check()`, and repository schema version `1`.
- Dist inspection retained `node:sqlite` and excluded `better-sqlite3`.
  `npm pack --dry-run --json --ignore-scripts` passed with 23 files and a 77,425-byte archive.
- An isolated exact-Node cache probe made one cold registry request and zero additional warm
  requests. Live exact-Node repository inspection left index, worktree, and untracked status bytes
  unchanged, and `git diff --check` passed while preserving `.superpowers/`.
