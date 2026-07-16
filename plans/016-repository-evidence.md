# Plan 016: Manager, lockfile, runtime, and VCS evidence

## Contract

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: 015
- **Planned at**: `8eea9c5` plus completed plan 009, 2026-07-15
- **Status**: DONE

## Objective

Extend the repository model with explicit, source-backed evidence for effective root, package
manager, workspace boundaries, lockfiles, runtime constraints, and target-file VCS state. Ambiguous
evidence must remain ambiguous; precedence may not silently guess.

## Evidence contract

Each conclusion records `status`, `value`, `sources`, and stable diagnostics. Status is one of
`confirmed`, `ambiguous`, `missing`, `unsupported`, or `unavailable`. Evidence sources identify a
canonical relative file/field or a read-only runtime probe. Unknown is not a default value.

## Owned files

- root/package-manager/workspace detection modules
- lockfile discovery/parsing adapters for supported managers
- repository-model evidence types and serializers
- read-only Git status adapter limited to target paths
- runtime constraint parsing from manifests/tool files already supported by the project
- focused fixtures, repository-shape docs, and `CHANGELOG.md`

Do not resolve package versions, run installs, alter Git state, or implement compatibility policy.

## Implementation tasks

1. Characterize conflicting `packageManager`, lockfile, workspace-file, nested-root, and tool-version
   evidence. Include no-Git, missing-binary, shallow, and dirty-target fixtures.
2. Define deterministic precedence only where the package-manager format has an authoritative
   source. Otherwise return `ambiguous` with all evidence.
3. Model zero, one, or multiple lockfiles with manager, canonical path, byte hash, parse state, and
   ownership relationship to packages/workspaces.
4. Model repository runtime constraints from declared files; keep them separate from the Node
   version currently running depfresh.
5. Add read-only VCS evidence for target files and unrelated dirty paths. Never invoke commands that
   mutate, stage, clean, restore, or refresh user state.
6. Represent nested roots/boundaries from plan 012 directly in the model.
7. Extend `inspectRepository` deterministically and document every ambiguity/unsupported behavior.

## Acceptance evidence

- conflicting managers or lockfiles produce explicit ambiguity;
- lockfile and target-file hashes change exactly when bytes change;
- runtime constraints are repository-derived, not `process.version`;
- no-Git/missing-binary cases remain inspectable with unavailable evidence;
- VCS probes never mutate index/worktree and unrelated dirt is preserved;
- focused fixtures and all repository gates pass.

## STOP conditions

Stop if a manager/root choice requires heuristics without an authoritative source, or if obtaining
evidence would execute lifecycle scripts or mutate Git/package-manager state.

## Completion record

Completed locally on 2026-07-16 and committed as `d37c97f`.

- Added deterministic evidence conclusions for effective/nested boundaries, package managers,
  workspace declarations, lockfiles, repository runtime constraints, and read-only per-boundary
  Git state without changing schema version `1` or existing callers.
- Valid boundary-root `packageManager` fields are authoritative. Without one, lockfile managers are
  reported from all candidates and conflicts remain ambiguous. Unreadable owned subtrees keep
  lockfile-derived manager and selection evidence unavailable. Unknown state is never defaulted.
- Supported lockfiles are npm `package-lock.json`/`npm-shrinkwrap.json`, pnpm
  `pnpm-lock.yaml`, Yarn v1/Berry `yarn.lock`, JSONC `bun.lock`, and unsupported-but-hashed legacy
  `bun.lockb`. Physical aliases, unreadable files, malformed formats, and cross-manager ambiguity
  are explicit.
- Runtime evidence is limited to `engines.node`, `.nvmrc`, `.node-version`, and the `nodejs` entry
  in `.tool-versions`; the executor Node version is excluded. Workspace evidence never serializes
  unrelated pnpm catalogs or Yarn configuration credentials.
- Git probes sanitize inherited `GIT_*`, disable optional locks/refresh helpers/maintenance,
  preserve partial per-boundary evidence, omit unknown shallow state, and prove index/worktree
  immutability across clean, dirty, ignored, renamed, conflicted, nested, corrupt, and shallow
  repositories.
- Final verification passed: frozen install; typecheck; strict and script lint (225 files); 90
  focused repository tests; 73 core tests repeated three times and on exact Node `24.15.0`; 1,073
  full tests; build; 26-check smoke suite; exact-Node 15-test cache suite, built CLI, and library
  import; package dry-run (23 files, 77,258 bytes); builtin/obsolete-dependency dist inspection;
  isolated temporary-HOME cold/warm persistence (one/zero registry requests); live Git
  immutability probe; and `git diff --check`.
- Remaining limits: the fixed Git name still trusts `PATH`; snapshots cannot be atomic against
  concurrent external mutations; no Windows host replay was available beyond deterministic
  mixed-separator tests; policy, compatibility, apply, and synchronization remain deferred.
