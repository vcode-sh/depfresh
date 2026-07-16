# Plan 023: Artifact trust and native verification

## Contract

- **Priority**: P2
- **Effort**: L
- **Risk**: CRITICAL
- **Depends on**: 020, 022
- **Planned at**: `8eea9c5` plus completed plan 009, 2026-07-15
- **Status**: DONE

## Objective

Verify selected package artifacts with narrowly scoped official registry/package-manager mechanisms
and represent signature and provenance results without conflating presence, verification, or
unavailability. Integrate results into plan risk and optional apply gates under explicit authority.

## Trust states

Track independently:

- signature metadata presence;
- signature verification result;
- provenance/attestation metadata presence;
- provenance verification result;
- verifier identity/version, artifact identity/integrity, evidence time, and failure reason.

Verification states use the shared signal vocabulary. `unknown` and `unavailable` are not pass.

## Owned files

- artifact identity/integrity and verified-trust types
- official registry/verifier adapters with network/process boundaries
- plan/apply verification phase and schema extensions
- manager-native audit/check adapters selected from documented capabilities
- trust/security docs, deterministic fixtures, and `CHANGELOG.md`

Do not implement a custom cryptographic protocol, execute lifecycle scripts, infer trust from
popularity, or turn every warning into an unconditional block.

## Implementation tasks

1. Research and record the exact official verification contract for each supported registry/manager,
   including version, required artifact data, exit codes, network behavior, and limitations.
2. Add fixtures for valid, invalid, absent, expired/stale, unsupported, offline, tool-missing, and
   verifier-error results without contacting live services in the normal test suite.
3. Bind verification to the exact planned artifact/version/integrity; never verify only a package
   name or mutable tag.
4. Execute external verifiers only with explicit network/process capability, fixed argv, timeout,
   sanitized environment, and redacted diagnostics.
5. Record verifier evidence separately for signatures and provenance, preserving unknown states.
6. Add optional manager-native compatibility/audit checks with accurately scoped capabilities and
   observed results after lockfile synchronization.
7. Integrate policy gates and overrides through traceable rule IDs; default behavior must match the
   documented evidence strength.
8. Document threat model, freshness, offline behavior, and what remains unverified.

## Acceptance evidence

- verified results bind to exact artifacts and record verifier identity/version;
- presence alone never yields pass;
- offline/tool-missing/unsupported/error remain distinct;
- command/network capability is least-privilege and never config-derived;
- no secrets appear in errors or evidence;
- deterministic adapter tests, integration smoke, and all repository gates pass.

## STOP conditions

Stop if an official mechanism cannot bind evidence to the exact artifact, requires unsafe lifecycle
execution, or has semantics too weak for the documented claim. Mark it unsupported.

## Completion record

### Delivered contract

- Immutable install plans can fingerprint exact public npm artifacts and one verifier unit per
  affected boundary. Each physical artifact ID binds package name, exact version, canonical public
  registry URL, and exact 64-byte SHA-512 integrity; occurrence consumers and passive signature or
  provenance presence remain separate fingerprinted evidence.
- The supported verifier is npm `>=11.12.0 <12.0.0` with fixed
  `audit signatures --json --include-attestations --ignore-scripts` argv. Apply reuses the
  preflight-pinned executable after install and rebinds every target to the final
  `package-lock.json` or `npm-shrinkwrap.json`, exact integrity, installed location, contained
  non-symlink directory, and exact package manifest identity.
- Verification runs with a private `0700` home/cache, empty `0600` user/global npm configuration,
  fixed public registry, fixed timeout, no lifecycle scripts, and separate bounded stdout/stderr.
  Raw output, attestation bundles, credentials, and stacks never enter the public result.
- Signature and provenance results are independent. Exact invalid or missing signature records
  fail; npm does not expose safe positive per-artifact signature coverage, so signatures never
  pass. Provenance passes only for one verified SLSA provenance v1 DSSE in-toto statement whose
  exact package PURL and SHA-512 subject digest match the planned artifact.
- Offline, stale-key, verifier-error, unavailable, artifact-mismatch, missing, invalid, and
  not-present states retain stable reasons. Fail/unknown warns by default. Only an immutable
  fingerprinted matching rule may block, and every result retains matched and winning rule IDs.
- `verifyArtifacts` is invocation-only. A ready plan requires `artifact-verify` and
  `network-access`; apply requires the matching process, install, artifact, and network authority.
  Configuration and plan data never grant those capabilities.

### Adversarial and review evidence

- RED/GREEN tests cover exact valid provenance, invalid and missing signatures, invalid
  provenance, absent provenance, wrong package/version/location/digest/statement type, duplicate
  records, multiple installed locations, wrong lockfile integrity, nested boundaries,
  workspace-local installs, shrinkwrap, symlink escape, malformed and oversized output, offline,
  stale, unavailable, verifier error, missing authority, warning and blocking policy, recovery, and
  private bounded process capture.
- Semantic-forgery tests reject changed integrity or passive presence, split/reordered physical
  groups, arbitrary artifact IDs, incomplete occurrence coverage, impossible apply evidence,
  missing install/verifier commands, and trust claims inconsistent with timeout, unavailable, or
  nonstandard exit evidence. Retained safety-failure results remain schema-valid.
- Independent contract, runtime, adversarial, and documentation reviewers inspected the full diff.
  All validated nested-boundary, apply-forgery, shrinkwrap/workspace-layout, recovery-evidence, and
  termination/trust-consistency findings were fixed with retained tests. Final code and docs
  re-reviews returned `APPROVED` with no remaining Critical or Important finding.

### Verification

- Exact Node `24.15.0` and pnpm `10.33.0` passed a temporary-HOME/store frozen install of 210
  packages. The first isolated noninteractive replay reproduced pnpm's expected
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` store-relink prompt; setting `CI=1` resolved that
  environment prerequisite without changing the lockfile or using the user cache.
- Exact Node passed `pnpm typecheck`, `pnpm schemas:check`, `pnpm lint`, strict
  `biome check --error-on-warnings .`, and `git diff --check`; Biome checked 292 files with zero
  warnings. The 12-file, 216-test focused suite passed three consecutive runs. The full suite
  passed 133 files and 1,397 tests.
- Exact Node built 41 `dist` files totaling about 1.51 MB. `node:sqlite` remained external and
  `better-sqlite3` was absent. The practical built-CLI smoke passed 26 checks and 49 mock-registry
  requests, including one cold and zero additional warm cache requests under an isolated HOME.
- npm package dry-run reported `depfresh@1.2.0`, 44 files, 249,386 packed bytes, and 1,533,431
  unpacked bytes. An actual tarball installed in an isolated exact-Node consumer; root library
  authority/validator exports, the apply schema subpath, and the built CLI version passed.
- Built `inspect` preserved status, tracked diff, staged diff, and index hashes exactly:
  `3397af33c1617307614d0da12a6323f8cdb933b876fb1bf1f0e67877865f0c84`,
  `0b7b08e84ca6963b4585a320f89cc918ffb13fc6d951a2f4718dbb7f1c7c4eb8`,
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, and
  `775f88b26b67a2c4fc9ba89b0410eb39543a637063d8374f2ae3f3352f0ec232`.

### Remaining limitations

- Exact artifact verification is unsupported for pnpm, Bun, JSR, private registries, npm versions
  outside 11.12.x, missing canonical SHA-512 integrity, and broader native compatibility/audit
  claims. These requests block planning rather than weakening the verification claim.
- A project `.npmrc` makes apply-time verification unavailable rather than allowing project
  credentials or registry routing into the isolated verifier. Offline and stale evidence remains
  unknown and must be retried after the environment or upstream evidence changes.
- Final lockfile integrity plus contained package manifest/location binds npm's official result to
  the selected install, but does not independently hash every extracted `node_modules` byte.
- npm's aggregate signature result cannot prove a positive signature for one artifact. Provenance
  is the only positive trust result and requires the exact verified DSSE subject/digest described
  above. Install trees and manager caches remain non-transactional external effects.
