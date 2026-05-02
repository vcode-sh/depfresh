# depfresh Agent Mode Execution Plan

## Goal

Build a first-class machine contract for dependency checks, writes, installs, and CI
automation. The current JSON output is useful, but it is still a compact report. Agent
mode should expose the full decision model so automated tools can understand what was
checked, what was skipped, what will be written, what changed on disk, which follow-up
commands are required, and which risks need human review.

The end state is a stable, documented, schema-validated agent interface that supports
both one-shot JSON and streaming NDJSON without weakening the existing human table output.

## Current State

- `--output json` emits a single JSON envelope with `packages`, `errors`, `summary`,
  `meta`, and optional `discovery` / `profile`.
- `--help-json` and `depfresh capabilities --json` expose a machine-readable CLI contract.
- Resolver enrichment already computes fields that JSON output does not expose yet:
  `latestVersion`, `provenance`, `currentProvenance`, `nodeCompat`, and
  `nodeCompatible`.
- Skip decisions are mostly implicit. Some dependencies are never represented in output
  because they are filtered during parsing or resolution.
- Write planning is implicit. The JSON report shows updates, but it does not explicitly
  map each planned mutation to a file, section, old value, and new value.
- Lockfile synchronization is implicit. A manifest/catalog write may require a later
  package manager command, but current JSON does not model that requirement.
- JSON output cannot currently be combined with `--write --install`, `--write --update`,
  or `--write --execute`.

## Design Principles

- Keep existing `--output json` backward compatible until a major contract bump is
  intentionally released.
- Make agent output complete enough that a tool never has to parse table output, debug
  logs, or infer missing decisions from absence.
- Prefer explicit decision records over compact summaries.
- Keep every agent-facing enum stable and documented.
- Treat skipped dependencies as first-class facts, not missing data.
- Separate intent, plan, execution, and follow-up status.
- Make CI behavior deterministic and easy to map to job status.
- Do not require registry or install side effects just to generate a write plan.
- Preserve the existing table UX for humans.

## Proposed CLI Surface

### Agent JSON

```bash
depfresh --agent
depfresh --agent --mode major
depfresh --agent --include "vite,vitest"
depfresh --agent --explain-discovery --profile
```

`--agent` should emit a single JSON document and force silent runtime logging. It should
not be an alias for the existing JSON v1 envelope. It should be a new schema with a new
contract version.

### Agent Plan

```bash
depfresh --agent --plan
depfresh --agent --plan --mode minor
```

`--plan` should include all planned write mutations and post-write recommendations
without writing files.

### Agent Write

```bash
depfresh --agent --write
depfresh --agent --write --verify-command "pnpm test"
```

`--agent --write` should emit the same document shape as check/plan mode, with execution
status populated for attempted writes.

### Agent Write With Install Or Update

```bash
depfresh --agent --write --install
depfresh --agent --write --update
```

Agent mode should allow post-write install/update and represent post-write command output
as structured status. This fixes the current JSON v1 limitation where JSON output is
blocked with install/update.

### Agent Stream

```bash
depfresh --agent --stream
depfresh --agent --stream --write --install
```

`--stream` should emit newline-delimited JSON events. It is useful for large monorepos,
CI logs, and long-running updates where a caller wants progress without parsing ANSI
progress bars.

### Agent CI

```bash
depfresh --agent --ci
depfresh --agent --ci --mode minor
depfresh --agent --ci --write --install --strict-post-write
```

`--ci` should select deterministic defaults for automation:

- no interactive prompts
- no table rendering
- no progress bars
- strict machine-readable errors
- stable exit semantics
- optional policy thresholds in later phases

## CLI Flag Additions

Add these flags to `src/cli/args-schema.ts`:

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--agent` | boolean | `false` | Emit the agent JSON contract instead of table output. |
| `--plan` | boolean | `false` | Build a write/post-write plan without writing files. Only meaningful with `--agent`. |
| `--stream` | boolean | `false` | Emit NDJSON events. Only meaningful with `--agent`. |
| `--ci` | boolean | `false` | Use CI-safe machine defaults and stable exit semantics. |
| `--agent-schema` | boolean | `false` | Print the bundled agent JSON schema and exit. |

Validation rules:

- `--stream` requires `--agent`.
- `--plan` requires `--agent`.
- `--agent-schema` should not require a project.
- `--interactive` conflicts with `--agent`.
- `--output json` conflicts with `--agent` to avoid ambiguous contracts.
- `--agent --write --install` and `--agent --write --update` are allowed.
- Existing `--output json --write --install` stays rejected for JSON v1 compatibility.

## Agent Contract Overview

Target schema file:

```text
schemas/depfresh-agent-v1.schema.json
```

Target TypeScript types:

```text
src/commands/check/agent/types.ts
```

Top-level shape:

```json
{
  "schema": {
    "name": "depfresh-agent",
    "version": 1
  },
  "run": {},
  "environment": {},
  "configuration": {},
  "discovery": {},
  "dependencies": [],
  "updates": [],
  "writePlan": [],
  "execution": {},
  "risks": [],
  "actions": [],
  "summary": {},
  "errors": []
}
```

## Required Top-Level Sections

### `schema`

Fields:

- `name`: fixed string, `depfresh-agent`
- `version`: number, starts at `1`

### `run`

Fields:

- `id`: stable unique id for the run
- `startedAt`: ISO timestamp
- `endedAt`: ISO timestamp, set when complete
- `durationMs`: total runtime
- `cwd`: requested cwd
- `effectiveRoot`: resolved project root
- `mode`: selected range mode
- `intent`: `check | plan | write | ci`
- `stream`: boolean
- `status`: `clean | outdated | planned | applied | partial | failed`

### `environment`

Fields:

- `nodeVersion`
- `platform`
- `arch`
- `packageManager`: detected package manager for post-write operations
- `lockfiles`: detected lockfiles with path and manager
- `isTTY`
- `ci`: boolean

### `configuration`

Fields:

- normalized options that affect discovery, parsing, resolution, writes, and policy
- include/exclude patterns
- enabled dependency fields
- cache policy
- cooldown
- package modes
- global/global-all status

Do not include secrets, auth tokens, npm registry passwords, or raw `.npmrc` auth lines.

### `discovery`

Fields:

- `inputCwd`
- `effectiveRoot`
- `mode`: `direct-root | inside-project | parent-folder`
- `matchedManifests`
- `loadedPackages`
- `loadedCatalogs`
- `skippedManifests`
- `workspaceBoundaries`
- `globalTargets`

Each skipped manifest must include a machine reason:

```json
{
  "path": "/repo/vendor/package.json",
  "reason": "nested-workspace",
  "details": "Skipped because ignoreOtherWorkspaces is enabled."
}
```

### `dependencies`

Every discovered dependency candidate should appear here, including skipped candidates.

Required fields:

- `id`: deterministic id, for example `packagePath:source:name`
- `packageName`
- `packagePath`
- `packageType`
- `name`
- `aliasName`
- `source`
- `parents`
- `rawVersion`
- `normalizedVersion`
- `protocol`
- `manager`
- `decision`
- `skipReason`
- `resolutionStatus`
- `registry`
- `cache`

Allowed `decision` values:

- `checked`
- `skipped`
- `updateAvailable`
- `upToDate`
- `failed`
- `writePlanned`
- `written`
- `reverted`

Allowed `skipReason` values:

- `none`
- `field-disabled`
- `peer-disabled`
- `catalog-protocol`
- `workspace-protocol-disabled`
- `workspace-versionless`
- `private-workspace`
- `locked-version`
- `dist-tag-version`
- `unsupported-github-ref`
- `unsupported-protocol`
- `include-filter`
- `exclude-filter`
- `package-mode-ignore`
- `no-compatible-target`
- `deprecated-target-filtered`
- `prerelease-channel-filtered`
- `cooldown-filtered`
- `registry-error`

### `updates`

Each available update should include:

- `dependencyId`
- `name`
- `current`
- `target`
- `currentClean`
- `targetClean`
- `diff`
- `source`
- `packageName`
- `packagePath`
- `protocol`
- `latestVersion`
- `publishedAt`
- `currentVersionTime`
- `deprecated`
- `homepage`
- `nodeCompat`
- `nodeCompatible`
- `provenance`
- `currentProvenance`
- `riskIds`
- `writePlanIds`

### `writePlan`

This is the most important agent-facing addition. Every planned mutation must be explicit.

Required fields:

- `id`
- `dependencyId`
- `updateId`
- `file`
- `fileType`: `package.json | package.yaml | pnpm-workspace | bun-workspace | yarn-workspace | global`
- `source`
- `parents`
- `name`
- `from`
- `to`
- `operation`: `replace-version | update-package-manager | global-install`
- `status`: `pending | applied | reverted | failed | skipped`
- `statusReason`

Examples:

```json
{
  "id": "write:root:dependencies:zod",
  "file": "/repo/package.json",
  "fileType": "package.json",
  "source": "dependencies",
  "name": "zod",
  "from": "^4.3.6",
  "to": "^4.4.1",
  "operation": "replace-version",
  "status": "pending"
}
```

For global packages:

```json
{
  "id": "write:global:npm:vite",
  "file": "global:npm",
  "fileType": "global",
  "source": "dependencies",
  "name": "vite",
  "from": "7.1.0",
  "to": "7.2.0",
  "operation": "global-install",
  "status": "pending"
}
```

### `execution`

Fields:

- `writeAttempted`
- `writeApplied`
- `writeReverted`
- `verifyCommand`
- `verifyResults`
- `postWrite`
- `lockfile`

`postWrite` should include:

- `kind`: `none | install | update | execute`
- `command`
- `cwd`
- `startedAt`
- `endedAt`
- `exitCode`
- `status`: `not-run | succeeded | failed`
- `strict`

### `lockfile`

Fields:

- `detected`: boolean
- `manager`
- `path`
- `updatedByDepfresh`: boolean
- `requiresSync`: boolean
- `recommendedCommand`
- `status`: `not-needed | sync-required | synced | failed | unknown`

This must make manifest-only writes explicit. Example:

```json
{
  "detected": true,
  "manager": "bun",
  "path": "/repo/bun.lock",
  "updatedByDepfresh": false,
  "requiresSync": true,
  "recommendedCommand": "bun install",
  "status": "sync-required"
}
```

### `risks`

Risk records should be normalized and link back to updates.

Allowed risk types:

- `major-update`
- `deprecated-target`
- `node-incompatible`
- `provenance-downgrade`
- `fresh-release`
- `registry-resolution-failed`
- `write-reverted`
- `post-write-failed`
- `lockfile-sync-required`

Fields:

- `id`
- `type`
- `severity`: `info | low | medium | high | blocking`
- `dependencyId`
- `updateId`
- `message`
- `evidence`
- `recommendedAction`

### `actions`

Agent-ready next actions.

Allowed action types:

- `run-install`
- `run-update`
- `run-tests`
- `review-major`
- `review-deprecated`
- `review-node-compat`
- `review-provenance`
- `retry-resolution`
- `open-pr`
- `manual-review-required`

Fields:

- `id`
- `type`
- `priority`
- `command`
- `cwd`
- `reason`
- `dependsOn`
- `status`: `recommended | completed | blocked | skipped`

### `summary`

Fields:

- `scannedPackages`
- `scannedDependencies`
- `checkedDependencies`
- `skippedDependencies`
- `updatesTotal`
- `major`
- `minor`
- `patch`
- `failedResolutions`
- `plannedWrites`
- `appliedWrites`
- `revertedWrites`
- `risksBySeverity`
- `actionsRecommended`
- `exitCodeRecommendation`

### `errors`

Errors must be structured and never require parsing a message.

Fields:

- `code`
- `message`
- `retryable`
- `phase`: `validation | discovery | resolution | write | verify | post-write`
- `dependencyId`
- `file`
- `causeCode`

## NDJSON Event Contract

`--agent --stream` should output one JSON object per line.

Required event envelope:

```json
{
  "schemaVersion": 1,
  "runId": "run_...",
  "sequence": 1,
  "timestamp": "2026-05-02T00:00:00.000Z",
  "type": "dependency.resolved",
  "payload": {}
}
```

Initial event types:

- `run.started`
- `discovery.started`
- `discovery.package.loaded`
- `discovery.package.skipped`
- `discovery.catalog.loaded`
- `dependency.discovered`
- `dependency.skipped`
- `dependency.resolved`
- `dependency.failed`
- `write.planned`
- `write.applied`
- `write.reverted`
- `postwrite.started`
- `postwrite.completed`
- `risk.detected`
- `action.recommended`
- `summary`
- `run.completed`
- `run.failed`

Streaming output must end with exactly one terminal event: `run.completed` or `run.failed`.

## Exit Code Model

Keep existing public exit codes for normal modes. Agent CI can expose richer status inside
the JSON while still using the existing process exit model.

Recommended agent fields:

| Field | Meaning |
| --- | --- |
| `run.status: clean` | No updates and no blocking errors. |
| `run.status: outdated` | Updates found in check mode. |
| `run.status: planned` | Write plan generated without writes. |
| `run.status: applied` | Writes and post-write actions succeeded. |
| `run.status: partial` | Some writes applied and some reverted or failed. |
| `run.status: failed` | Validation, resolution policy, write, or post-write failure. |

Process exit behavior:

- `0`: clean, planned successfully, or write succeeded.
- `1`: outdated found with `--fail-on-outdated` or `--agent --ci` check-only mode.
- `2`: config/runtime error, failed strict post-write, no packages when configured as failure,
  resolution errors when configured as failure, or schema generation failure.

## Architecture Plan

### New Modules

Create:

```text
src/commands/check/agent/types.ts
src/commands/check/agent/collector.ts
src/commands/check/agent/output.ts
src/commands/check/agent/stream.ts
src/commands/check/agent/write-plan.ts
src/commands/check/agent/risks.ts
src/commands/check/agent/actions.ts
src/commands/check/agent/lockfile.ts
src/commands/check/agent/schema.ts
```

Responsibilities:

- `types.ts`: exported contract types and enum constants.
- `collector.ts`: mutable per-run collection state with pure append/update helpers.
- `output.ts`: final JSON document builder and stdout writer.
- `stream.ts`: NDJSON event writer with sequence tracking.
- `write-plan.ts`: derive file-level mutations before writes.
- `risks.ts`: derive risk records from dependencies, updates, write results, and post-write.
- `actions.ts`: derive next recommended actions.
- `lockfile.ts`: detect lockfile state and recommended sync command.
- `schema.ts`: load or export bundled JSON schema.

### Existing Modules To Change

Update:

```text
src/types/options.ts
src/cli/args-schema.ts
src/cli/normalize-args.ts
src/cli/capabilities.ts
src/validate-options.ts
src/io/dependencies/parse.ts
src/io/dependencies/overrides.ts
src/io/packages/discovery.ts
src/io/resolve/resolve-dependency.ts
src/commands/check/run-check.ts
src/commands/check/process-package.ts
src/commands/check/write-flow.ts
src/commands/check/package-manager.ts
src/index.ts
```

## Data Collection Changes

### Dependency Parsing

Current parsing drops skipped dependencies early. Agent mode needs a record of those
decisions.

Implementation approach:

1. Add an optional `dependencyEvents` collector to runtime options or a dedicated context.
2. Keep `parseDependencies` return behavior backward compatible.
3. Add `parseDependencyCandidates` or internal instrumentation that records:
   - raw field
   - raw version
   - skip reason
   - include/exclude match result
   - protocol
   - update eligibility
4. Do not change regular mode behavior.

### Resolution

`resolveDependency` currently returns `null` for many important decisions. Agent mode
needs explicit skip records.

Implementation approach:

1. Keep the existing return type for regular flow initially.
2. Add an agent decision callback that records:
   - workspace versionless skip
   - private workspace skip
   - package-mode ignore
   - dist-tag skip
   - no target
   - no change
   - registry error
3. Later, consider refactoring to an explicit `DependencyResolutionResult` union.

### Write Planning

Before calling `writePackage`, build `writePlan` entries from selected changes.

Implementation approach:

1. Add `buildWritePlan(pkg, changes)` with no side effects.
2. Use package type and catalog metadata to map changes to actual files.
3. For `package.json` and `package.yaml`, inspect current source sections.
4. For catalogs, inspect `CatalogSource.filepath` and `parents`.
5. For globals, use `getGlobalWriteTargets`.
6. Attach write plan ids back to updates.

### Write Execution

Update `applyPackageWrite` to optionally report granular write results.

Implementation approach:

1. Extend `PackageWriteResult` with optional `items`.
2. Record applied/reverted/failed per change.
3. Preserve existing counters.
4. Make verify-command results explicit per dependency.

### Post-Write Execution

Current `runInstall`, `runUpdate`, and `runExecute` return booleans. Agent mode needs
structured command results.

Implementation approach:

1. Add structured variants:
   - `runInstallDetailed`
   - `runUpdateDetailed`
   - `runExecuteDetailed`
2. Keep existing boolean wrappers for compatibility.
3. Capture command, cwd, started/ended timestamps, status, and exit code.
4. Avoid capturing unbounded stdout/stderr by default. Add a later opt-in if needed.

## Lockfile Detection Plan

Create a single helper that detects lockfiles from the execution root:

| File | Manager |
| --- | --- |
| `bun.lock` | bun |
| `bun.lockb` | bun |
| `pnpm-lock.yaml` | pnpm |
| `package-lock.json` | npm |
| `npm-shrinkwrap.json` | npm |
| `yarn.lock` | yarn |

Rules:

- If files were written and no post-write install/update ran, set `requiresSync: true`.
- If `--install` or `--update` succeeded, set `status: synced`.
- If install/update failed, set `status: failed`.
- If no lockfile exists, set `detected: false` and recommend package-manager install only
  when package manager detection is reliable.
- For global packages, lockfile sync is not applicable.

## Risk Rules

Implement risk derivation as pure functions.

Rules:

- Major diff: `medium`, or `high` when package is in runtime dependencies.
- Deprecated target: `high`.
- Node incompatible target: `blocking`.
- Provenance downgrade from `attested` or `trusted` to `none`: `high`.
- Fresh release within cooldown-like threshold: `low` or `medium`.
- Resolution error: `medium`, or `blocking` in strict resolution mode.
- Verify-command reverted update: `blocking`.
- Strict post-write failure: `blocking`.
- Lockfile sync required after write: `medium`.

Make thresholds configurable later; start with hardcoded documented defaults.

## Action Rules

Generate recommended actions from the final state.

Examples:

- If manifest/catalog writes happened and lockfile sync is required:
  `run-install` with `bun install`, `pnpm install`, `npm install`, or `yarn install`.
- If major updates exist:
  `review-major`.
- If node-incompatible risk exists:
  `manual-review-required`.
- If writes succeeded:
  `run-tests` using `--execute` recommendation only when configured, otherwise no guessed
  project test command.
- If resolution errors are retryable:
  `retry-resolution`.
- If all writes and post-write steps pass:
  `open-pr`.

Do not invent project-specific commands unless they were provided through flags or config.

## JSON Schema Plan

Create:

```text
schemas/depfresh-agent-v1.schema.json
```

Requirements:

- Strict top-level required keys.
- Enum definitions for decisions, skip reasons, risk types, action types, statuses, and
  phases.
- `additionalProperties: false` for stable contract objects where practical.
- String formats for dates and paths.
- Examples for check, plan, write, and failure.

Add tests that validate emitted agent output against the schema.

## Capabilities Contract Changes

Update `src/cli/capabilities.ts` to include:

- `agentOutputSchema`
- `agentEventSchema`
- `agentWorkflows`
- new flags and relationships
- CI-safe workflow examples
- explicit JSON v1 vs agent schema distinction

Add tests in `src/cli/capabilities.test.ts`.

## Documentation Plan

Add or update:

```text
docs/output-formats/agent.md
docs/cli/flags.md
docs/cli/examples.md
docs/api/types.md
docs/troubleshooting.md
README.md
```

Documentation requirements:

- Explain when to use table, JSON v1, agent JSON, and agent stream.
- Document every enum.
- Include CI examples.
- Include the lockfile sync model.
- Include global package examples.
- Include validation and schema usage.
- Avoid naming specific agent vendors or products.

## Test Plan

### Unit Tests

Add focused tests for:

```text
src/commands/check/agent/*.test.ts
src/io/dependencies/dependencies.agent.test.ts
src/io/resolve/resolve.agent-decisions.test.ts
src/commands/check/check.agent-output.test.ts
src/commands/check/check.agent-stream.test.ts
src/commands/check/check.agent-write.test.ts
src/commands/check/check.agent-ci.test.ts
```

Coverage:

- agent flag normalization
- validation conflicts
- schema export
- discovery records
- skipped manifest records
- skipped dependency records
- update enrichment fields
- risk derivation
- action derivation
- lockfile detection
- write plan generation for package JSON
- write plan generation for package YAML
- write plan generation for pnpm catalogs
- write plan generation for bun catalogs
- write plan generation for yarn catalogs
- global package write plan
- verify-command revert reporting
- post-write install/update reporting
- JSON v1 compatibility unchanged

### Integration Tests

Extend practical smoke coverage:

```text
test/practical-cli-smoke.mjs
test/agent-cli-smoke.mjs
```

Scenarios:

- single package, check-only agent JSON
- monorepo with multiple manifests
- Bun workspace catalog plus lockfile sync required
- `--agent --plan`
- `--agent --write`
- `--agent --write --install`
- `--agent --stream`
- global-all write plan
- no packages found
- registry failure
- verify-command failure and rollback

### Schema Tests

Use a JSON schema validator in tests. Prefer a dev dependency only if necessary. If avoiding
new dependencies, add a small structural validator test plus schema snapshot tests.

### Regression Gates

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test:run
pnpm build
```

For release readiness, also run a packaged-install smoke:

```bash
pnpm pack
```

Then install the packed tarball in a temporary fixture and run:

```bash
depfresh --agent
depfresh --agent --plan
depfresh --agent --stream
depfresh --help-json
depfresh capabilities --json
```

## Implementation Phases

### Phase 0: Contract Freeze

Deliverables:

- Finalize `depfresh-agent-v1.schema.json`.
- Add TypeScript contract types.
- Add docs skeleton.
- Add sample fixtures under `test/fixtures/agent-output/`.

Acceptance:

- Schema is committed.
- Types compile.
- Docs define all top-level fields and enums.

### Phase 1: CLI Flags And Capabilities

Deliverables:

- Add `--agent`, `--plan`, `--stream`, `--ci`, and `--agent-schema`.
- Normalize options.
- Add validation rules.
- Update capabilities output.

Acceptance:

- `depfresh --agent-schema` prints schema without scanning a project.
- `depfresh --help-json` includes new flags.
- Invalid flag combinations fail with structured errors.
- Existing `--output json` behavior is unchanged.

### Phase 2: Agent Collector And Final JSON

Deliverables:

- Add agent collector.
- Emit one-shot agent JSON for check-only runs.
- Include run, environment, configuration, discovery, updates, summary, and errors.
- Include resolver enrichment fields.

Acceptance:

- `depfresh --agent` emits schema-valid JSON.
- No ANSI/log/progress output contaminates stdout.
- JSON v1 tests still pass.

### Phase 3: Skip Reasons And Full Dependency Decisions

Deliverables:

- Record skipped dependencies from parsing and resolution.
- Add stable skip reason enums.
- Add discovery skip details.

Acceptance:

- Agent output shows checked and skipped dependency counts.
- `catalog:`, `workspace:*`, peer-disabled, include-filter, exclude-filter, locked-version,
  private-workspace, and unsupported-protocol cases are covered by tests.

### Phase 4: Write Plan

Deliverables:

- Add `writePlan` builder.
- Link updates to write plan ids.
- Support package JSON, package YAML, catalogs, packageManager, and global packages.

Acceptance:

- `depfresh --agent --plan` emits planned mutations without changing files.
- `depfresh --agent --write` updates files and marks write plan entries as applied.
- Verify-command rollback marks entries as reverted.

### Phase 5: Lockfile And Post-Write Status

Deliverables:

- Add lockfile detection.
- Add structured post-write command results.
- Allow `--agent --write --install` and `--agent --write --update`.

Acceptance:

- Bun manifest-only write reports `lockfile.status: sync-required`.
- Successful install/update reports `lockfile.status: synced`.
- Failed strict post-write reports blocking risk and exit code `2`.

### Phase 6: Risks And Actions

Deliverables:

- Add risk derivation.
- Add action derivation.
- Add CI status recommendation.

Acceptance:

- Major, deprecated, node-incompatible, provenance downgrade, fresh release, failed
  resolution, reverted write, post-write failure, and lockfile sync risks are covered.
- Output includes recommended next actions without guessing project-specific commands.

### Phase 7: NDJSON Stream

Deliverables:

- Add event writer.
- Emit stream events throughout discovery, resolution, write, post-write, and summary.
- Add terminal event guarantees.

Acceptance:

- `depfresh --agent --stream` emits valid NDJSON.
- Event sequence numbers are monotonic.
- Exactly one terminal event is emitted.
- Non-stream agent JSON remains unchanged.

### Phase 8: CI Mode

Deliverables:

- Add `--agent --ci` defaults.
- Add deterministic status and exit recommendations.
- Add docs and examples for CI usage.

Acceptance:

- Check-only CI exits `1` when updates are found.
- Clean CI exits `0`.
- Strict failures exit `2`.
- JSON includes enough detail for CI annotations.

### Phase 9: Documentation And Release Hardening

Deliverables:

- Complete docs.
- Add examples.
- Add packaged smoke.
- Update changelog when ready.

Acceptance:

- `pnpm lint`, `pnpm typecheck`, `pnpm test:run`, and `pnpm build` pass.
- Packaged CLI smoke passes from the tarball.
- Docs match shipped behavior.

## File-Level Work Breakdown

### CLI And Options

Files:

- `src/types/options.ts`
- `src/cli/args-schema.ts`
- `src/cli/normalize-args.ts`
- `src/validate-options.ts`
- `src/cli/capabilities.ts`

Tasks:

- Add options.
- Normalize flags.
- Validate conflicts and requirements.
- Update capabilities output and tests.

### Agent Core

Files:

- `src/commands/check/agent/types.ts`
- `src/commands/check/agent/collector.ts`
- `src/commands/check/agent/output.ts`
- `src/commands/check/agent/stream.ts`

Tasks:

- Define contract.
- Implement collector.
- Emit final JSON.
- Emit stream events.

### Dependency Decisions

Files:

- `src/io/dependencies/parse.ts`
- `src/io/dependencies/overrides.ts`
- `src/io/resolve/resolve-dependency.ts`
- `src/io/resolve/version-filter.ts`

Tasks:

- Record skipped dependencies.
- Record resolver decisions.
- Preserve current public resolver behavior.

### Planning And Writes

Files:

- `src/commands/check/agent/write-plan.ts`
- `src/commands/check/write-flow.ts`
- `src/io/write/index.ts`
- `src/io/write/package-json.ts`
- `src/io/write/package-yaml.ts`
- `src/io/write/catalog.ts`
- `src/io/global.ts`
- `src/io/global-targets.ts`

Tasks:

- Build write plan.
- Attach write results.
- Cover globals and catalogs.

### Post-Write And Lockfile

Files:

- `src/commands/check/package-manager.ts`
- `src/commands/check/post-write-actions.ts`
- `src/commands/check/agent/lockfile.ts`

Tasks:

- Add detailed command result variants.
- Add lockfile status.
- Preserve existing boolean APIs.

### Risks And Actions

Files:

- `src/commands/check/agent/risks.ts`
- `src/commands/check/agent/actions.ts`

Tasks:

- Derive risks.
- Derive next actions.
- Add tests for all risk/action combinations.

## Backward Compatibility

- Do not change default table output.
- Do not change JSON v1 field names or schema version.
- Do not change existing exit codes outside explicit agent CI behavior.
- Keep public library exports backward compatible.
- Add new exports only where useful.
- Do not require new runtime dependencies unless the schema validation path truly needs one.

## Open Questions

- Should `--agent` be a top-level flag only, or should there also be `--output agent-json`?
- Should `--agent --plan` exit `0` when updates are planned, or mirror outdated CI behavior
  only when `--ci` is also set?
- Should post-write stdout/stderr be captured in memory, streamed only, or omitted by default?
- Should risk thresholds be configurable in `.depfreshrc` in v1, or deferred?
- Should the agent schema include package manager lockfile diff hashes, or only sync status?

## Initial Success Criteria

The feature is complete when:

- An automation can run `depfresh --agent --plan` and know exactly what files would change.
- An automation can run `depfresh --agent --write --install` and know exactly what changed,
  whether install/update succeeded, and what remains to do.
- Every skipped dependency has a stable reason.
- Bun lockfile sync state is explicit.
- Global package updates are represented as write plan entries.
- Risks and recommended actions are machine-readable.
- `--agent --stream` provides useful long-running progress without ANSI output.
- The emitted JSON validates against the committed schema.
- Existing table and JSON v1 behavior remains compatible.
