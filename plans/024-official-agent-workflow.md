# Plan 024: Official workflow and distribution

## Contract

- **Priority**: P2
- **Effort**: M
- **Risk**: MEDIUM
- **Depends on**: 010, 018, 019, 020, 021, 022, 023
- **Planned at**: `8eea9c5` plus completed plan 009, 2026-07-15
- **Status**: DONE

## Objective

Package the stable inspect, plan, apply, sync, verify, and global contracts into one discoverable,
versioned workflow. Ship schema-backed capabilities, a concise first-party operational skill, pinned
runner recipes, sanitized examples, and complete package artifacts without duplicating product logic.

## Workflow contract

1. Discover installed tool/schema/capability versions.
2. Inspect read-only, then create a reviewable immutable plan.
3. Summarize selected, skipped, blocked, unknown, compatibility, and trust decisions.
4. Request only the capabilities needed for chosen phases.
5. Apply the exact plan; stale/dirty conflicts require re-plan.
6. Synchronize and verify only when explicitly authorized.
7. Compare machine results with observed files/global inventory.
8. Report local evidence separately from CI/provider/production evidence.
9. Never infer Git, publishing, merge, or deployment authority.

## Owned files

- `src/cli/capabilities.ts`, help/capabilities schema and feature registries
- `skills/depfresh/SKILL.md` plus small package-owned recipes/examples
- `docs/agents`, README entry points, sanitized end-to-end examples
- package/build files required to ship schemas and skill assets
- `action.yml` only for integration with stable contracts established by plan 010
- migration/demotion of `depfresh-agent.md` as competing authority

Adapters/servers, editor integrations, NDJSON, SARIF, dashboards, automatic Git/PR operations, and
new policy/write logic are out of scope.

## Implementation tasks

1. Inventory every published command, capability, schema, runner example, Action path, package file,
   and broad design document. Remove aspirational claims from live capability output.
2. Generate a versioned deterministic capabilities document from real command/schema/selector/
   manager/signal/apply registries; omit volatile generation time from the stable descriptor.
3. Author a concise operational skill using only public commands/schemas. Keep manager-specific
   details in small referenced recipes.
4. Document runner priority: repository-local locked version, otherwise an exact approved package
   version. Verify argument forwarding for each documented runner.
5. Add complete sanitized examples: read-only audit; broad latest plus `native` catalog minor cap;
   plan review and authorized apply; stale-plan re-plan; trust warning review; CI read-only gate;
   opt-in protected CI apply.
6. Integrate the hardened Action with machine-readable plan/apply outputs and explicit capabilities
   without reintroducing floating versions or unsafe inputs.
7. Replace the broad design document with a short pointer or migrate unique rationale to current
   docs so there is one operational authority.
8. Ensure package dry-run includes schemas, skill, recipes, and examples but excludes ignored plans.

## Acceptance evidence

- capabilities output is schema-valid, deterministic, and matches registered features;
- every skill/example command executes against sanitized fixtures with documented exit codes;
- the WUN-style catalog workflow passes inspect through observed apply;
- insufficient authority and stale plan block safely;
- packed artifact contains every documented public asset and no planning files;
- Action coupling/input guarantees from plan 010 remain intact;
- end-to-end smoke and all repository gates pass without publishing.

## STOP conditions

Stop if documentation would depend on source internals, an unshipped schema/feature, an unpinned
runner, or a second policy/write implementation. Stabilize the core contract first.

## Completion record

### Delivered contract

- `depfresh capabilities --json` now emits a deterministic `depfresh.capabilities` schema-v1
  descriptor with no clock/path/environment fields. It is generated from the CLI args, contract
  schema paths, exported policy/signal selectors, signal vocabularies, apply phase order, shared
  manager support, and the shared npm artifact-verifier support constant. The descriptor includes
  accurate legacy/machine exit semantics, invocation authority, runner priority, workflows, and
  every packaged public asset.
- `schemas/capabilities-v1.json` is generated, built, exported, and backed by the public
  `capabilitiesSchema` and `validateCapabilities()` library exports. All six earlier contract
  schemas remain exported.
- `skills/depfresh/SKILL.md` is the single operational authority. Packaged recipes cover locked
  local versus exact approved runners, manager phases, and CI. Packaged examples cover read-only
  audit, broad latest plus `native` catalog minor policy, immutable review/apply, stale re-plan,
  trust review, read-only CI artifact handoff, and exact-ref/digest environment-protected apply.
  Every asset has an explicit package export.
- The composite Action preserves legacy check defaults and adds one-command capabilities, inspect,
  plan, and apply workflows. It rejects unsafe input matrices before installation, contains and
  validates regular non-symlink plan files, exposes only fixed phase grants, constructs argument
  arrays, imports semantic validators from the exact verified installed module, rejects partial or
  contract/exit-inconsistent results, keeps raw diagnostics private, and cleans temporary files.
- `depfresh-agent.md` is now a short supersession pointer. Current README, agent, integration,
  Action, and changelog documentation use the public workflow and do not infer Git, PR, publish,
  release, or deployment authority.

### Adversarial and review evidence

- Retained RED/GREEN evidence covers the former nondeterministic timestamp, absent capabilities
  schema/registry/assets, unsafe baseline agent assumptions, partial Action result acceptance,
  escaping/symlinked plan inputs, conflicting or config-shaped authority, shell/option injection,
  contract/exit mismatch, runner argv forwarding, and incomplete protected-apply ownership/ref/run/
  digest binding.
- The WUN-style Bun fixture passed inspect, broad latest planning with only the physical `native`
  catalog owner capped at minor, explanatory consumers, direct same-name latest, observed file-only
  apply, consumer byte preservation, insufficient-authority rejection, and stale-plan conflict.
- Independent skill and full-diff reviewers reproduced hostile workflow paths, package resolution,
  Action installed-validator discovery, registry parity, exit semantics, artifact-verifier limits,
  and package contents. Every validated finding was fixed and both final re-reviews returned
  `APPROVED` with no Critical or Important finding.

### Package and runner evidence

- Runner priority is repository-local only when an exact depfresh dependency is resolved by the
  committed lockfile, otherwise exact approved
  `npm exec --yes --package=depfresh@<version> -- depfresh`. Shell-array tests preserved exact argv
  through version and capabilities calls.
- Exact Node `24.15.0` built a 1.56 MB distribution. npm dry-run and real pack contained 54 files,
  including seven schemas and all nine advertised workflow assets, while excluding `plans/`,
  `.superpowers/`, source, and tests. An isolated exact-Node consumer validated capabilities,
  resolved every advertised asset through package exports, loaded the skill, and ran the built CLI.

### Verification

- Exact Node `24.15.0` and pnpm `10.33.0` passed a frozen install of 210 packages with temporary
  HOME, cache, and store paths; package dependencies and the lockfile were unchanged.
- Exact Node passed schema generation/check, typecheck, lint, strict zero-warning Biome over 298
  files, and `git diff --check`. The five-file Plan 024 suite passed 85 tests three consecutive
  times. The final full suite passed 136 files and 1,422 tests.
- The practical built CLI smoke passed 26 checks and 49 mock-registry requests under an isolated
  HOME. One earlier replay conservatively exited 2 when a global npm post-write inventory probe was
  unknown; the isolated replay passed, matching the already-characterized process-contention
  behavior without weakening unknown-state handling.

### Remaining limitations

- The Action intentionally does not expose arbitrary argv or exact verification argv. Consumers
  needing `--verify-argv` must use a pinned CLI argument array and review that intent before apply.
- A distributable workflow cannot self-pin to its not-yet-created release commit. Packaged Action
  templates retain an explicit `REPLACE_WITH_FULL_COMMIT_SHA` gate and are not safe to enable until
  an authorized release produces a reviewed immutable Action commit/package pair. No tag or
  package publication occurred.
- Artifact verification remains limited to npm `>=11.12.0 <12.0.0`, the public npm registry, and
  exact SHA-512 evidence. Unsupported manager/version/registry/integrity states block rather than
  weakening the claim.
