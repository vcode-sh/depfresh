# Exported Types

The full type catalogue. Every interface, union, and enum that depfresh exports. Import what you need, ignore the rest.

| Type | What it is |
|------|-----------|
| `AddonContext` | Runtime context passed to addon hooks (`options`, `runId`, `startedAt`) |
| `AddonHookName` | Addon lifecycle hook names used by typed addon errors |
| `depfreshOptions` | The full options object. Every flag, callback, and setting lives here |
| `depfreshAddon` | First-class addon contract with lifecycle hooks and optional write veto |
| `CatalogSource` | A workspace catalog entry (pnpm/bun/yarn) with its deps and file path |
| `DepFieldType` | Union of dependency field names: `'dependencies'`, `'devDependencies'`, `'overrides'`, etc. |
| `DiffType` | Version diff classification: `'major'` \| `'minor'` \| `'patch'` \| `'none'` \| `'error'` |
| `InvocationAuthority` | Immutable grants for write, install, update, execute, verification-command, and global-write side effects |
| `InspectRepositoryOptions` | Read-only repository inspection options; contains no side-effect grants |
| `NpmrcConfig` | Parsed `.npmrc` -- registries, auth tokens, proxy settings |
| `OutputFormat` | Output mode: `'table'` \| `'json'` |
| `PackageData` | Raw registry metadata for a package -- versions, dist-tags, timestamps, deprecations |
| `PackageManagerField` | Parsed `packageManager` field from a package manifest (`package.json` or `package.yaml`) (name, version, hash) |
| `PackageManagerName` | `'npm'` \| `'pnpm'` \| `'yarn'` \| `'bun'` |
| `PackageMeta` | A loaded package with its file path, raw deps, resolved changes, and indent info |
| `PackageType` | `'package.json'` \| `'package.yaml'` \| `'pnpm-workspace'` \| `'bun-workspace'` \| `'yarn-workspace'` \| `'global'` |
| `SignaturePresence` | Passive registry metadata: `'present'` \| `'absent'`; presence does not prove verification or trust |
| `ProvenanceLevel` | Deprecated compatibility input. Its legacy values do not imply verification; use `SignaturePresence` |
| `RangeMode` | Version resolution strategy: `'default'` \| `'major'` \| `'minor'` \| `'patch'` \| `'latest'` \| `'newest'` \| `'next'` \| `'ignore'` |
| `RawDep` | A dependency before resolution -- name, current version, source field, update flag |
| `RegistryConfig` | A single registry entry -- URL, auth token, scope |
| `RepositoryModel` | Versioned deterministic repository source, manifest, catalog, occurrence, relationship, diagnostic, and evidence-reference graph |
| `RepositorySourceFile` | Canonical relative source path with exact byte hash and formatting metadata |
| `RepositoryPackageManifest` | Stable package-manifest identity and workspace location |
| `RepositoryDependencyOccurrence` | One exact declaration path, owner, role, protocol, text, catalog link, and writeability state |
| `RepositoryCatalog` | Stable pnpm/Bun/Yarn catalog identity and owner-entry references |
| `RepositoryDiagnostic` | Deterministic unsupported, ambiguous, containment, parse, or ID-collision evidence |
| `ResolvedDepChange` | A dependency after resolution -- extends `RawDep` with target version, diff, metadata |
| `SortOption` | Sort order for output: `'diff-asc'` \| `'diff-desc'` \| `'time-asc'` \| `'time-desc'` \| `'name-asc'` \| `'name-desc'` |
| `UpdateScore` | Confidence scoring for an update -- confidence, maturity, adoption, breaking flag |
| `WriteOutcome` | Observed terminal result for one exact physical write occurrence |
