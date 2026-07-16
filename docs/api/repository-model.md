# Repository Model

`inspectRepository()` returns a deterministic, read-only description of the repository without
contacting registries or running write, install, update, package-manager, or lifecycle commands.

Global package occurrences are intentionally outside this repository file graph. Their stable
manager/package/version identities and executable/realm evidence live in the separate
`depfresh.global-plan` contract, so repository inspection remains process-free.

```ts
import { inspectRepository } from 'depfresh'

const model = await inspectRepository({ cwd: process.cwd() })

if (model.schemaVersion !== 1) {
  throw new Error(`Unsupported repository model version: ${model.schemaVersion}`)
}
```

## Version and identity

The current `schemaVersion` is `1`. Consumers should check it before interpreting the model and
reject versions they do not understand. The Plan 016 fields are additive and optional in the public
schema-v1 producer type for older producers; the current inspector always emits them. Incompatible
shape or identity changes require a new schema version.

Every entity ID is a SHA-256-derived identifier over the schema version, entity kind, and canonical
repository-relative identity. IDs never include absolute paths, timestamps, enumeration order,
inode values, or the executor Node version. `rootId` represents the repository-relative identity
`.` and is not a machine-specific locator.

## Evidence conclusions

Every conclusion has a stable ID, one of five statuses (`confirmed`, `ambiguous`, `missing`,
`unsupported`, or `unavailable`), a candidate-array `value`, sorted sources, and sorted stable
diagnostics. `evidenceRefs` contains every emitted conclusion ID.

File and field sources retain canonical repository-relative paths. Field sources also retain the
exact nested path as string segments. Probe sources are named (`discovery` or `git`) and never
serialize an executable path or raw command stderr.

## Entities

### `root` and `boundaries`

The effective root is represented as `.` with its discovery mode. Boundaries classify the
effective root and each contained nested workspace or Git root, retaining every canonical marker.
`boundaryPackages` and `lockfileBoundaries` record explicit ownership. Ownership always uses the
nearest boundary, so a nested lockfile cannot make its parent ambiguous. Inspection never crosses
the canonical root or follows an escaped marker symlink.

### `sourceFiles` and `packages`

Each supported JSON or YAML source records its canonical relative path, exact SHA-256 byte hash,
parse state, indentation, newline style, and trailing-newline state. The hash covers original bytes
before parsing or normalization.

Each selected `package.json` or `package.yaml` records a stable ID, source ID, manifest path,
workspace path, name, and `private` flag. Existing manifest priority remains unchanged:
`package.yaml` wins when both formats exist in one directory.

### `occurrences` and `catalogs`

One occurrence represents one exact declaration. Identity includes its owner and full nested path,
so repeated names in another field, manifest, override branch, or catalog remain separate. Roles
cover direct dependencies, overrides, package-manager fields, catalog owners, and catalog
consumers.

pnpm, Bun, and Yarn default/named catalogs record their source, manager, format, name, and entry
occurrence IDs. Ambiguous consumers remain unlinked with `CATALOG_REFERENCE_AMBIGUOUS`.

### `lockfiles`

Supported exact names are:

- npm: `package-lock.json` and `npm-shrinkwrap.json`;
- pnpm: `pnpm-lock.yaml`;
- Yarn: `yarn.lock`;
- Bun: `bun.lock` and legacy `bun.lockb`.

Each readable entity records its manager, canonical path, exact SHA-256 byte hash, owning boundary,
parse state, and safely detected format version. JSON, JSONC, and YAML/text formats are parsed
without lifecycle execution. Modern `bun.lock` is JSONC, including comments and trailing commas.
Binary `bun.lockb` is hashed and marked `unsupported`; Bun is never invoked. Malformed known formats
are `error`, while a known but unreadable file is retained as `unavailable` without a fabricated
hash. Escaped symlinks and duplicate physical aliases produce diagnostics instead of extra
entities. A direct canonical lockfile wins over its aliases; cross-manager aliases without a direct
canonical lockfile remain explicitly ambiguous.

Lockfile selection is `missing` for zero candidates, `confirmed` for one parsed candidate, and
`ambiguous` for multiple candidates, including multiple lockfiles for one manager. With no valid
boundary-root field, one represented manager is confirmed and distinct managers are ambiguous.
If an owned directory cannot be enumerated, lockfile selection is `unavailable`; manager evidence
is also `unavailable` unless a valid boundary-root `packageManager` field remains authoritative.

### `runtimeDeclarations`

Repository runtime evidence is limited to manifest `engines.node`, `.nvmrc`, `.node-version`, and
the `nodejs` entry in `.tool-versions`. Exact declared text is retained; tool files also carry exact
byte hashes. One unique declaration is confirmed, distinct declarations remain ambiguous, no
declaration is missing, and malformed supported syntax is unsupported. A single `.tool-versions`
`nodejs` entry may retain multiple fallback values as exact text; evaluation is deferred. Any
unreadable declaration keeps the boundary conclusion unavailable, and unsupported syntax keeps it
unsupported even when another declaration is valid. The Node version executing depfresh is not
evidence. Compatibility evaluation remains outside this model.
The plan signal evaluator consumes all declarations attached to an occurrence's owning boundary;
missing, malformed, ambiguous, unsupported, or unavailable evidence remains unknown, and the
executor runtime is never substituted.

### `vcs`

The focused Git adapter uses the fixed `git` executable with argument arrays and NUL-delimited
porcelain output. It removes inherited `GIT_*` routing, object, config, helper, and trace variables;
then disables optional locks, preload-index refresh behavior, filesystem monitors, untracked-cache
updates, filesystem caching, and automatic maintenance. Every modeled nested Git boundary is
probed separately. The aggregate `shallow` field describes the effective root and is omitted when
that state is unavailable, while `repositories` retains status and shallow state per boundary.
Confirmed results from readable boundaries remain in the conclusion when another boundary probe
is unavailable.

Target states cover clean, ignored, staged, unstaged, staged-plus-unstaged, added, deleted, renamed,
conflicted, and untracked files. Rename evidence retains both the destination and original path.
Clean is emitted only for a tracked modeled target; exact ignored targets are queried separately.
Sorted dirty paths outside the modeled target set are retained, and unusual paths are NUL-safe.

Missing Git, a non-Git directory, and a failed or corrupt probe are distinct unavailable
diagnostics. The adapter never stages, restores, cleans, checks out, runs `update-index`, invokes a
configured filesystem-monitor helper, or reads unrelated dirty file contents.

### `relationships`

`workspaceMembers` preserves the compatibility projection's workspace links.
`catalogConsumers` links catalog IDs to exact consumer occurrences. `boundaryPackages` and
`lockfileBoundaries` expose first-class evidence ownership.

## Manager precedence and diagnostics

A single valid boundary-root `packageManager` field is authoritative only when no other
boundary-root field conflicts. Exact manager, version, hash, and raw text are retained. Invalid or
unknown syntax is unsupported; the model never defaults to npm. A declared-manager/lockfile
mismatch is diagnosed without overriding the authoritative field.

Diagnostics are deterministic and repository-relative. In addition to the existing root, source,
catalog, and collision diagnostics, evidence can report workspace conflicts, unsupported or
unavailable declarations, invalid package-manager fields, manager/lockfile mismatches, lockfile
parse/unsupported/unavailable/containment states, runtime syntax or I/O failures, unreadable
directories, and the three unavailable Git outcomes.

## Compatibility projection and limitations

Normal `loadPackages()` and `check()` discovery consume the same `PackageMeta[]` compatibility
projection. Local checks derive policy context from exact occurrences, including normalized current
version/channel/status, catalog identity, and confirmed single-manager boundary evidence, then link
only selected physical dependencies back into that projection. Ambiguous, missing, unsupported, or
unavailable managers remain unknown. Catalog consumers are explanatory and never propagate a
workspace/package rule into their physical owner. Global package discovery remains on its existing
non-filesystem legacy policy path.

Repository inspection does not resolve registry versions or invent registry-derived current status,
synchronize lockfiles, apply manifest changes, run installs, or mutate Git state.

## Machine contract projection

`inspect()` projects this model into `depfresh.inspect` schema v1 without absolute paths or raw
credential-bearing declaration text. The projection includes the model entities and relationships
needed to resolve every occurrence/source/catalog/boundary reference, plus each evidence value and
its complete file/field/probe sources. Withheld non-public values produce material risks; unsafe
identity paths fail with a stable structured error. It disables the Git subprocess and records
`VCS_PROBE_DISABLED` instead of fabricating clean state. `plan()` uses the full model, including the
fixed read-only Git evidence adapter, then adds policy/candidate traces and exact operations. See
[Inspect and Plan Contracts](../output-formats/inspect-plan.md).
