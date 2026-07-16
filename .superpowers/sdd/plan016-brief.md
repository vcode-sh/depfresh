# Plan 016 implementation brief

Implement the complete contract from `plans/016-repository-evidence.md` on top of commit
`6346f32`. Work only in the Plan 016 owned behavior and documentation. All code, tests, diagnostics,
and documentation must be English. Preserve current callers, deterministic schema-v1 IDs, source
hashes, formatting, containment, and the explicit compatibility projection.

## Binding evidence contract

- Add stable public evidence statuses: `confirmed`, `ambiguous`, `missing`, `unsupported`, and
  `unavailable`.
- Every conclusion has a stable ID, `status`, `value` (including all candidates where ambiguity is
  possible), sorted source references, and sorted stable diagnostics.
- Evidence sources are canonical repository-relative files/fields or named read-only probes. Never
  serialize absolute paths, raw command stderr, timestamps, enumeration order, inode values, or
  `process.version`.
- Preserve repository model schema version 1. New schema-v1 fields must be additive for older
  consumers; the current inspector always emits them and populates `evidenceRefs` with stable IDs.
- Add first-class workspace boundaries and lockfiles plus explicit boundary/package and
  lockfile/boundary ownership relationships.

## Root and workspace evidence

- Represent the effective root as `.` with its discovery mode and source evidence.
- Represent the effective boundary and every contained nested workspace/Git boundary already
  detected by the Plan 012 adapters. Preserve every marker and canonical relative marker path.
- The nearest contained Git boundary must prevent invocation inside a nested repository from being
  attributed to an outer workspace root.
- Never cross the canonical root or follow an escaped marker symlink.
- Conflicting authoritative workspace declarations remain ambiguous; do not select by filename
  order.

## Package-manager evidence

- Scope manager conclusions per boundary before comparing sources.
- Supported managers are npm, pnpm, yarn, and bun.
- A single valid boundary-root `packageManager` field is authoritative only when no other
  boundary-root `packageManager` field conflicts with it. Preserve its exact version/hash/raw text.
- Without a valid field, one unique manager represented by boundary-owned lockfiles is confirmed.
- Conflicting valid fields or multiple distinct lockfile managers are ambiguous and retain every
  candidate. Multiple same-manager lockfiles may confirm the manager while lockfile selection stays
  ambiguous.
- Nested lockfiles never make a parent boundary ambiguous.
- Invalid/unknown declared manager syntax is unsupported. No evidence is missing. Never default to
  npm and never execute a manager binary.

## Lockfile evidence

- Support exact names: `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`,
  `bun.lock`, and legacy `bun.lockb`.
- Each lockfile has a stable ID, manager, canonical relative path, exact SHA-256 byte hash, parse
  state (`parsed`, `error`, or `unsupported`), detected format/version when safely available, and
  owning boundary.
- JSON lockfiles and text YAML/Yarn lockfiles must be parsed without lifecycle execution. `bun.lock`
  is JSON. `bun.lockb` is hashed and unsupported; never invoke Bun to interpret it.
- Malformed known text formats are parse errors. Escaped symlinks and duplicate physical aliases
  produce stable diagnostics rather than entities or guessed ownership.
- Zero boundary lockfiles is missing, one valid lockfile is confirmed, multiple boundary lockfiles
  make lockfile selection ambiguous even when they belong to one manager.

## Runtime evidence

- Collect repository declarations only: manifest `engines.node`, `.nvmrc`, `.node-version`, and the
  `nodejs` entry in `.tool-versions`.
- Retain exact declared text, canonical relative source/field, byte hash for tool files, and owning
  boundary. Ignore the executor Node version entirely.
- One unique declaration is confirmed. Multiple distinct declarations remain ambiguous because
  compatibility evaluation belongs to Plan 022. No declaration is missing. Malformed supported
  tool syntax is unsupported.
- Other tool-version files or keys are unsupported and must not be guessed.

## Read-only VCS evidence

- Add a focused adapter using Git argument arrays and NUL-delimited porcelain output.
- Disable optional locks and refresh behavior (`GIT_OPTIONAL_LOCKS=0`, `--no-optional-locks`, and
  safe command/config options). Never stage, restore, clean, checkout, update-index, or mutate files.
- Model shallow state and exact target states for model source files, lockfiles, and runtime tool
  files, including clean, staged, unstaged, staged-plus-unstaged, added, deleted, renamed,
  conflicted, and untracked cases. Preserve unusual relative paths safely.
- Also report sorted repository-relative dirty paths outside the target set so callers can
  distinguish unrelated dirt. Never read or mutate their contents.
- Missing Git executable, non-Git directory, and failed probe are separate unavailable diagnostics.

## Required red-green adversarial evidence

Write failing tests first and capture the expected failures before production edits. Cover:

1. conflicting manager fields and manager/lockfile mismatch;
2. same-manager and cross-manager multiple lockfiles;
3. root versus nested-boundary ownership;
4. exact one-byte source/lockfile hash changes;
5. malformed npm/pnpm/Yarn/Bun text lockfiles and binary `bun.lockb`;
6. escaped lockfile symlink and duplicate physical alias;
7. conflicting workspace declarations and nested Git root precedence;
8. `.nvmrc`, `.node-version`, `.tool-versions`, runtime conflicts, and proof that executor Node is
   absent;
9. no repository, missing Git binary, shallow repository, every target status above, unusual paths,
   and unrelated dirty paths;
10. `.git/index` bytes/stat and unrelated worktree bytes/status unchanged after inspection;
11. reversed enumeration and different absolute roots remain byte-identical;
12. PATH sentinels prove inspection runs no package manager or lifecycle command.

Use real filesystem and real temporary Git repositories where practical. Do not weaken existing
Plan 015 tests. Run focused tests after each red-green slice, then typecheck and strict lint.

## Documentation and completion

Update the current repository-model API/type/function docs, README, workspace documentation,
troubleshooting, AGENTS.md architecture/review guidance, and the Unreleased changelog. State exact
supported formats and limitations. Do not claim registry resolution, compatibility policy,
lockfile synchronization, apply behavior, installs, or Git mutation. Do not bump the package
version. Do not edit historical changelog entries.

Do not stage, commit, push, publish, or create a release. Return a self-review with exact red/green
commands, changed files, known limitations, and any STOP-condition evidence.
