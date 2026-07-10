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
- Post-write commands currently use inherited stdio in the package-manager helpers. That is
  fine for table mode, but it would corrupt machine stdout in agent mode unless replaced by
  structured command execution.
- Published package contents currently include only `dist`. Any schema file that lives
  outside `dist` must either be copied into the build output, explicitly included in
  `package.json#files`, or exported from generated code.
- The public library currently exports `check`, `resolvePackage`, `loadPackages`,
  `writePackage`, and core types, but it does not expose a reusable agent-report builder.

## Codebase Findings That Shape The Plan

These are the implementation facts that the plan must respect:

- CLI flags are declared in `src/cli/args-schema.ts`, normalized in
  `src/cli/normalize-args.ts`, and validated in `src/validate-options.ts`.
- The main execution spine is `src/commands/check/run-check.ts`, which wires package
  loading, resolution, rendering, writes, post-write commands, JSON output, profile data,
  and exit codes.
- `src/commands/check/process-package.ts` is the package-level boundary where resolved
  changes become rendered updates, interactive selections, write plans, and write results.
- `src/commands/check/write-flow.ts` owns verify-and-rollback behavior and global write
  dispatch.
- `src/io/dependencies/parse.ts` drops many skipped dependencies before resolution. Agent
  mode needs a parallel decision stream there, not only resolver instrumentation.
- `src/io/resolve/resolve-dependency.ts` returns `null` for many semantically different
  outcomes. Agent mode needs explicit decision records while preserving the existing
  return contract for regular mode.
- `src/io/write/*` performs the actual manifest/catalog writes. The write plan must not
  duplicate write logic in a way that can drift; it should use shared path/section helpers.
- Global package writes are special-cased through `src/io/global.ts` and
  `src/io/global-targets.ts`. Agent write plans must represent those as commands, not file
  mutations.
- Existing practical CLI smoke tests already cover JSON, write, install/update rejection,
  and global flows. Agent smoke should extend this rather than replace it.
- `build.config.ts` only builds `src/index` and `src/cli`. Schema packaging needs an
  explicit build/package decision.

## Research-Backed Requirements

Agent mode should follow these external interoperability constraints:

- Structured consumers handle output best when there is a declared schema, stable required
  keys, bounded enum values, and no ambiguous absence semantics. Agent objects should prefer
  required keys with `null`, `false`, `0`, or `[]` over omitted fields.
- JSON Schema should declare its dialect with a root `$schema` field. The planned schema
  should use Draft 2020-12 unless implementation constraints require a narrower dialect.
- Schema objects intended for strict consumers should avoid loose extension points in core
  records. Use `additionalProperties: false` for stable objects, and reserve explicit
  `metadata` objects for future extension.
- Streaming JSON should be incrementally parseable and recoverable. Plain NDJSON is
  shell-friendly, but events must be one-line JSON objects, sequence-numbered, and end with
  exactly one terminal event. A future `application/json-seq` mode can use RFC 7464 record
  separators if crash/truncation recovery becomes a hard requirement.
- Error records should be structured enough for automated recovery. Use a stable problem
  object with code, title, detail, phase, retryability, and evidence rather than raw
  message-only strings.
- CI consumers benefit from file/line annotations and standard result interchange. Agent
  mode should expose generic `annotations[]` in the core JSON and optionally export SARIF
  later for platforms that consume static-analysis result files.
- Tool ecosystems increasingly distinguish model-readable text from machine-readable
  structured content. depfresh should keep table output, JSON v1, agent JSON, and stream
  output as distinct contracts instead of trying to make one format serve every audience.
- Tool-oriented integrations work best when the CLI can describe itself with input schemas,
  output schemas, side-effect metadata, and examples. Agent mode should expose adapter-ready
  tool descriptors instead of forcing every integration to reverse-engineer flags.
- Long-running task protocols separate task state, status events, and artifacts. depfresh
  should model the same concepts in a CLI-friendly way: stable run ids, ordered event ids,
  generated artifacts, and a final authoritative report.
- Agent runtimes retry commands after timeouts and partial failures. Write plans need
  idempotency, precondition hashes, stale-plan detection, and explicit no-op semantics.
- Dependency identity should use ecosystem-neutral identifiers where possible. Package URL
  strings should be included for npm-compatible package records so security, SBOM, and CI
  systems can correlate the same dependency without guessing.
- Machine output should include compact human-readable explanation fields next to stable enum
  ids. The enum is the contract; the explanation reduces model confusion without requiring
  table parsing.
- CI and code-scanning systems rely on stable fingerprints to de-duplicate findings across
  runs. Risks and annotations should include deterministic fingerprints derived from package,
  file, source, dependency name, and risk id.

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
- Keep machine payloads on stdout and diagnostics/child command logs off stdout.
- Emit stable ids and stable ordering so repeated runs are diffable.
- Never expose auth tokens, registry credentials, environment secrets, or full unredacted
  command output in machine payloads.
- Make side effects explicit before they happen and report them after they happen.
- Add a new contract rather than stretching JSON v1 until it becomes ambiguous.
- Prefer repo-relative paths for CI fields and include absolute paths only when they are
  useful for local execution.
- Pair every mutating action with an explicit safety classification:
  read-only, writes-manifest, writes-lockfile, runs-package-manager, or runs-user-command.
- Make output size predictable. Large command output, huge dependency lists, and future
  changelog text must be summarized with truncation metadata rather than emitted without
  bounds.

## Non-Goals

- Do not build a dependency update bot, scheduler, or PR author in this feature. Agent mode
  should provide the contract other automation can use.
- Do not parse changelogs or release notes in v1.
- Do not attempt to auto-classify project-specific test commands unless the user supplied
  the command.
- Do not update lockfiles directly by editing lockfile syntax. Lockfile sync remains a
  package-manager operation.
- Do not remove the existing table output or JSON v1 output.
- Do not add vendor-specific agent behavior to the core contract.
- Do not ship a long-running server or agent protocol adapter in v1. The CLI should publish
  enough schema and descriptor data that external adapters can be built cleanly.

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
| `--agent-tool-schema` | boolean | `false` | Print bundled agent tool descriptors and exit. |
| `--agent-output <path>` | string | -- | Write the final agent JSON document to a file while keeping stdout behavior explicit. |
| `--agent-annotations <path>` | string | -- | Write CI annotation records as JSON for downstream adapters. |
| `--agent-detail <level>` | `summary | full` | `full` | Control large report detail without changing the schema. |
| `--operation-id <id>` | string | generated | Correlate retries or wrapper-level tasks. |
| `--traceparent <value>` | string | generated/null | Accept external trace context for observability correlation. |

Validation rules:

- `--stream` requires `--agent`.
- `--plan` requires `--agent`.
- `--agent-schema` should not require a project.
- `--agent-tool-schema` should not require a project.
- `--interactive` conflicts with `--agent`.
- `--output json` conflicts with `--agent` to avoid ambiguous contracts.
- `--agent --write --install` and `--agent --write --update` are allowed.
- Existing `--output json --write --install` stays rejected for JSON v1 compatibility.
- `--agent-output` requires `--agent` and must not point inside a dependency directory that
  normal discovery would scan.
- `--agent-annotations` requires `--agent`.
- `--agent-detail summary` must preserve all top-level keys and replace omitted details with
  explicit counts and truncation metadata.
- `--traceparent` must be validated and redacted from logs if invalid.

Default stdout policy:

- `--agent` writes the final JSON document to stdout.
- `--agent --stream` writes NDJSON events to stdout.
- `--agent --stream --agent-output <path>` writes stream events to stdout and the final
  document to the requested path.
- Child command output must never inherit stdout in agent mode. It should be captured,
  bounded, redacted, and optionally mirrored to stderr.

## Agent Contract Overview

Target schema file:

```text
schemas/depfresh-agent-v1.schema.json
```

Target TypeScript types:

```text
src/commands/check/agent/types.ts
```

Packaging requirement:

- The schema must be available in the published package. Either copy it to
  `dist/schemas/depfresh-agent-v1.schema.json` during build or include `schemas` in
  `package.json#files`.
- Add an export path for programmatic consumers, for example
  `depfresh/agent-schema` or `depfresh/schemas/agent-v1`.
- `depfresh --agent-schema` must read the packaged schema, not a source-tree-only file.

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
  "annotations": [],
  "artifacts": [],
  "summary": {},
  "errors": []
}
```

Field presence policy:

- Core objects must include all documented keys.
- Unknown or unavailable scalar values should be `null`.
- Unknown or unavailable arrays should be `[]`.
- Unknown booleans should be `null`, not `false`.
- Stable records should use `additionalProperties: false` in the JSON schema.
- A small explicit `metadata` object may allow extra integration-specific data when needed.

Shared location object:

- `path`: absolute path when available
- `relativePath`: path relative to `run.effectiveRoot`
- `jsonPointer`: JSON Pointer into a JSON manifest, or `null`
- `yamlPath`: YAML path for workspace/catalog files, or `null`
- `line`: 1-based line number, or `null`
- `column`: 1-based column number, or `null`
- `hash`: content hash for the referenced file state, or `null`

Use this shared shape inside dependency evidence, write plan items, risks, annotations, and
errors whenever a record points at a file location.

## Required Top-Level Sections

### `schema`

Fields:

- `name`: fixed string, `depfresh-agent`
- `version`: number, starts at `1`
- `uri`: stable schema URI
- `hash`: SHA-256 hash of the schema content
- `dialect`: JSON Schema dialect URI
- `strict`: boolean indicating whether the emitted report was built for the strict schema

### `run`

Fields:

- `id`: stable unique id for the run
- `operationId`: stable id that can be reused by wrappers when correlating retries
- `parentOperationId`: parent id supplied by a wrapper or `null`
- `traceparent`: W3C trace context value supplied or generated for the run, or `null`
- `startedAt`: ISO timestamp
- `endedAt`: ISO timestamp, set when complete
- `durationMs`: total runtime
- `cwd`: requested cwd
- `effectiveRoot`: resolved project root
- `mode`: selected range mode
- `intent`: `check | plan | write | ci`
- `stream`: boolean
- `status`: `clean | outdated | planned | applied | partial | failed`
- `schemaPath`: packaged schema path or `null`
- `schemaHash`: content hash of the emitted schema or `null`
- `contract`: `agent-v1`
- `inputHash`: deterministic hash of normalized options and discovered input files
- `planHash`: deterministic hash of the generated write plan, or `null`

Notes:

- `id` is unique per process execution.
- `operationId` is stable across a retry when the caller supplies it.
- `traceparent` is for correlation only and must not contain personal or secret data.
- `planHash` changes whenever a planned mutation changes.

### `environment`

Fields:

- `nodeVersion`
- `platform`
- `arch`
- `packageManager`: detected package manager for post-write operations
- `lockfiles`: detected lockfiles with path and manager
- `isTTY`
- `ci`: boolean
- `stdout`: `json | ndjson | empty`
- `stderr`: `diagnostics | empty`
- `pathMode`: `repo-relative | absolute | mixed`

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
Registry URLs must be normalized to remove embedded credentials before they are emitted.

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
- `packageRelativePath`
- `packageType`
- `name`
- `aliasName`
- `ecosystem`: `npm | jsr | unknown`
- `purl`: package URL string for resolved npm-compatible packages, or `null`
- `source`
- `parents`
- `rawVersion`
- `normalizedVersion`
- `jsonPointer`: JSON Pointer to the manifest value when available
- `line`: 1-based line number when available, or `null`
- `protocol`
- `manager`
- `decision`
- `decisionReason`: short human-readable explanation paired with the stable decision enum
- `skipReason`
- `skipReasonDetail`: short human-readable explanation paired with the stable skip enum
- `resolutionStatus`
- `registry`
- `cache`
- `order`
- `isDirect`
- `isWorkspacePackage`
- `isGlobalPackage`
- `rawSpecifier`
- `normalizedSpecifier`

Allowed `decision` values:

- `checked`
- `skipped`
- `updateAvailable`
- `upToDate`
- `failed`
- `writePlanned`
- `written`
- `reverted`
- `postWritePending`
- `postWriteComplete`

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
- `invalid-version`
- `malformed-section`
- `non-string-version`
- `package-manager-unsupported`
- `post-write-not-requested`

### `updates`

Each available update should include:

- `dependencyId`
- `name`
- `ecosystem`
- `purl`
- `current`
- `target`
- `currentClean`
- `targetClean`
- `diff`
- `source`
- `packageName`
- `packagePath`
- `packageRelativePath`
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
- `registryUrl`
- `distTag`
- `selected`
- `selectionReason`
- `rangeMode`
- `packageModeMatched`
- `fingerprint`
- `explanation`: short human-readable explanation for why this target was selected

### `writePlan`

This is the most important agent-facing addition. Every planned mutation must be explicit.

Required fields:

- `id`
- `dependencyId`
- `updateId`
- `file`
- `relativeFile`
- `fileType`: `package.json | package.yaml | pnpm-workspace | bun-workspace | yarn-workspace | global`
- `source`
- `parents`
- `name`
- `from`
- `to`
- `jsonPointer`
- `line`
- `operation`: `replace-version | update-package-manager | global-install`
- `status`: `pending | applied | reverted | failed | skipped`
- `statusReason`
- `statusExplanation`
- `requiresInstall`
- `willTouchLockfile`
- `sideEffectClass`:
  `read-only | writes-manifest | writes-lockfile | runs-package-manager | runs-user-command`
- `command`
- `safeToApply`
- `preconditionHash`: hash of the source file or global state before applying the item
- `postconditionHash`: hash after applying, or `null`
- `fingerprint`: deterministic id for deduplication across runs

Examples:

```json
{
  "id": "write:root:dependencies:zod",
  "file": "/repo/package.json",
  "relativeFile": "package.json",
  "fileType": "package.json",
  "source": "dependencies",
  "name": "zod",
  "from": "^4.3.6",
  "to": "^4.4.1",
  "operation": "replace-version",
  "status": "pending",
  "sideEffectClass": "writes-manifest"
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
  "status": "pending",
  "sideEffectClass": "runs-package-manager"
}
```

Write-plan invariants:

- `--agent --plan` must not modify project files.
- `writePlan[].from` must be read from the file at planning time, not copied blindly from
  the resolved dependency record.
- If the file no longer contains the planned source/name at write time, mark the entry
  `failed` with `statusReason: stale-source`.
- Planning and writing must share section navigation helpers to avoid JSON/YAML/catalog
  path drift.
- If one physical file has multiple package/catalog representations, write planning must
  group mutations by physical path to avoid clobbering.
- A write item may be treated as already satisfied only when `from` is no longer present and
  the current value is exactly `to`; this must be reported as `skipped` with
  `statusReason: already-applied`.
- Applying a plan against changed source content must fail closed with
  `statusReason: stale-precondition` unless the user explicitly asked for a fresh plan.
- `fingerprint` must not include timestamps or absolute temp directories.

### Idempotency And Retry Model

Agent workflows can time out or retry the same command. depfresh must make repeated
execution understandable.

Required behavior:

- Every run has a `run.id`; retries can reuse `run.operationId`.
- Every plan has a `run.planHash`.
- Every write item has a `preconditionHash` and `fingerprint`.
- Re-running `--agent --plan` against unchanged inputs should produce the same `planHash`.
- Re-running `--agent --write` after a successful write should not be reported as a fresh
  mutation. It should report already-satisfied write items explicitly.
- If source files changed after planning, writes fail closed with a structured stale-plan
  error.
- If post-write install/update fails after manifest writes succeed, the run status is
  `partial`, not `failed`, unless strict mode requires a process exit code of `2`.

Add tests for:

- retrying the same plan without file changes
- retrying after manifest writes already landed
- retrying after source file drift
- retrying after post-write command failure

### `execution`

Fields:

- `writeAttempted`
- `writeApplied`
- `writeReverted`
- `verifyCommand`
- `verifyResults`
- `postWrite`
- `lockfile`
- `commands`
- `stdoutBytesCaptured`
- `stderrBytesCaptured`
- `redactionsApplied`
- `outputTruncated`
- `outputLimitBytes`

`postWrite` should include:

- `kind`: `none | install | update | execute`
- `commandId`
- `command`
- `cwd`
- `startedAt`
- `endedAt`
- `exitCode`
- `status`: `not-run | succeeded | failed`
- `strict`
- `stdoutPreview`
- `stderrPreview`
- `truncated`
- `stdoutBytes`
- `stderrBytes`
- `redacted`
- `sideEffectClass`
- `idempotent`

Command output policy:

- Capture child process output with `stdio: pipe` in non-stream agent mode.
- Store bounded previews only. Default limit: 16 KiB per stream per command.
- Redact environment-looking secrets and auth tokens before emission.
- In stream mode, child output can be emitted as `command.output` events on stdout only if
  each event is valid JSON. Raw child output may be mirrored to stderr behind an explicit
  option in a later phase.
- Never let child commands write raw bytes to stdout in agent mode.

### `lockfile`

Fields:

- `detected`: boolean
- `manager`
- `path`
- `updatedByDepfresh`: boolean
- `requiresSync`: boolean
- `recommendedCommand`
- `status`: `not-needed | sync-required | synced | failed | unknown`
- `reason`
- `preWriteHash`
- `postWriteHash`
- `changed`

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
- `command-output-truncated`
- `schema-validation-failed`

Fields:

- `id`
- `type`
- `severity`: `info | low | medium | high | blocking`
- `dependencyId`
- `updateId`
- `fingerprint`
- `message`
- `explanation`
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
- `emit-annotations`
- `upload-sarif`

Fields:

- `id`
- `type`
- `priority`
- `command`
- `cwd`
- `reason`
- `dependsOn`
- `status`: `recommended | completed | blocked | skipped`
- `machineReadableOnly`: boolean
- `sideEffectClass`:
  `read-only | writes-manifest | writes-lockfile | runs-package-manager | runs-user-command`
- `requiresApproval`: boolean
- `networkRequired`: boolean
- `idempotent`: boolean

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
- `status`
- `riskLevel`
- `lockfileSyncRequired`
- `machineReadable`
- `schemaValid`
- `truncated`: boolean
- `truncationReasons`: array of stable ids
- `topActionIds`: ordered ids for the most important recommended actions

### `annotations`

`annotations[]` should be a platform-neutral CI annotation model. It should not print
platform-specific workflow command syntax directly from core agent mode.

Fields:

- `id`
- `severity`: `notice | warning | error`
- `title`
- `message`
- `file`
- `relativeFile`
- `line`
- `endLine`
- `column`
- `endColumn`
- `dependencyId`
- `riskId`
- `actionId`
- `fingerprint`
- `jsonPointer`

Initial annotations:

- major update in a manifest or catalog
- node-incompatible target
- deprecated target
- provenance downgrade
- failed resolution
- verify rollback
- lockfile sync required after write

Future adapters can convert this to workflow commands or SARIF.

### `artifacts`

`artifacts[]` describes machine-readable files or stdout records produced by a run. This
lets wrappers and task-based systems treat the final report, annotations, schemas, and
future interchange files as explicit outputs rather than discovering them from logs.

Fields:

- `id`
- `kind`: `stdout-report | output-file | annotations-file | schema | sarif | log-preview`
- `path`: filesystem path or `null` for stdout-only artifacts
- `relativePath`: repo-relative path or `null`
- `mimeType`
- `schemaId`
- `schemaHash`
- `sizeBytes`
- `sha256`
- `createdAt`
- `description`
- `audience`: `machine | human | both`

Rules:

- `--agent` without `--agent-output` should still include one `stdout-report` artifact.
- `--agent-output` should include an `output-file` artifact.
- `--agent-annotations` should include an `annotations-file` artifact.
- Future SARIF export must include a `sarif` artifact with a stable `schemaId`.

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
- `title`
- `detail`
- `instance`
- `typeUri`
- `fingerprint`
- `evidence`

Problem object policy:

- `code` is the stable machine key.
- `title` is a short stable category.
- `detail` is safe human-readable text with no stack traces or secrets.
- `phase` tells the agent where recovery should happen.
- `retryable` must be computed, not guessed by the caller.

## NDJSON Event Contract

`--agent --stream` should output one JSON object per line.

Required event envelope:

```json
{
  "schemaVersion": 1,
  "runId": "run_...",
  "operationId": "op_...",
  "eventId": "event_...",
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
- `command.started`
- `command.output`
- `command.completed`
- `risk.detected`
- `action.recommended`
- `artifact.created`
- `summary`
- `run.completed`
- `run.failed`

Streaming output must end with exactly one terminal event: `run.completed` or `run.failed`.

Stream invariants:

- Each line is exactly one compact JSON object followed by LF.
- No pretty-printing in stream mode.
- No raw logs or child command bytes on stdout.
- `sequence` starts at `1` and increments by one.
- Each event includes `runId`, `operationId`, `eventId`, `type`, `timestamp`, and
  `payload`.
- `eventId` is unique within a run and must not include timestamps.
- Consumers can reconstruct the final report from events, but the final report remains the
  authoritative contract when `--agent-output` is used.
- If a stream event cannot be emitted, the run should fail with a structured `run.failed`
  event if possible.

Future option:

- Consider `--stream-format json-seq` using RFC 7464 record separators only after NDJSON
  lands and tests prove a need for stronger truncation recovery.

## Output Size Rules

Agent consumers have finite context windows and CI systems have log limits. The contract
must be complete but bounded.

Rules:

- Default `--agent-detail full` emits complete dependency, update, write, risk, action,
  annotation, and artifact records.
- `--agent-detail summary` keeps the same top-level object shape but may replace large
  arrays with summarized records and `truncated: true`.
- Any truncated section must include:
  - `originalCount`
  - `emittedCount`
  - `truncationReason`
  - `howToGetFullOutput`
- Command output previews are always bounded, even in `full` mode.
- Future changelog or release-note fields must be opt-in and separately bounded.

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

No-surprises CI rule:

- The JSON `run.status`, `summary.exitCodeRecommendation`, and actual process exit code
  must be tested together. A caller should not need to infer exit behavior from prose.

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
src/commands/check/agent/annotations.ts
src/commands/check/agent/artifacts.ts
src/commands/check/agent/tool-descriptors.ts
src/commands/check/agent/fingerprint.ts
src/commands/check/agent/purl.ts
src/commands/check/agent/errors.ts
src/commands/check/agent/redact.ts
src/commands/check/agent/command-runner.ts
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
- `annotations.ts`: derive platform-neutral CI annotations.
- `artifacts.ts`: record stdout/file artifacts and their hashes.
- `tool-descriptors.ts`: build adapter-ready tool descriptors from CLI flag metadata.
- `fingerprint.ts`: generate stable ids for risks, annotations, writes, and events.
- `purl.ts`: build Package URL strings for supported dependency ecosystems.
- `errors.ts`: build stable structured problem records.
- `redact.ts`: redact secrets from emitted command/config data.
- `command-runner.ts`: run post-write commands without contaminating machine stdout.

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
src/commands/check/post-write-actions.ts
src/index.ts
package.json
build.config.ts
action.yml
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
   - JSON Pointer and line evidence when available
   - repo-relative manifest path
4. Do not change regular mode behavior.
5. Record dependencies with non-string versions as skipped candidates rather than silently
   disappearing in agent mode.
6. Record disabled fields as field-level skip summaries even when individual dependencies
   are not parsed.
7. Generate Package URL values for npm-compatible package names after alias/protocol
   normalization. Keep `purl: null` when the package cannot be represented safely.

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
4. Add tests proving every `null` return path has a corresponding agent decision when
   agent mode is enabled.
5. Include a short `decisionReason` for every checked, skipped, failed, and up-to-date
   dependency. This text is not a stable API, but it helps agents explain outcomes without
   parsing logs.

### Write Planning

Before calling `writePackage`, build `writePlan` entries from selected changes.

Implementation approach:

1. Add `buildWritePlan(pkg, changes)` with no side effects.
2. Use package type and catalog metadata to map changes to actual files.
3. For `package.json` and `package.yaml`, inspect current source sections.
4. For catalogs, inspect `CatalogSource.filepath` and `parents`.
5. For globals, use `getGlobalWriteTargets`.
6. Attach write plan ids back to updates.
7. Store enough stale-write evidence to tell the caller whether the file changed between
   planning and execution.
8. Compute a deterministic `planHash` after sorting grouped file mutations.
9. Add precondition hashes before any file write and postcondition hashes after successful
   writes.

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
5. Agent mode must use detailed runners; table mode may keep the current inherited stdio
   behavior.
6. If detailed command execution is shared with table mode later, keep backwards-compatible
   log behavior.

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
- Hash lockfiles before and after post-write commands when a lockfile is detected and the
  file is reasonably sized.
- If multiple lockfiles exist, mark manager detection as ambiguous and recommend explicit
  package-manager configuration.
- Detect lockfile path relative to `effectiveRoot`, not the input cwd.

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

Risk derivation must be deterministic. Given the same agent report input, risk ids and
ordering must be stable.

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

Actions must be separated from effects. Emitting `run-install` is a recommendation, not an
implicit command execution unless the user passed `--install` or `--update`.

## CI And Interchange Plan

Agent mode should be useful in CI without being tied to one CI system.

Deliverables:

- Add platform-neutral `annotations[]` to the core report.
- Add `--agent-annotations <path>` for annotation JSON.
- Add documentation showing how adapters can translate annotations to CI-native messages.
- Add deterministic `fingerprint` values for every annotation so adapters can de-duplicate
  findings across commits and repeated runs.
- Prefer repo-relative paths in annotations. Absolute paths can stay in execution evidence.
- Defer direct SARIF output to a follow-up unless it is needed for the first CI integration.
- If SARIF is added, keep it as a separate export, not the primary agent contract.

Acceptance:

- Dependency risks that map to a manifest/catalog line include file and line evidence when
  available.
- CI annotation output is deterministic and schema-validated.
- Agent JSON remains usable without annotations.
- SARIF export, when added, must include stable rule ids, result fingerprints, and repository
  root handling.

## API Plan

CLI support is not enough. Programmatic consumers should not have to spawn the CLI.

Add public exports only after the internal contract stabilizes:

```typescript
export type {
  AgentReport,
  AgentEvent,
  AgentOptions,
  AgentRisk,
  AgentAction,
  AgentWritePlanItem,
} from './commands/check/agent/types'

export { buildAgentReport, outputAgentSchema } from './commands/check/agent'
```

Rules:

- `check(options)` remains backward compatible.
- `buildAgentReport(options)` returns a report object and never calls `process.exit`.
- CLI output functions remain CLI-only.
- Programmatic APIs must document side effects clearly.

## JSON Schema Plan

Create:

```text
schemas/depfresh-agent-v1.schema.json
```

Requirements:

- Root `$schema` declaration.
- `$id` with a stable package URL or repository URL.
- Stable `$defs` for shared objects: location, command, artifact, problem, risk,
  annotation, dependency identity, and write plan item.
- Strict top-level required keys.
- Enum definitions for decisions, skip reasons, risk types, action types, statuses, and
  phases.
- `additionalProperties: false` for stable contract objects where practical.
- Required keys with nullable values where a field may be unknown.
- String formats for dates and paths.
- Examples for check, plan, write, and failure.
- Golden example files that are validated in tests and referenced from docs.
- A schema changelog section in docs.
- A compatibility statement describing which fields can be added in v1 without breaking
  strict consumers.

Add tests that validate emitted agent output against the schema.

Validation strategy:

- Use a dev-only JSON Schema validator if needed.
- Keep schema validation out of the runtime hot path unless `--agent-validate` is added
  later.
- Add snapshot fixtures for representative reports.
- Add a test that the packaged schema is present after `pnpm build`.

## Capabilities Contract Changes

Update `src/cli/capabilities.ts` to include:

- `agentOutputSchema`
- `agentEventSchema`
- `agentWorkflows`
- `agentAnnotationsSchema`
- `agentToolDescriptors`
- new flags and relationships
- CI-safe workflow examples
- explicit JSON v1 vs agent schema distinction
- schema version and schema hash

Add tests in `src/cli/capabilities.test.ts`.

## Tool Descriptor Plan

Agent tool hosts should be able to turn depfresh into typed tools without hand-writing
wrappers. Ship descriptor data that maps CLI workflows to input and output schemas.

Create:

```text
schemas/depfresh-agent-tools-v1.schema.json
docs/agents/tool-descriptors.md
```

Initial descriptors:

- `depfresh.check`: read-only dependency check.
- `depfresh.plan`: read-only write plan.
- `depfresh.write`: manifest/catalog write without package-manager install.
- `depfresh.writeAndInstall`: manifest/catalog write plus package-manager sync.
- `depfresh.globalCheck`: global package check.
- `depfresh.globalUpdate`: global package update.

Each descriptor must include:

- `name`
- `description`
- `inputSchema`
- `outputSchema`
- `mutating`: boolean
- `sideEffectClass`
- `requiresNetwork`: boolean
- `requiresApproval`: boolean
- `idempotent`: boolean
- `timeoutMs`
- `stdoutContract`
- `stderrContract`
- `exitCodes`
- `examples`

Descriptor rules:

- Read-only descriptors must not imply writes.
- Mutating descriptors must expose plan-first examples.
- Descriptor output schemas must point to the same packaged agent schema used by
  `--agent-schema`.
- Examples must include both success and structured failure.
- Descriptors must avoid vendor-specific fields. Adapters can translate them into their own
  tool registration format.

## Documentation Plan

Add or update:

```text
docs/output-formats/agent.md
docs/cli/flags.md
docs/cli/examples.md
docs/api/types.md
docs/troubleshooting.md
docs/agents/README.md
docs/agents/context.md
docs/agents/recipes.md
docs/integrations/github-action.md
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
- Explain stdout/stderr behavior clearly.
- Explain schema packaging and `--agent-schema`.
- Explain when lockfile sync is recommended but not performed.
- Include short agent-facing recipes with exact commands, expected exit codes, and recovery
  behavior.
- Include a repository-instruction snippet that downstream projects can paste into their own
  instruction files when they want agents to use depfresh safely.
- If depfresh docs are published as a website, add an optional `llms.txt` that points to the
  schema, CLI reference, agent recipes, and troubleshooting docs.

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
src/commands/check/check.agent-stdout.test.ts
src/commands/check/agent/annotations.test.ts
src/commands/check/agent/artifacts.test.ts
src/commands/check/agent/tool-descriptors.test.ts
src/commands/check/agent/fingerprint.test.ts
src/commands/check/agent/purl.test.ts
src/commands/check/agent/redact.test.ts
src/commands/check/agent/schema.test.ts
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
- stdout purity in agent mode
- stderr/log behavior in agent mode
- redaction of tokens and auth-bearing URLs
- schema file packaging assumptions
- stable ids and deterministic ordering
- annotation generation
- artifact records and hashes
- tool descriptor schema validity
- Package URL generation for scoped, aliased, and unsupported package names
- retry/idempotency behavior
- deterministic fingerprints
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
- child command output does not corrupt stdout
- packaged schema can be printed from the built CLI
- packaged tool descriptors can be printed from the built CLI or capabilities output
- plan hash stays stable across repeated unchanged runs
- stale precondition fails closed
- duplicate physical file writes do not clobber catalog or manifest changes

### Schema Tests

Use a JSON schema validator in tests. Prefer a dev dependency only if necessary. If avoiding
new dependencies, add a small structural validator test plus schema snapshot tests.

The preferred target is real schema validation. A structural validator is acceptable only
as a temporary Phase 0 bridge and must be replaced before release readiness.

### Regression Gates

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test:run
pnpm build
```

Also run:

```bash
pnpm test:smoke
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
depfresh --agent-tool-schema
depfresh --help-json
depfresh capabilities --json
```

Package smoke must verify that `--agent-schema` works from the installed package, not only
from the source checkout.
It must also verify that packaged tool descriptors are available from the installed
package.

## Implementation Phases

### Phase 0: Contract Freeze

Deliverables:

- Finalize `depfresh-agent-v1.schema.json`.
- Add TypeScript contract types.
- Add docs skeleton.
- Add sample fixtures under `test/fixtures/agent-output/`.
- Decide schema packaging path and package exports.
- Decide field presence policy and enum names before implementation starts.
- Finalize tool descriptor schema and artifact record shape.

Acceptance:

- Schema is committed.
- Types compile.
- Docs define all top-level fields and enums.
- Every top-level object has required fields defined.
- Open questions that affect the schema shape are resolved or explicitly deferred.

### Phase 1: CLI Flags And Capabilities

Deliverables:

- Add `--agent`, `--plan`, `--stream`, `--ci`, and `--agent-schema`.
- Add `--agent-tool-schema`, `--agent-output`, `--agent-annotations`,
  `--agent-detail`, `--operation-id`, and `--traceparent`.
- Normalize options.
- Add validation rules.
- Update capabilities output.

Acceptance:

- `depfresh --agent-schema` prints schema without scanning a project.
- `depfresh --agent-tool-schema` prints descriptors without scanning a project.
- `depfresh --help-json` includes new flags.
- Invalid flag combinations fail with structured errors.
- Existing `--output json` behavior is unchanged.
- Invalid stdout-producing combinations fail before any package scan.

### Phase 2: Agent Collector And Final JSON

Deliverables:

- Add agent collector.
- Emit one-shot agent JSON for check-only runs.
- Include run, environment, configuration, discovery, updates, summary, and errors.
- Include resolver enrichment fields.
- Include operation id, trace context, input hash, plan hash, package identity, and
  artifact records.
- Add stdout purity guarantees.
- Add redaction helper and use it for config/registry/command fields.

Acceptance:

- `depfresh --agent` emits schema-valid JSON.
- No ANSI/log/progress output contaminates stdout.
- JSON v1 tests still pass.
- Agent report ids and ordering are stable across repeated fixture runs.

### Phase 3: Skip Reasons And Full Dependency Decisions

Deliverables:

- Record skipped dependencies from parsing and resolution.
- Add stable skip reason enums.
- Add discovery skip details.

Acceptance:

- Agent output shows checked and skipped dependency counts.
- Agent output includes Package URL values where representable and `null` otherwise.
- `catalog:`, `workspace:*`, peer-disabled, include-filter, exclude-filter, locked-version,
  private-workspace, and unsupported-protocol cases are covered by tests.
- Every existing `resolveDependency` `null` path has a matching agent decision.

### Phase 4: Write Plan

Deliverables:

- Add `writePlan` builder.
- Link updates to write plan ids.
- Support package JSON, package YAML, catalogs, packageManager, and global packages.
- Add precondition hashes, postcondition hashes, plan hash, and already-applied handling.

Acceptance:

- `depfresh --agent --plan` emits planned mutations without changing files.
- `depfresh --agent --write` updates files and marks write plan entries as applied.
- Verify-command rollback marks entries as reverted.
- Stale file changes between planning and writing are reported as structured failures.
- Multiple updates to one physical file are grouped and do not clobber each other.
- Re-running the same plan against unchanged inputs produces a stable `planHash`.
- Re-running after a successful write reports already-applied items rather than pretending
  to write again.

### Phase 5: Lockfile And Post-Write Status

Deliverables:

- Add lockfile detection.
- Add structured post-write command results.
- Allow `--agent --write --install` and `--agent --write --update`.
- Replace inherited stdio in agent mode with structured command execution.

Acceptance:

- Bun manifest-only write reports `lockfile.status: sync-required`.
- Successful install/update reports `lockfile.status: synced`.
- Failed strict post-write reports blocking risk and exit code `2`.
- Child command output cannot corrupt agent stdout.
- Command output is bounded and redacted.

### Phase 6: Risks And Actions

Deliverables:

- Add risk derivation.
- Add action derivation.
- Add CI status recommendation.
- Add annotation derivation.
- Add deterministic fingerprints for risks, annotations, and action records.

Acceptance:

- Major, deprecated, node-incompatible, provenance downgrade, fresh release, failed
  resolution, reverted write, post-write failure, and lockfile sync risks are covered.
- Output includes recommended next actions without guessing project-specific commands.
- Annotation output is deterministic and linked to risks/actions.
- Annotation fingerprints are stable across repeated runs.

### Phase 7: NDJSON Stream

Deliverables:

- Add event writer.
- Emit stream events throughout discovery, resolution, write, post-write, and summary.
- Add terminal event guarantees.
- Emit `eventId`, `operationId`, and `artifact.created` events.

Acceptance:

- `depfresh --agent --stream` emits valid NDJSON.
- Event sequence numbers are monotonic.
- Event ids are unique within a run.
- Exactly one terminal event is emitted.
- Non-stream agent JSON remains unchanged.
- No raw command/log output appears on stdout.

### Phase 8: CI Mode

Deliverables:

- Add `--agent --ci` defaults.
- Add deterministic status and exit recommendations.
- Add docs and examples for CI usage.
- Add annotation file support.

Acceptance:

- Check-only CI exits `1` when updates are found.
- Clean CI exits `0`.
- Strict failures exit `2`.
- JSON includes enough detail for CI annotations.
- Process exit code, `run.status`, and `summary.exitCodeRecommendation` agree in tests.

### Phase 9: Documentation And Release Hardening

Deliverables:

- Complete docs.
- Add examples.
- Add packaged smoke.
- Update changelog when ready.
- Update package export/files configuration for schemas.
- Update package export/files configuration for tool descriptors and docs used by agents.

Acceptance:

- `pnpm lint`, `pnpm typecheck`, `pnpm test:run`, and `pnpm build` pass.
- Packaged CLI smoke passes from the tarball.
- Docs match shipped behavior.
- Installed package includes the schema and exposes it through `--agent-schema`.
- Installed package includes tool descriptors and exposes them through `--agent-tool-schema`.

## File-Level Work Breakdown

### CLI And Options

Files:

- `src/types/options.ts`
- `src/cli/args-schema.ts`
- `src/cli/normalize-args.ts`
- `src/validate-options.ts`
- `src/cli/capabilities.ts`
- `package.json`
- `build.config.ts`

Tasks:

- Add options.
- Normalize flags.
- Validate conflicts and requirements.
- Update capabilities output and tests.
- Ensure schemas are included in package output.

### Agent Core

Files:

- `src/commands/check/agent/types.ts`
- `src/commands/check/agent/collector.ts`
- `src/commands/check/agent/output.ts`
- `src/commands/check/agent/stream.ts`
- `src/commands/check/agent/schema.ts`
- `src/commands/check/agent/artifacts.ts`
- `src/commands/check/agent/tool-descriptors.ts`
- `src/commands/check/agent/fingerprint.ts`
- `src/commands/check/agent/purl.ts`
- `src/commands/check/agent/errors.ts`
- `src/commands/check/agent/redact.ts`

Tasks:

- Define contract.
- Implement collector.
- Emit final JSON.
- Emit stream events.
- Print packaged schema.
- Print packaged tool descriptors.
- Record artifacts and hashes.
- Generate deterministic fingerprints.
- Generate package identity values.
- Build structured problem records.
- Redact sensitive values.

### Dependency Decisions

Files:

- `src/io/dependencies/parse.ts`
- `src/io/dependencies/overrides.ts`
- `src/io/resolve/resolve-dependency.ts`
- `src/io/resolve/version-filter.ts`

Tasks:

- Record skipped dependencies.
- Record resolver decisions.
- Attach Package URL and source-location evidence where possible.
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
- `src/commands/check/agent/command-runner.ts`

Tasks:

- Build write plan.
- Compute plan hashes and precondition hashes.
- Attach write results.
- Report already-applied write items deterministically.
- Cover globals and catalogs.
- Keep raw child output out of stdout.

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
- `src/commands/check/agent/annotations.ts`
- `src/commands/check/agent/fingerprint.ts`

Tasks:

- Derive risks.
- Derive next actions.
- Add tests for all risk/action combinations.
- Derive CI annotations from risks/actions.
- Generate stable fingerprints for CI de-duplication.

## Backward Compatibility

- Do not change default table output.
- Do not change JSON v1 field names or schema version.
- Do not change existing exit codes outside explicit agent CI behavior.
- Keep public library exports backward compatible.
- Add new exports only where useful.
- Do not require new runtime dependencies unless the schema validation path truly needs one.

## Open Questions

- Should `--agent` remain a top-level flag only, or should `--output agent-json` be added
  later as an alias?
- Should `--agent --plan` exit `0` when updates are planned, or mirror outdated CI behavior
  only when `--ci` is also set? Current recommendation: exit `0` unless `--ci` is set.
- Should command output previews default to 16 KiB per stream, or should the first release
  use a smaller 4 KiB limit?
- Should risk thresholds be configurable in `.depfreshrc` in v1, or deferred?
- Should the agent schema include package manager lockfile diff hashes, or only sync status?
- Should SARIF export ship in v1 or wait until core annotations are proven?
- Should `--agent-output` be required when `--agent --stream --write --install` is used, or
  is a terminal `summary` event enough for v1?

## Initial Success Criteria

The feature is complete when:

- An automation can run `depfresh --agent --plan` and know exactly what files would change.
- An automation can run `depfresh --agent --write --install` and know exactly what changed,
  whether install/update succeeded, and what remains to do.
- Every skipped dependency has a stable reason.
- Bun lockfile sync state is explicit.
- Global package updates are represented as write plan entries.
- Risks and recommended actions are machine-readable.
- CI annotations are machine-readable and platform-neutral.
- `--agent --stream` provides useful long-running progress without ANSI output.
- The emitted JSON validates against the committed schema.
- The packaged CLI can print its schema.
- Agent-mode child commands do not corrupt stdout.
- Existing table and JSON v1 behavior remains compatible.
