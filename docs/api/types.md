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
| `InvocationAuthority` | Immutable grants for file write, process execution, lockfile write, install, exact command verification, artifact verification, network access, legacy compatibility, and global-write side effects |
| `InspectOptions` / `InspectResult` | Process-free schema-v1 repository evidence input and schema-derived result |
| `PlanOptions` / `PlanResult` | Registry-aware non-mutating planner input, including optional manager/verification intent, and schema-derived semantic plan result |
| `CohortInput` / `SignalRuleInput` / `SignalRuleEffect` | Strict explicit package-family coordination and ordered `warn`/`block` signal-effect configuration |
| `EvaluatePlanSignalsInput` / `EvaluatePlanSignalsResult` | Pure fixed-clock repository-signal evaluator input and normalized signals/evidence/summary/block result |
| `PlanSignal` / `SignalEvidence` / `SignalSummary` | Fingerprinted immutable signal truth, normalized source evidence, policy trace, and exact counts |
| `SignalState` / `SignalFamily` / `SignalReason` | Public five-state vocabulary plus compatibility, passive, and apply-time artifact-verification families/reasons |
| `SignalPolicyEffect` / `SignalPolicySource` | `none|warn|block` effect and traced config/library/CLI provenance; neither changes evidence truth |
| `ApplyOptions` / `ApplyResult` | Explicit root selection and schema-derived observed file, manager, verification, and recovery result for one authorized immutable plan |
| `ArtifactVerificationTarget` | Exact installed npm artifact identity, location, integrity, occurrence consumers, and independent passive-presence inputs |
| `ArtifactTrustDimensionResult` / `ArtifactTrustResult` | Sanitized independent signature/provenance verification truth for one exact artifact and location |
| `GlobalPlanOptions` / `GlobalApplyOptions` | Explicit working directory, timeout, and environment inputs for global inventory/apply operations |
| `GlobalApplyPlan` / `GlobalApplyResult` | Strict schema-v1 manager-specific global plan and observed non-transactional result |
| `GlobalInvocationAuthority` | Immutable global-write, process-execute, and exact manager grants |
| `GlobalUpdateRequest` / `GlobalManagerEvidence` | One expected-to-target occurrence request and its explicit confirmed/unavailable/malformed/timeout/unknown/unsupported inventory evidence |
| `MachineCommandError` | Schema-derived fatal `inspect`/`plan`/`apply` CLI error document |
| `LegacyCheckJsonResult` / `LegacyCheckJsonError` | Compatibility schema-v1 check report and fatal error shapes; not immutable plans |
| `InspectRepositoryOptions` | Read-only repository inspection options; contains no side-effect grants |
| `NpmrcConfig` | Parsed `.npmrc` -- registries, auth tokens, proxy settings |
| `OutputFormat` | Output mode: `'table'` \| `'json'` |
| `PackageData` | Normalized registry metadata -- versions/tags/timestamps, deprecation, engines, peer requirements/optionality, repository identity, passive signature/provenance presence, and canonical public-registry SHA-512 artifact integrity when observed |
| `PackageManagerField` | Parsed `packageManager` field from a package manifest (`package.json` or `package.yaml`) (name, version, hash) |
| `PackageManagerName` | `'npm'` \| `'pnpm'` \| `'yarn'` \| `'bun'` |
| `PackageMeta` | A loaded package with its file path, raw deps, resolved changes, and indent info |
| `PackageType` | `'package.json'` \| `'package.yaml'` \| `'pnpm-workspace'` \| `'bun-workspace'` \| `'yarn-workspace'` \| `'global'` |
| `PolicyRuleInput` / `PolicySelectors` | JSON-compatible occurrence rule and selector vocabulary |
| `PolicyAction` / `PolicyMode` | Independent include/exclude action and non-ignore resolution mode dimensions |
| `PolicyInputLayer` | One defaults, config, library, or CLI input layer accepted by `compilePolicy` |
| `PolicyStatus` / `PolicyCurrentChannel` | Decision lifecycle state and model-derived stable/prerelease channel |
| `PolicyRuleSource` / `PolicyRuleProvenance` | Defaults, config, library, or CLI source plus deterministic kind and index |
| `CompiledPolicyRule` / `CompiledPolicy` | Validated ordered rules ready for pure evaluation |
| `PolicyOccurrenceContext` | Model-derived occurrence, workspace, catalog, manager, protocol, and current-specifier context |
| `PolicyDecision` | Selected, skipped, blocked, or unchanged result with complete matched/winner trace |
| `PolicyReason` / `PolicyCandidateReason` | Stable policy result and exact candidate-pipeline reason vocabularies |
| `PolicyCatalogRole` / `PolicySpecifierStatus` | `direct|owner|consumer` and `locked|range|dynamic|invalid` classifications |
| `PassivePresence` / `SignaturePresence` | Passive registry metadata: `'present'` \| `'absent'` \| `'unknown'`; presence does not prove verification or trust |
| `ProvenanceLevel` | Deprecated compatibility input. Its legacy labels are not converted into signature evidence |
| `RangeMode` | Resolution strategy plus legacy `packageMode` sentinel: `'default'` \| `'major'` \| `'minor'` \| `'patch'` \| `'latest'` \| `'newest'` \| `'next'` \| `'ignore'` |
| `RawDep` | A dependency before resolution, optionally linked to its exact occurrence and policy decision |
| `RegistryConfig` | A single registry entry -- URL, auth token, scope |
| `RepositoryModel` | Versioned deterministic repository source, manifest, catalog, occurrence, relationship, diagnostic, and evidence-reference graph |
| `RepositoryEvidenceConclusion<T>` | Stable `confirmed`, `ambiguous`, `missing`, `unsupported`, or `unavailable` conclusion with candidate values, sources, and diagnostics |
| `RepositoryEvidenceSource` | Stable repository-relative file, nested field path, or named read-only probe source |
| `RepositoryBoundary` | Effective-root or nested workspace/Git boundary with every canonical marker |
| `RepositoryLockfile` | Owned npm/pnpm/Yarn/Bun lockfile with parse state, detected format version, and exact byte hash when readable |
| `RepositoryRuntimeDeclaration` | Exact repository-declared Node text from a manifest or supported tool-version file |
| `RepositoryVcsBoundaryEvidence` | Read-only status and shallow state for one effective or nested Git boundary |
| `RepositoryVcsEvidence` | Read-only per-boundary Git state, aggregate target-file states, unrelated dirty paths, and unavailable diagnostics |
| `RepositorySourceFile` | Canonical relative source path with exact byte hash and formatting metadata |
| `RepositoryPackageManifest` | Stable package-manifest identity and workspace location |
| `RepositoryDependencyOccurrence` | One exact declaration path, owner, role, protocol, text, catalog link, and writeability state |
| `RepositoryCatalog` | Stable pnpm/Bun/Yarn catalog identity and owner-entry references |
| `RepositoryDiagnostic` | Deterministic unsupported, ambiguous, containment, parse, or ID-collision evidence |
| `ResolvedDepChange` | A dependency after resolution -- extends `RawDep` with target version, diff, metadata |
| `SortOption` | Sort order for output: `'diff-asc'` \| `'diff-desc'` \| `'time-asc'` \| `'time-desc'` \| `'name-asc'` \| `'name-desc'` |
| `UpdateScore` | Legacy optional compatibility shape; Plan 022 maturity truth is expressed by `PlanSignal` instead |
| `WriteOutcome` | Observed terminal result for one exact physical write occurrence |
