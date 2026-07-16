# depfresh 2.0 release preparation

> **DRAFT / UNRELEASED — DO NOT PUBLISH**
>
> This is the local release-preparation record for the verified 2.0.0 candidate. It does not
> authorize a tag, push, package publication, hosted release, movable Action tag, or announcement.

> **CURRENT CORRECTION:** CI run `29530434379` exposed root-runner permission-fixture and Linux argv
> portability defects after this record was written. Plan 025 contains the local corrections. A
> fresh hosted green replay is required before this draft can again be treated as release-ready;
> no push is authorized by this document.

> **PERFORMANCE CORRECTION:** Plan 026 removes the measured large-repository evidence-walk stall
> and coordinates phase progress with durable output. Its exact-Node, package, and release gates
> must be reflected in the final figures below before publication; this does not relax the hosted
> replay requirement.

## Version lock

The package version changed exactly once from `1.2.0` to **`2.0.0`** after Plans 011 through 024
were marked `DONE` with fresh completion evidence. That candidate version is synchronized across
package metadata, built CLI and capabilities output, current documentation, Action coupling, and
the curated release notes.

The version bump was permitted because all of the following became true:

- Plans 011–016 have passed their final verification and contain completion records.
- Plans 017–024 are implemented, verified, and marked `DONE`.
- Every current documentation claim has been checked against the built CLI, library exports,
  packaged schemas/assets, and observed runtime behavior.
- The complete release-readiness checklist was green locally before the first hosted push. Plan
  025 requires a fresh hosted replay before release readiness is current again.

## Big announcement draft

> **DRAFT / UNRELEASED — locally verified release copy; no publication is authorized**

### depfresh 2.0: inspect it, plan it, apply it, prove it

Dependency updates should not depend on hidden guesses. depfresh 2.0 turns dependency
maintenance into an evidence-backed workflow: inspect the repository, make every decision visible,
review an immutable plan, grant only the authority required for the chosen operation, and report
what the filesystem and package managers actually did.

This release is designed around one rule: unknown state is never reported as success.

#### Immediate, honest feedback on large repositories

Normal recursive checks now show discovery, repository evidence, dependency resolution, and result
rendering as distinct phases. The repository inventory retains only files that can contribute
manifest, workspace, lockfile, runtime, or Git-boundary evidence while still observing unavailable
directories and never following directory symlinks. Declared, eligible, pinned, and other skipped
counts stay distinct. Progress relinquishes the cursor around durable tables and errors, then ends
with a concise run summary; JSON and redirected output remain unchanged.

#### A repository model built from physical evidence

depfresh 2.0 describes exact dependency occurrences instead of collapsing repeated
package names into one logical item. Repository-relative identities, exact source hashes, catalog
owners and consumers, workspace boundaries, manager declarations, lockfiles, runtime constraints,
and read-only VCS state remain explicit and deterministic.

Conflicting evidence is reported as conflicting evidence. Missing, unsupported, and unavailable
states remain distinct. The running Node process is not substituted for the repository's declared
runtime constraints, and inspection does not silently choose a package manager from ambiguous
sources.

#### Policy decisions for exact occurrences

depfresh 2.0 evaluates validated ordered policy rules against exact repository occurrences. Rules
can select dependency and package names, canonical workspace paths, catalog names and roles,
dependency fields and occurrence roles, managers, protocols, current channels, and normalized
specifier status. Action and mode use independent last-match-wins decisions with complete matched
and winning-rule traces. Catalog owners and consumers are evaluated independently; only an owner
controls its physical entry, and same-name direct declarations do not inherit catalog policy.
Unknown manager evidence blocks an otherwise matching manager-specific rule instead of being
guessed.

#### Reviewable inspect and plan contracts

`depfresh inspect --json` now emits process-free schema-v1 repository evidence, and
`depfresh plan --json` adds registry-aware candidate resolution without repository or persistent
cache writes. The public `inspect()` and `plan()` APIs return the same typed documents. Exact
occurrence operations carry relative file/path, source hash, expected value, and requested stored
value; every inspected occurrence receives one terminal decision with a policy trace and, when
registry resolution runs, a candidate trace.
Canonical repository and semantic plan fingerprints are recomputable, and credential-bearing
operations block instead of leaking or weakening preconditions. The package ships strict inspect,
plan, and command-error schemas at `depfresh/schemas/*-v1.json`.

#### Stale-safe file application

`depfresh apply --json --write --plan-file <path>` and the public `apply()` API accept only a
strict schema-v1 immutable plan under explicit snapshotted write authority. Apply revalidates the
embedded semantic-plan and clone-stable repository fingerprints, exact contained regular-file identity,
source hashes, occurrence values, and target-only Git state before mutation. It stages and backs
up beside each target, owns a root-local tokenized lock and relative-path journal, rechecks all
targets before the first replacement, then rechecks the affected target, staged/backup artifacts,
and lock ownership before each rename. It reports only observed final state.
The fault-injection and cross-process matrix covers every stage and replacement boundary, live,
malformed, dead, and recovery-bearing locks, crash recovery, failed recovery, and ambiguous final
observation. Outcomes distinguish `applied`, `skipped`, `conflicted`, `reverted`, `failed`, and
`unknown`; summary counts reconcile exactly. Replacement is atomic per file rather than across the
repository, recovery is best effort across files, and hostile ancestor-directory replacement after
the final portable pathname check remains an operating-system boundary.

#### Explicit lockfile synchronization and verification

Lockfile synchronization, full install, and optional verification are now explicit fingerprinted
plan/apply phases rather than hidden post-write switches. On Linux and macOS, reviewed npm 10/11,
pnpm 10/11, and Bun `>=1.2.0 <2.0.0` adapters use fixed no-shell argv with lifecycle scripts
disabled, exact manager/version and parsed-lockfile evidence, explicit invocation grants, contained
output paths, and observed process termination. Only standard registry-backed semver declarations and `npm:`
aliases can request manager execution; aliases bind the manifest key, registry package identity,
specifier, and resolved version. Unsupported or ambiguous evidence blocks before apply and never
falls back to npm.

Manager and verification work stays inside the stale-safe lock/journal lifecycle. Source and
lockfile bytes recover only while physical identity remains owned; unexpected repository or Git
metadata changes, surviving descendants, lost observation, and incomplete recovery are never
success. Package-manager caches and full install trees are explicitly non-transactional, so any
failure after a manager command starts remains unknown even when planned bytes are restored. Legacy
check-mode install, update, execute, and shell-string verification flags are rejected in favor of
the reviewed plan/apply contract.

#### Honest global updates

Global package writes now run through a versioned, non-transactional state machine. Stable
manager/package/version occurrences bind supported manager, executable, and global-realm evidence;
explicit global-write, process, and exact manager grants are required. Every selected manager is
preflighted before execution, downgrades are blocked, fixed no-shell commands disable lifecycle
scripts, and fresh post-command inventory determines each applied, skipped, conflicted, failed, or
unknown result. Earlier successful items are never described as rolled back after a later failure.

#### Compatibility and passive risk evidence

Immutable plans now include deterministic runtime, exact-owner peer, explicit cohort, release,
maturity, deprecation, completeness, staleness, signature-presence, and provenance-presence signals.
Each signal exposes a stable state and reason, source evidence, and policy effect. Explicit policy
may warn or block without retargeting; inferred cohorts only suggest coordination. Ambiguous
cross-workspace, hoisted, override, missing, or malformed evidence remains unknown. Staleness is
explicitly not applicable until a trustworthy observation timestamp exists. Passive metadata
presence is not artifact or cryptographic verification.

#### Exact-artifact trust verification

Install plans can now fingerprint exact public npm artifacts and one npm 11.12.x verifier unit per
boundary. Apply binds each artifact to the final npm lockfile SHA-512 integrity, installed location,
and physical package identity before running fixed lifecycle-disabled `npm audit signatures` in an
isolated temporary home/cache/config with explicit process, install, artifact-verification, and
network authority. Results retain verifier identity/version, evidence time, and independent
signature/provenance states. npm's aggregate result cannot prove positive signature coverage for an
individual artifact, so positive signatures remain unknown; invalid or missing exact records fail.
Provenance passes only for one verified SLSA v1 DSSE statement with the exact package PURL and
SHA-512 subject digest. Passive presence never passes, raw verifier output is not public, and
fingerprinted rules may warn or block without rewriting truth. Pnpm, Bun, JSR, private registries,
unsupported npm versions, project npm configuration, offline/stale/unavailable verification, and
mechanisms that cannot safely bind the exact artifact remain explicitly unsupported or unknown.

#### One official automation workflow

depfresh 2.0 ships one discoverable automation path. A deterministic
`depfresh.capabilities` schema-v1 document describes the supported commands, result contracts,
exit semantics, invocation-authority requirements, runner priority, packaged assets, and exact npm
artifact-verification boundary. The exported `depfresh/skills/depfresh/*` instructions, recipes,
examples, and `depfresh/schemas/*` assets all use that machine contract. The GitHub Action exposes
the same fixed workflow matrix,
builds one contained argv array, and validates complete results with the exact installed package.
Read-only discovery and inspection remain the default; planning and apply require explicit inputs
and authority, and no official workflow commits, pushes, publishes, or mutates Git state.

#### What remains familiar

The release retains ESM-only distribution, semantic exit codes, workspace and catalog discovery,
protocol-preserving version handling, registry caching through Node's built-in SQLite, and
human/table workflows. Private-registry resolution remains supported; exact artifact trust
verification is deliberately limited to the public npm registry.

#### Release proof

The final local replay used Node.js 24.15.0, pnpm 10.33.0, and isolated npm 11.12.1 state. Frozen
install passed with disposable home, cache, and store directories. The complete coverage run
passed 139 files and 1,456 tests with 87.13% statement and 89.51% line coverage. The focused
release suite passed five files and 84 tests in each of three consecutive final runs. Build
produced 1.57 MB of distribution output. Practical smoke passed 26 checks and 49 mock-registry
requests, including one cold and zero additional warm cache requests.

The final local `depfresh-2.0.0.tgz` candidate contains 53 files, is 263,354 bytes packed and
1,605,924 bytes unpacked, and has integrity
`sha512-+KIBEUCCvIn7H0ksnLkGPMHOWiCKZEWGriOv4Nwu15P9legaK4Ioy6sQ/VIgyLKuwI+gpr1XVJFJkOHP48RnLg==`.
The packed-product verifier installed that exact tarball under isolated state, executed the CLI and
capabilities contract, imported the library, resolved every export, and checked all seven schemas
plus the packaged skill, recipes, and examples. Inspect and plan probes preserved status, staged
and unstaged diffs, and index bytes. Independent adversarial review returned `APPROVED`.

No tag, push, package publication, hosted release, or movable Action tag was created.

## Breaking changes draft

> **DRAFT — retain only changes proven by the final implementation and migration tests.**

### Runtime floor

- Node.js `>=24.15.0` is required.
- The SQLite cache uses the built-in `node:sqlite` module; no native cache addon is distributed.

### Invocation authority

- Configuration may shape policy but cannot grant write, install, update, execute, verification,
  global-write, network-verification, or publishing authority.
- Side effects require explicit authority from the active CLI or library invocation.
- Unknown or malformed arguments fail before discovery or side effects.
- Complete JSON envelopes and human failures redact credential-bearing values, including observed
  write outcomes, before rendering.

### Resolution candidate truth

- Direct, catalog, override, and global occurrences select only from one final eligible set.
- Manifest exact pins, including equals-prefixed and prerelease spellings, require explicit
  `--include-locked`; globally observed exact versions still resolve in default mode.
- Valid rejected `next` tags do not fall back, prerelease channels do not cross, implicit
  downgrades stay blocked, and malformed publish timestamps remain unknown during cooldown checks.

### Physical occurrence and outcome identity

- Repeated dependency names in different files, fields, nested paths, catalogs, or global managers
  are separate occurrences.
- Write results are observed item outcomes: `applied`, `skipped`, `conflicted`, `reverted`,
  `failed`, or `unknown`.
- A requested value is not proof that the physical source reached that value.

### Repository inspection

- `inspectRepository()` uses repository-relative stable identities and exact byte hashes.
- Conflicting manager, lockfile, runtime, workspace, and VCS evidence is not resolved by a silent
  fallback.
- The inspector is read-only and does not resolve registry versions, install dependencies, or alter
  Git state.

### Policy and configuration

- New occurrence policy rules are strict JSON-compatible data. Unknown or authority-shaped fields,
  non-JSON values, duplicate IDs, invalid patterns/enums, and invalid action/mode combinations fail
  configuration loading.
- `mode`, `packageMode`, `include`, and `exclude` remain supported through a compatibility compiler.
  Exact `packageMode` names retain priority, the first matching pattern still wins, include remains
  an allow-list, and later exclude matches win. Legacy `ignore` is translated to exclusion.
- Configuration shapes selection but never grants side-effect authority. `--profile` remains
  runtime telemetry. Versioned global manager/package occurrences evaluate independently through
  the same ordered policy without becoming repository file entities.

### CLI, library, schemas, and legacy JSON

The new inspect/plan machine commands require `--json` (or `--output json`) and use exit `0` for a
complete result with no operation, material risk, block, unknown, or error, `1` for a valid
document with operations, material risks, or non-fatal
blocked/unknown/error decisions, and `2` for a fatal command error. Planning reads only declarative JSON config;
selected JavaScript/TypeScript config fails before evaluation. Positive cooldown planning requires
an explicit canonical UTC `--as-of` instant. Legacy `depfresh --output json` remains a separate
schema-v1 compatibility report with its historical absolute paths, timestamp, formatting,
redaction, and exit behavior; it is not an immutable plan.

Apply accepts the same JSON output selectors, requires explicit `--write` and one `--plan-file`,
and uses exit `0` for `applied` or `noop`, `1` for a schema-valid `conflicted`, `reverted`, `failed`,
or `unknown` result, and `2` for a fatal command error.

### File writes and stale-plan handling

Normal local compatibility writes now delegate to the stale-safe apply engine. Any stale, dirty,
escaped, aliased, hard-linked, or unobservable selected target blocks every replacement in that
apply invocation; callers must re-plan rather than weakening preconditions. Direct
`writePackage()` use is deprecated because it cannot provide the apply lock, journal, recovery, or
observed-result contract. Global updates are a separate versioned state machine because manager
global state cannot join the repository file transaction or support rollback.

### Install, update, execute, verify, and lockfile behavior

Legacy check-mode `--install`, `--update`, `--execute`, `--verify-command`, and
`--strict-post-write` are rejected. Manager execution belongs to one immutable plan and matching
apply invocation: choose exactly one of lockfile-only sync or full install, optionally fingerprint
one exact JSON argv for verification, then repeat only the corresponding apply grants.
Configuration cannot grant process, lockfile, install, or verification authority.

Supported Linux/macOS adapters are npm 10/11 with `package-lock.json` or
`npm-shrinkwrap.json`, pnpm 10/11 with `pnpm-lock.yaml`, and Bun `>=1.2.0 <2.0.0` with text
`bun.lock`. Commands are fixed no-shell argv with lifecycle scripts disabled. Manager execution
supports only direct registry-backed `semver` and `npm:` alias occurrences in standard dependency
fields. Yarn, legacy `bun.lockb`, Windows manager execution, ambiguous/mismatched manager or
lockfile evidence, and unsupported protocols block without npm fallback. Lockfile/source recovery
is identity-bound; install trees and manager caches remain explicit non-transactional effects.

### Global operations

The unsafe direct `writeGlobalPackage()` root export is removed. `loadGlobalPackages()` and
`loadGlobalPackagesAll()` now return asynchronous observed manager evidence instead of synchronous
empty-on-error package projections. Library mutation uses `createGlobalApplyPlan()`,
`createGlobalInvocationAuthority()`, and `applyGlobalPlan()`. Legacy CLI global writes remain
available but require explicit `--write`, run fixed lifecycle-disabled argv, and can return honest
partial or unknown global results.

### Compatibility and trust semantics

The schema-v1 plan extension now fingerprints deterministic compatibility, coordination, release,
maturity, deprecation, completeness, staleness, and passive trust-presence signals. Unknown never
becomes pass, inferred cohorts never block, and rules change only traced effects. Exact artifact
verification is a separate optional install phase: public npm artifacts require npm 11.12.x, final
lockfile SHA-512 and installed-location binding, isolated fixed verifier execution, and explicit
artifact/network authority. Signature/provenance results are independent; positive per-artifact
signature coverage remains unknown, while provenance passes only for an exact verified SLSA v1
subject/digest. Consumers must distinguish plan signals from apply `artifactResults` and must not
interpret passive presence, unavailable verification, or policy overrides as trust proof.

### Automation and distribution

- Automation should discover supported behavior through `depfresh capabilities --json` and
  validate the schema-v1 document instead of inferring features from help text.
- Official automation uses a locked local `pnpm exec` runner first, then exact-version `npm exec`;
  the packaged recipes preserve one argument array and do not enable shell interpolation.
- The GitHub Action accepts only `check`, `capabilities`, `inspect`, `plan`, or `apply`. Plan/apply
  inputs are command-specific, plan files must be contained regular non-symlink files, and apply
  authority is never inferred from configuration.
- Packaged automation assets are exported at stable `depfresh/skills/depfresh/*` and
  `depfresh/schemas/*` subpaths.

## Migration guide draft

> **DRAFT — commands and schema names below must match the final packaged release.**

1. Upgrade the runtime to Node.js `>=24.15.0` and verify `node --version` in local development and
   every CI runner.
2. Keep existing 1.x automation pinned while evaluating 2.0. Do not move an Action major tag before
   the exact `2.0.0` package is published and verified.
3. Run the final capability-discovery command:

   ```text
   depfresh capabilities --json
   ```

4. Perform a read-only repository inspection and review every ambiguous, missing, unsupported, and
   unavailable evidence conclusion:

   ```text
   depfresh inspect --json
   ```

5. Translate legacy `include`, `exclude`, mode, and `packageMode` behavior using the verified Plan
   017 compatibility mapping:

   ```typescript
   export default defineConfig({
     mode: 'latest',
     policyRules: [
       {
         id: 'native-catalog-minor',
         selectors: { catalogName: 'native' },
         mode: 'minor',
       },
       {
         id: 'legacy-app-exclude',
         selectors: { workspacePath: 'apps/legacy' },
         action: 'exclude',
       },
     ],
   })
   ```

6. Create a read-only dependency plan and validate its schema and fingerprint before considering
   side effects:

   ```text
   depfresh plan --json
   ```

7. Replace legacy direct-write or post-write automation only according to the final Plans 019–020
   migration contract:

   ```text
   depfresh plan --json --sync-lockfile \
     --verify-argv '["pnpm","test"]' > depfresh-plan.json
   depfresh apply --json --write --sync-lockfile --verify \
     --plan-file depfresh-plan.json
   ```

8. Migrate global-update automation to the verified Plan 021 state-machine contract:

   ```text
   depfresh --global-all --write --output json
   ```

   Parse `globalResults[].items`; treat only observed `applied` or `skipped` items as complete, and
   re-inventory/re-plan every conflicted, failed, or unknown item.

9. Update parsers for the final schema and exit-code contracts. Preserve the documented legacy JSON
   adapter only for the compatibility window established by Plan 018.
10. Review compatibility and trust output using the final Plans 022–023 definitions. Do not treat
    missing evidence, passive metadata, unavailable verification, or an override as proof of safety.
11. Run the final sanitized workflow from the packaged Plan 024 recipe before enabling writes in CI.
12. Re-plan whenever repository identity, source bytes, expected occurrence values, lockfiles,
    runtime evidence, or target VCS state has changed.

## Exact release-readiness checklist

Every checkbox is required unless a numbered plan records the item as explicitly unsupported and
the release documentation states that limitation without suggesting otherwise.

### Plan and version gates

- [x] Plans 011, 012, and 013 have passed their blocked verification replay and are marked `DONE`.
- [x] Plans 014 and 015 remain `DONE` with no regression in their completion evidence.
- [x] Plans 016, 017, 018, 019, 020, 021, 022, 023, and 024 are marked `DONE`.
- [x] Every plan has a concise completion record, exact commands, results, and remaining limits.
- [x] `plans/README.md` contains no open or verification-blocked numbered plan.
- [x] The version remained `1.2.0` until all preceding items were true.
- [x] The release-preparation commit changes the package version exactly once to `2.0.0`.
- [x] CLI version, capability version, Action-coupled version, package metadata, every generated
  artifact that carries the package version, changelog heading, and required release-tag shape
  agree exactly.

### Clean installation and static gates

- [x] Start from a tracked-clean checkout while preserving the required untracked `.superpowers/`
  scratch directory; use no user cache.
- [x] `pnpm install --frozen-lockfile` passes.
- [x] `pnpm typecheck` passes.
- [x] `pnpm lint` passes with zero warnings and no obsolete suppressions.
- [x] `git diff --check` passes.

### Test and build gates

- [x] Every focused adversarial suite named by Plans 011–024 passes using the commands recorded in
  those plans' completion records.
- [x] `pnpm test:run` passes with no ABI-dependent, environment-hiding, or unexplained skips.
- [x] Coverage completes without racing a build or clean step.
- [x] `pnpm build` passes.
- [x] `pnpm test:smoke` passes.
- [x] All schema conformance, canonical JSON, fingerprint, capability, Action, recovery, manager,
  trust-adapter, and packaged-workflow fixtures pass.

### Exact Node 24.15.0 gates

- [x] Frozen install, focused contract tests, built CLI, and built library import pass on exact Node
  24.15.0.
- [x] The built CLI reports exactly `2.0.0` with no unexpected stderr.
- [x] The library imports every documented public API and type entry point.
- [x] Read-only inspection is deterministic across processes, enumeration order, and different
  absolute repository roots.

### Distribution gates

- [x] `npm pack --dry-run --json` succeeds and its manifest is archived as release evidence.
- [x] The package contains every documented CLI, declaration file, JSON Schema, capability asset,
  skill, recipe, and example.
- [x] The package excludes plans, scratch files, tests, caches, credentials, temporary files, and
  repository-internal design authority.
- [x] Built output keeps `node:sqlite` as a built-in import and contains no obsolete native cache
  dependency or native build graph.
- [x] Every documented package export resolves from the packed tarball, not only from the source
  checkout.
- [x] The packed CLI and library work from a new temporary project on exact Node 24.15.0.

### Runtime and side-effect gates

- [x] A temporary-HOME cold/warm CLI probe proves persistent cache reuse without using the real user
  cache.
- [x] Read-only inspect performs no registry request, package-manager command, lifecycle execution,
  write, or Git mutation.
- [x] Read-only plan performs only the documented registry/network work and performs no writes or
  manager commands.
- [x] Every stale, dirty, escaped, ambiguous, insufficient-authority, failed-recovery, and unknown
  adversarial case blocks or reports exactly as documented.
- [x] Lockfile synchronization and verification change only the permitted paths and recover exactly
  where the final contract promises recovery.
- [x] Global partial failures remain visible and never claim rollback.
- [x] Trust verification binds to exact artifacts and keeps presence, verification, unavailable,
  unsupported, and error states separate.

### Release workflow gates

- [x] The release workflow rejects any tag other than `v${package.json.version}`.
- [x] The release workflow includes an exact Node 24.15.0 verification lane.
- [x] Every workflow action and publishing tool is pinned to a reviewed immutable version.
- [x] The workflow runs frozen install, typecheck, lint, adversarial tests, full tests, build, smoke,
  package dry-run, schema validation, and packed-artifact inspection before publishing.
- [x] The curated announcement is supplied to the hosted release instead of relying only on
  generated notes.
- [x] The release workflow requires exact published-package integrity and installed-product
  verification before any separately authorized movable Action tag could be created or updated.
- [x] Publishing, hosted release creation, and Action-tag movement remain manual authorization
  boundaries even after this checklist is green.

## Repository-wide documentation audit checklist

### Product and repository truth

- [x] `README.md` leads with the verified 2.0 workflow and contains no roadmap claims.
- [x] `CHANGELOG.md` has a dated `2.0.0` release-candidate entry and leaves historical entries intact.
- [x] `package.json` description, keywords, engines, exports, files, scripts, and version match the
  packed product.
- [x] `AGENTS.md` describes the real architecture, authority boundaries, evidence model, policy,
  apply phases, and review invariants.
- [x] `CONTRIBUTING.md` uses the exact Node floor, current paths, current test layout, and complete
  verification commands.
- [x] `SECURITY.md` lists the actual supported versions and accurately describes process, network,
  registry-token, file-write, VCS, lockfile, global-operation, and trust boundaries.
- [x] `build.config.ts` and package file rules ship every documented public asset and nothing else.
- [x] The broad design document `depfresh-agent.md` is demoted or replaced by the single operational
  authority defined by Plan 024.

### Documentation index and API

- [x] `docs/README.md` links every current public contract and no removed or draft surface.
- [x] `docs/api/README.md` reflects every public entry point.
- [x] `docs/api/overview.md` uses current authority and workflow examples.
- [x] `docs/api/functions.md` matches generated declarations and real return/error behavior.
- [x] `docs/api/types.md` lists every public schema/model/evidence/policy/plan/apply/signal/trust type.
- [x] `docs/api/errors.md` lists stable codes, reasons, redaction, retryability, and phase errors.
- [x] `docs/api/repository-model.md` documents identities, evidence, ambiguity, boundaries,
  lockfiles, runtime declarations, VCS state, and limitations.
- [x] Final schema and fingerprint documentation names the exact packaged paths and compatibility
  rules.

### CLI, configuration, and output

- [x] `docs/cli/README.md`, `docs/cli/flags.md`, `docs/cli/examples.md`, and `docs/cli/modes.md` match
  `--help`, capability output, exit codes, and tested examples.
- [x] `docs/configuration/README.md`, `docs/configuration/files.md`,
  `docs/configuration/options.md`, and `docs/configuration/workspaces.md` match the final policy
  compiler, invocation-only authority, selectors, workspace boundaries, catalogs, and migration
  warnings.
- [x] `docs/output-formats/README.md`, `docs/output-formats/json.md`, and
  `docs/output-formats/table.md` clearly distinguish legacy JSON, inspect, plan, apply, human output,
  and shipped JSON Schemas.
- [x] Every JSON example validates against its packaged schema.
- [x] Every human-output example is regenerated from the built CLI.

### Automation, integrations, and operations

- [x] `docs/agents/README.md` uses only public packaged commands and the final authority model.
- [x] `docs/integrations/README.md` contains pinned, sanitized, executable examples.
- [x] `docs/integrations/github-action.md` matches the final `action.yml` inputs, outputs,
  capabilities, version coupling, permissions, and release order.
- [x] `docs/troubleshooting.md` covers evidence ambiguity, stale plans, dirty targets, locks,
  recovery, manager mismatch, lockfile drift, partial global results, offline trust verification,
  and unavailable state.
- [x] `docs/compare/README.md`, `docs/compare/from-taze.md`,
  `docs/compare/integration-testing.md`, `docs/compare/solved-issues.md`, and
  `docs/compare/coverage-matrix.md` retain dated evidence and do not upgrade historical claims
  without a fresh audit.

### Repository collaboration and workflows

- [x] `.github/ISSUE_TEMPLATE/bug_report.yml` uses a current version placeholder, requests the
  relevant invocation/schema/capability context, and warns users to sanitize secrets and paths.
- [x] `.github/ISSUE_TEMPLATE/feature_request.yml` asks for the problem, proposed public contract,
  authority needs, and alternatives without promising roadmap inclusion.
- [x] `.github/PULL_REQUEST_TEMPLATE.md` requires tests, types, lint, documentation, schema/package
  review, authority review, and adversarial evidence where relevant.
- [x] `action.yml` advertises only implemented inputs, outputs, commands, and capabilities.
- [x] `.github/workflows/ci.yml` retains an exact Node 24.15.0 lane and validates packaged assets.
- [x] `.github/workflows/pr-validation.yml` covers the final static, test, build, and package gates.
- [x] `.github/workflows/dependency-freshness.yml` uses a reviewed exact local or package version,
  never a floating runner.
- [x] `.github/workflows/release.yml` implements every release-workflow gate above.

### Language and claims

- [x] All code, documentation, examples, diagnostics, and commit messages are English.
- [x] No unfinished feature is described in present or past tense.
- [x] No passive metadata is described as verified trust.
- [x] No file phase, lockfile phase, or global phase is described as repository-wide transactional.
- [x] No configuration source is described as granting side-effect authority.
- [x] No test count, package size, supported manager, supported verifier, schema version, or command
  is copied from an earlier run without a final release replay.
- [x] No example contains credentials, private registry URLs, real user paths, or unsanitized output.
- [x] No release, deployment, publication, or hosted-provider outcome is claimed from local evidence.

## Finalization record

1. Plans 011–024 are `DONE` with completion records and sequential commits.
2. Current documentation and the curated release note were checked against built and packed 2.0.0
   behavior.
3. The release-preparation commit changed the version once and supplied the immutable Action anchor.
4. A retained RED/GREEN test then pinned every shipped and documented Action example to that exact
   commit.
5. Work stops after the final preparation commit. Tagging, pushing, publishing, hosted release
   creation, or moving an Action tag requires separate explicit authority.
