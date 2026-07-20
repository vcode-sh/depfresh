# Inspect and Plan Contracts

`inspect` and `plan` are the versioned machine interfaces for reviewable dependency automation.
The separate [Apply Contract](./apply.md) consumes one validated plan under explicit authority and
never silently re-resolves it.
Both emit exactly one JSON document to stdout in JSON mode. Fatal command failures use the separate
error contract and exit `2`; diagnostics never corrupt stdout.

```bash
depfresh inspect --json
depfresh plan --json
```

`--output json` is accepted as an equivalent spelling for these two commands. It does not change
the meaning of the legacy top-level `depfresh --output json` check report.

## Shipped schemas

The package exports strict JSON Schema draft-07 artifacts:

- `depfresh/schemas/inspect-v1.json`
- `depfresh/schemas/plan-v1.json`
- `depfresh/schemas/plan-v2.json` (current producer)
- `depfresh/schemas/error-v1.json`

Each document has a `contract` discriminator, a supported `schemaVersion`, and the producing `toolVersion`.
Consumers must reject unsupported contract/schema combinations before interpreting fields. The
same authoritative descriptors derive the public TypeScript result types, runtime validators, and
packaged files.

## Inspect

`inspect` reads contained repository files and returns canonical relative sources, exact source
byte hashes, source files, packages, catalogs, boundaries, relationships, runtime declarations,
dependency occurrences, evidence conclusions, lockfiles, diagnostics, and risks. Evidence
conclusions retain their values and complete file/field/probe sources, so every emitted entity and
reference can be resolved without consulting hidden process state. It
does not contact a registry, execute any process, evaluate project configuration, create cache
state, or write files. Because the Plan 016 Git adapter is a subprocess, this command records VCS
as unavailable with `VCS_PROBE_DISABLED`; it never invents clean Git state.

The lower-level `inspectRepository()` compatibility API still performs its documented fixed,
read-only Git probe. Use `inspect()` for the process-free contract.

## Plan

`plan` adds registry reads and policy/candidate evaluation. It uses an in-memory cache and performs
no repository, cache, manager, lifecycle, shell, or configured-command writes. Its only allowed
subprocess is the fixed read-only Git evidence adapter inherited from the repository model; optional
locks, refresh helpers, and mutation-capable Git behavior remain disabled.

Machine planning reads only declarative JSON configuration: `depfresh.config.json`,
`.depfreshrc.json`, JSON `.depfreshrc`, or `package.json#depfresh`. If normal precedence selects a
JavaScript or TypeScript config, planning fails with `EXECUTABLE_CONFIG_FORBIDDEN` before importing
it. Configuration can shape policy but never grant side-effect authority.

Current plans use schema v2 and always contain `selection`. CLI workspace/catalog requests record
their exact values, matched package or physical-catalog entity IDs, bound occurrence IDs, and
derived counts. The receipt is fingerprinted and validators recompute its entity, decision,
operation, shared-owner, and summary bindings. A library plan contains the same mandatory shape
with empty requests. Apply dispatches v1/v2 by discriminator and continues to accept unchanged
reviewed v1 plans.

Every inspected occurrence appears exactly once in `decisions` as `operation`, `unchanged`,
`skipped`, `blocked`, `unknown`, or `error`. The record retains its policy trace and, when registry
resolution ran, its candidate reason, eligible versions, and selected target. Catalog consumers are
explanatory decisions; only physical owners produce operations. Unknown and errors remain explicit.

Every newly produced plan also includes `signals`, `signalEvidence`, and `summary.signals`. The
extension remains optional at the schema-v1 compatibility boundary so previously valid immutable
plans remain consumable. New producers always emit it. Signal state is immutable evidence truth;
ordered `signalRules` can change only `effect`. A blocking effect converts affected candidate
operations to `SIGNAL_POLICY_BLOCKED` without reselecting a target. See
[Compatibility Signals](./compatibility-signals.md) for the complete vocabulary and limits.

An operation includes:

- exact occurrence and source-file IDs;
- canonical repository-relative file and nested path;
- exact source-byte SHA-256;
- exact expected declaration text;
- exact requested stored text.

Credential-bearing expected or requested values cannot be both public and exact after redaction.
Those occurrences are blocked with `SENSITIVE_VALUE_REDACTED` and never become operations.
Non-public occurrence or evidence text is replaced with a stable redaction marker and accompanied
by a material risk; unsafe identity paths fail the contract instead of producing an inexact path.

`requiredCapabilities` describes what a downstream consumer needs to review or apply the result.
`inspect` requires only `filesystem-read`; `plan` adds `registry-read`, and includes `file-write`
only when its operations would require that separate apply authority. A requested manager phase
that resolves to `ready` adds `process-execute` and `lockfile-write`; ready full install adds
`install`, ready reviewed verification adds `verify-command`, and ready exact-artifact verification
adds `artifact-verify` plus `network-access`. Blocked and operation-free phase requests add no
process capability. Planning itself uses none of those side-effect capabilities.

The `execution` object fingerprints `file-only`, `sync-lockfile`, or `install` intent, the phase
timeout, and each affected boundary's confirmed manager name/version, parsed lockfile ID/path/hash,
fixed adapter argv, lifecycle suppression, permitted paths, and external-effect class. Optional
verification is an exact executable/argv, contained cwd, timeout, and empty write allowlist.
Unsupported or ambiguous evidence leaves execution `blocked`; it never invents an npm fallback.
Operations outside standard dependency fields are blocked because their lockfile occurrences cannot
yet be reconciled exactly. Only registry-backed `semver` and `npm:` alias protocols have exact
cross-manager lockfile proof; other protocols block manager execution before apply. Manager
execution is also blocked on Windows until equivalent inherited-descendant process observation
exists. For an `npm:` alias, proof binds both the manifest alias key and the exact aliased registry
package identity; matching only the version is insufficient.

With `verifyArtifacts`, an install plan also fingerprints one verification unit per npm boundary:
confirmed npm 11.12.x or verified npm 12.0.x identity, public npm registry, fixed
`["audit","signatures","--json","--include-attestations","--ignore-scripts"]` argv, timeout,
policy rules, and every physical artifact's exact package/version/SHA-512 integrity plus occurrence
consumers and passive-presence evidence. Artifact identity excludes consumers and presence, so it
remains the identity of the physical registry artifact. Pnpm, Bun, JSR, private registries, missing
integrity, and unsupported npm versions block the requested verifier rather than weakening the
claim. Presence is plan evidence only and never becomes verified trust.

Cooldown is time-dependent. When `--cooldown` is positive, supply a canonical UTC instant such as
`--as-of 2026-07-16T10:00:00.000Z`. The instant is semantic plan input and participates in the plan
fingerprint. With cooldown disabled, the contract uses the fixed epoch so identical evidence stays
byte-identical.

## Fingerprints

Source hashes are lowercase SHA-256 over exact bytes, including BOMs, newline style, and trailing
newlines. The repository fingerprint is SHA-256 over UTF-8 canonical JSON containing schema
version, the repository-relative root identity, and sources sorted by relative path with byte hash.

The plan fingerprint is SHA-256 over the complete canonical semantic plan, including signals,
signal evidence, explicit cohort results, and override traces. Only top-level
`planFingerprint`, `generatedAt`, and `presentation` fields are excluded; arrays retain semantic
order and object keys are recursively sorted by code unit. Consumers must recompute both
fingerprints instead of trusting supplied values.

Canonical JSON accepts only plain JSON data with finite numbers, dense arrays, enumerable data
properties, and no cycles, accessors, symbol keys, or hidden state.
Proxy objects are rejected before any proxy trap is invoked.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Complete result with no operation, material risk, block, unknown, or error |
| `1` | Valid result with operations, material risks, or non-fatal blocked, unknown, or error decisions |
| `2` | Fatal input, schema, configuration, or runtime error prevented a trustworthy result |

Library `inspect()` and `plan()` return typed results and never set or exit the process. Fatal
library failures throw structured errors with stable codes/reasons; callers decide how to map them.
