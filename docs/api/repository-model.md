# Repository Model

`inspectRepository()` returns a deterministic, read-only description of the repository without
contacting registries or running write/install/update commands.

```ts
import { inspectRepository } from 'depfresh'

const model = await inspectRepository({ cwd: process.cwd() })

if (model.schemaVersion !== 1) {
  throw new Error(`Unsupported repository model version: ${model.schemaVersion}`)
}
```

## Version and identity

The current `schemaVersion` is `1`. Consumers should check it before interpreting the model and
reject versions they do not understand. New optional fields may be added compatibly; incompatible
shape or identity changes require a new schema version.

Every entity ID is a SHA-256-derived identifier over:

1. schema version;
2. entity kind;
3. canonical repository-relative identity.

IDs never include absolute paths, timestamps, enumeration order, or inode values. Source-file IDs
derive from their canonical relative paths; package IDs derive from their manifest paths; catalog
IDs add manager and catalog name; occurrence IDs add their owner and exact nested declaration path.

`rootId` represents the versioned repository-relative identity `.`. It is intentionally not a
machine-specific repository locator.

## Entities

### `sourceFiles`

Each supported JSON or YAML source records its canonical relative path, exact SHA-256 byte hash,
parse state, indentation, newline style, and trailing-newline state. The hash covers the original
bytes, before parsing or newline normalization.

### `packages`

Each selected `package.json` or `package.yaml` manifest records a stable ID, source-file ID,
repository-relative manifest path, workspace path, name, and `private` flag. Existing manifest
priority remains unchanged: `package.yaml` wins when both formats exist in one directory.

### `occurrences`

One occurrence represents one exact declaration. Identity includes the owner and full nested path,
so repeated names in another field, manifest, override branch, or catalog remain separate.

Roles are:

- `dependency` for direct standard dependency fields;
- `override` for exact nested override/resolution leaves;
- `package-manager` for the manifest `packageManager` field;
- `catalog-owner` for a catalog entry;
- `catalog-consumer` for a `catalog:` declaration.

The model retains the exact `declaredText`, protocol, field, catalog link, and whether the current
writer can address the declaration safely.

### `catalogs`

pnpm, Bun, and Yarn default/named catalogs record their source file, manager, format, name, and
entry occurrence IDs. Consumer relationships link exact declarations to catalog owners. A direct
dependency with the same package name is not linked. If more than one loaded format defines the
same referenced catalog name, the consumer remains unlinked and receives
`CATALOG_REFERENCE_AMBIGUOUS`.

### `relationships`

`workspaceMembers` links the root manifest to discovered workspace package manifests.
`catalogConsumers` links a catalog ID to each exact consumer occurrence.

## Diagnostics

Diagnostics are deterministic and repository-relative:

- `SOURCE_PARSE_FAILED` -- a supported source could be read but not parsed as an object;
- `ROOT_NOT_FOUND` -- the requested inspection root does not exist;
- `SOURCE_OUTSIDE_ROOT` -- a candidate failed containment or escaped through a symlink;
- `CATALOG_REFERENCE_UNRESOLVED` -- a `catalog:` declaration has no matching owner;
- `CATALOG_REFERENCE_AMBIGUOUS` -- more than one loaded catalog could own the declaration;
- `ID_COLLISION` -- two entities produced the same stable ID.

An unsupported or ambiguous state is reported instead of guessed. Plan 016 adds manager, lockfile,
runtime, VCS, and evidence interpretation; the current `evidenceRefs` array is empty by design.

## Compatibility projection

Normal `loadPackages()` and `check()` discovery now run through the same inspection pass and consume
its explicit `PackageMeta[]` compatibility projection. This preserves existing filtering, catalog
loading, callbacks, and callers while the versioned model becomes the source of discovery truth.

Global package discovery remains on its existing non-filesystem projection until the global state
model is introduced. Registry resolution and every write path remain outside
`inspectRepository()`.
