# Plan 010: Action runtime and input hardening

## Contract

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: none
- **Planned at**: `8eea9c5` plus completed plan 009, 2026-07-15
- **Status**: DONE

## Objective

Make the published composite Action execute a reviewed depfresh version on a supported Node runtime
and pass every user-controlled value as data, never shell syntax. Preserve current read-only and
write workflows while making version coupling and capability boundaries explicit.

## Current evidence

- `action.yml` installs floating `depfresh` globally, so the executed package can differ from the
  reviewed Action revision.
- `node-version` defaults to broad `24` and accepts versions below the new `24.15.0` floor.
- `extra-args` intentionally uses shell word splitting and can change command structure.
- boolean inputs are not rejected when malformed; several values silently behave as false.
- output parsing assumes `jq` and transports the complete JSON payload through Action outputs.

## Owned files

- `action.yml`
- `.github/workflows/ci.yml` only for an Action fixture/job
- a narrowly named Action test fixture or script under `test/`
- `docs/integrations/github-action.md`, `docs/integrations/README.md`, `README.md`, and
  `CHANGELOG.md`
- package/build files only if the chosen revision-coupled distribution requires them

Do not modify core CLI semantics, policy, repository discovery, or apply behavior in this plan.

## Drift check

Before editing, run `git status --short`, read `action.yml` and its documentation, and inspect any
workflow changes since `8eea9c5`. Stop if another change owns Action inputs, package distribution, or
release versioning. Preserve the uncommitted plan 009 files.

## Implementation tasks

1. Add a failing harness that invokes the composite steps or their extracted script behavior with
   spaces, quotes, newlines, option-looking values, malformed booleans, invalid modes, and a Node
   version below `24.15.0`.
2. Select and document one revision-coupled runtime strategy: bundled reviewed output, an exact
   package version recorded with the Action release, or a required exact version input validated
   against release metadata. A floating global install is not acceptable.
3. Replace `extra-args` with a structured, safely decoded format or remove it. Never use `eval`,
   unquoted interpolation, or shell word splitting for user input.
4. Validate all enum, boolean, version, and working-directory inputs before installation or writes.
   Reject malformed input with exit code 2 and a stable annotation.
5. Build argument arrays only. Separate read authority from write authority; `write: true` must be
   the only current input that grants manifest mutation.
6. Keep the exact minimum runtime at `24.15.0` or higher and reject an incompatible override before
   running depfresh.
7. Make temp-file cleanup unconditional, keep JSON on stdout/output channels, and ensure fatal
   diagnostics do not echo raw secrets or command lines.
8. Update Action docs with exact version coupling, input grammar, exit codes, permissions, write
   behavior, and upgrade procedure.

## Acceptance evidence

- malicious-looking input remains a single inert argument or is rejected;
- malformed booleans, modes, versions, and structured arguments fail before side effects;
- the runtime package version is mechanically tied to the reviewed Action release;
- read-only use cannot gain write/install/execute capability through extra arguments;
- exact Node `24.15.0` works and an older override is rejected;
- Action harness, `pnpm typecheck`, `pnpm lint`, `pnpm test:run`, `pnpm build`, and package dry-run
  pass;
- documentation examples execute against a temporary fixture.

## STOP conditions

Stop and update this plan if revision coupling requires publishing, changing core CLI authority, or
editing a release pipeline owned by another active change. Never publish during verification.

## Completion record

Completed on 2026-07-15.

- Changed `action.yml`, `.github/workflows/ci.yml`, `test/github-action.test.ts`,
  `docs/integrations/github-action.md`, `docs/integrations/README.md`, `README.md`, and
  `CHANGELOG.md`.
- Chosen coupling strategy: the Action reads the exact version from its reviewed `package.json`,
  installs `depfresh@<exact-version>` with lifecycle scripts disabled, and verifies the installed
  CLI version before execution. The default and minimum accepted runtime is exactly Node 24.15.0.
- Removed `extra-args`. Exact lowercase booleans, modes, runtime versions, and canonical
  workspace-contained directories are validated before installation. `write: 'true'` is the sole
  mutation grant. Include/exclude values use one `--name=value` argument so option-looking values
  remain data at the real CLI parser boundary.
- Added 53 Action tests covering spaces, quotes, newlines, shell syntax, option-looking values,
  malformed booleans and modes, old/floating runtimes, directory traversal and symlink escapes,
  version mismatch/install failure redaction, exit behavior, workflow-command-shaped JSON,
  invalid/missing/unsafe totals, unconditional cleanup, real CLI parser behavior, and the
  documented default flow. The red tests exposed and fixed both the option-looking argument
  boundary and the prior false-success behavior for empty or incomplete JSON output.
- Verification passed: frozen install with pnpm 10.33.0; `pnpm typecheck`; `pnpm lint` (202 files);
  focused Action suite (53/53); full suite (98 files, 894/894); build; smoke suite (26 checks, 52
  local registry requests); package dry-run (21 files, 49,430 bytes); exact Node 24.15.0 focused
  suite (53/53); literal Action install on Node 24.15.0 with installed depfresh 1.2.0; ShellCheck
  for every Action script; scoped actionlint for the changed CI workflow; and `git diff --check`.
- Remaining limitation: these Action changes are unreleased. A release tag must not move until the
  matching bumped package version is published and verified. Publishing was intentionally not
  performed. Full-repository actionlint still reports pre-existing unquoted summary-file warnings
  in CI/PR workflows and an unconfigured custom `vps` runner label in the release workflow; the
  changed CI workflow passes the scoped check when those existing warning classes are excluded.
