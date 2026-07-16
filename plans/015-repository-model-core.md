# Plan 015: Repository model core

## Contract

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: 012, 014
- **Planned at**: `8eea9c5` plus completed plan 009, 2026-07-15
- **Status**: DONE

## Objective

Introduce one versioned, deterministic, read-only model for repository source files, manifests,
dependency occurrences, catalogs, and workspace relationships. Existing check behavior must consume
this model or one explicit compatibility projection instead of maintaining duplicate discovery truth.

## Core entities

- `RepositoryModel`: schema version, canonical root ID, source files, packages, catalogs,
  occurrences, relationships, diagnostics, and evidence references.
- `SourceFile`: canonical relative path, format, byte hash, parse state, indentation/newline metadata.
- `PackageManifest`: stable ID, source-file ID, workspace-relative path/name, private flag.
- `DependencyOccurrence`: stable ID, owner ID, exact nested path, field/role, protocol, declared text,
  catalog link, and writeability.
- `Catalog`: stable ID, source-file ID, manager/format, catalog name, entries, and consumers.

Stable IDs derive only from schema version and canonical repository-relative identity. They must not
contain absolute paths, timestamps, enumeration order, or machine-specific inode values.

## Owned files

- discovery/parsing adapters under `src/io/packages`, `src/io/dependencies`, `src/io/catalogs`
- new internal model/types/hash/ID modules
- a read-only `inspectRepository` library boundary and public export
- deterministic fixtures and model documentation

Manager/lockfile/runtime/VCS interpretation, policies, registry resolution, and writes are out of
scope. Plan 016 adds evidence to this core.

## Implementation tasks

1. Inventory all currently supported JSON, YAML, workspace, catalog, override, resolution, npm/jsr,
   alias, and workspace-protocol shapes with characterization fixtures.
2. Define versioned model types and pure stable-ID/hash helpers. Hash exact source bytes with
   SHA-256; serialize paths relative to the canonical root.
3. Adapt physical source files and manifests into the model without normalizing away formatting
   metadata required by writers.
4. Create one occurrence per exact declaration path. Preserve identical names in different fields,
   packages, catalogs, and override trees.
5. Connect catalog declaration owners to consumers explicitly, including named/default catalogs and
   direct declarations of the same package.
6. Expose `inspectRepository(options)` as a read-only deterministic library API. It must not contact
   registries, write files, run package managers, or exit the process.
7. Route existing check discovery through the model or one documented compatibility projection.
   Remove competing parsing only after parity tests pass.
8. Document supported source shapes, IDs, hashes, diagnostics, and forward-version behavior.

## Acceptance evidence

- reordered filesystem enumeration produces byte-identical model JSON;
- repeated names remain separate stable occurrences;
- catalog owners and consumers are linked without conflating direct occurrences;
- no absolute paths or volatile timestamps appear;
- read-only guards prove no network/process/write side effects;
- existing discovery/check behavior and all repository gates pass.

## STOP conditions

Stop on an unsupported physical format, ambiguous occurrence ownership, ID collision, or a need to
cross the canonical root. Emit a diagnostic rather than guessing.

## Completion record

Completed locally on 2026-07-15. The package version remains `1.2.0`; versioning is deferred until
all open plans are complete. The previously concurrent dependency-range update was preserved and
its lockfile graph was synchronized before the final verification replay.

### Schema and identities

- Added public `inspectRepository(options)` and `RepositoryModel` schema version `1`.
- The model contains deterministic `sourceFiles`, `packages`, `catalogs`, `occurrences`, workspace
  and catalog-consumer relationships, diagnostics, and the empty `evidenceRefs` bridge owned by
  Plan 016.
- Stable IDs hash schema version, entity kind, and canonical repository-relative identity. Source
  IDs use relative paths; package IDs use manifest paths; catalog IDs add manager and catalog name;
  occurrence IDs add owner and exact nested declaration path. Absolute paths, timestamps,
  enumeration order, and inode values never participate.
- Source hashes are full SHA-256 digests of exact bytes. Formatting evidence retains JSON/YAML
  format, parse state, indentation, newline style, and trailing-newline state.

### Physical model and compatibility projection

- JSON/YAML manifests retain names, workspace paths, private state, `packageManager`, standard
  dependency fields, nested overrides/resolutions, and exact declared text.
- Protocol classification covers semver, npm, JSR, GitHub, workspace, catalog, file, link, Git,
  HTTP, and unknown declarations without registry access.
- pnpm, Bun, and Yarn default/named catalogs are modeled directly from parsed physical sources, so
  the read-only model includes peer catalogs even when the legacy check projection filters them.
- Catalog owners are occurrence entities. Exact `catalog:` consumers link to one owner; direct
  declarations of the same name remain independent. Missing and multi-format ambiguous owners emit
  diagnostics instead of guessed links.
- Normal `loadPackages()` and `check()` now use the inspector's explicit `PackageMeta[]`
  compatibility projection from the same contained discovery pass. Global discovery remains on its
  existing non-filesystem path until Plan 021.

### Adversarial evidence

- Identical repositories at different absolute roots produce byte-identical JSON and IDs.
- Reversed package and manifest enumeration produces byte-identical model JSON.
- Repeated names across fields, packages, nested overrides, and catalogs remain distinct stable
  occurrences.
- Named Bun, named pnpm, and default Yarn catalogs cover owner/consumer links and ambiguous names;
  peer catalogs prove model truth is independent from check policy filters.
- Exact CRLF metadata and source-byte hashes are verified.
- Malformed supported sources remain parse-error evidence without becoming package entities.
- External catalog symlinks and missing roots produce relative diagnostics without parsing outside
  the selected root.
- PATH sentinels, a rejecting fetch spy, and byte comparisons prove inspection performs no network,
  process, or write side effects.

### Verification

- `pnpm install --frozen-lockfile`: pass with pnpm 10.33.0.
- `pnpm typecheck`: pass.
- `pnpm lint`: pass, 221 files checked; 23 non-blocking suppression warnings and one configuration
  deprecation notice remain visible under the updated formatter.
- Combined Plan 014/015 adversarial suite: pass, 4 files and 27 tests.
- Exact Node 24.15.0 focused cache/write/model suite: pass, 5 files and 42 tests; built CLI reports
  `1.2.0` with empty stderr; built `inspectRepository()` import and schema inspection pass with
  empty stderr.
- `pnpm test:run`: pass, 107 files and 1,019 tests.
- `pnpm build`: pass; public exports include `inspectRepository`, schema version, and model types.
- `pnpm test:smoke`: pass, 26 practical CLI checks and 52 mock-registry requests.
- Package dry-run: pass, package `depfresh@1.2.0`, 23 files, 66,359 bytes packed.
- Dist inspection: `node:sqlite` remains a builtin import and `better-sqlite3` is absent.
- Temporary-HOME CLI persistence probe on exact Node 24.15.0: one cold registry request, zero warm
  requests, and an isolated persistent SQLite database.
- `git diff --check`: pass after the final ledger update.

### Remaining limitations

- Manager, lockfile, runtime, VCS, and evidence interpretation remain deferred to Plan 016.
- Global occurrences remain outside the filesystem repository model until Plan 021.
