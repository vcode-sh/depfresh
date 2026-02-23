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
| `NpmrcConfig` | Parsed `.npmrc` -- registries, auth tokens, proxy settings |
| `OutputFormat` | Output mode: `'table'` \| `'json'` |
| `PackageData` | Raw registry metadata for a package -- versions, dist-tags, timestamps, deprecations |
| `PackageManagerField` | Parsed `packageManager` field from a package manifest (`package.json` or `package.yaml`) (name, version, hash) |
| `PackageManagerName` | `'npm'` \| `'pnpm'` \| `'yarn'` \| `'bun'` |
| `PackageMeta` | A loaded package with its file path, raw deps, resolved changes, and indent info |
| `PackageType` | `'package.json'` \| `'package.yaml'` \| `'pnpm-workspace'` \| `'bun-workspace'` \| `'yarn-workspace'` \| `'global'` |
| `ProvenanceLevel` | Provenance attestation: `'trusted'` \| `'attested'` \| `'none'` |
| `RangeMode` | Version resolution strategy: `'default'` \| `'major'` \| `'minor'` \| `'patch'` \| `'latest'` \| `'newest'` \| `'next'` \| `'ignore'` |
| `RawDep` | A dependency before resolution -- name, current version, source field, update flag |
| `RegistryConfig` | A single registry entry -- URL, auth token, scope |
| `ResolvedDepChange` | A dependency after resolution -- extends `RawDep` with target version, diff, metadata |
| `SortOption` | Sort order for output: `'diff-asc'` \| `'diff-desc'` \| `'time-asc'` \| `'time-desc'` \| `'name-asc'` \| `'name-desc'` |
| `UpdateScore` | Confidence scoring for an update -- confidence, maturity, adoption, breaking flag |
