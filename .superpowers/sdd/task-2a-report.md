# Task 2A: Retained installed-artifact Visual+ replay

## Delivered

- Added a paired Visual+ CLI/install-root resolver with source-tree default, absolute-path checks,
  canonical containment, regular-file enforcement, symlink rejection, and sanitized missing-path errors.
- Bound the full Visual+ product suite to the resolver at module load and added a focused selected-artifact execution test.
- Added `--visual-plus` to the packed verifier. It extracts `package/dist/cli.mjs` from the verified tarball in-process, compares SHA-256 with the canonical installed CLI, runs a distinct-byte outside-root negative control, and replays the complete Visual+ suite with bounded private child output.
- Added aggregate replay evidence to the final verifier JSON: canonical CLI path, CLI SHA-256, and exact passed-test count.
- Added installed-artifact replay to every Linux/macOS Visual+ CI matrix leg and to release tarball verification before upload.

## TDD evidence

- RED: the focused resolver import test failed because the helper module was absent.
- RED: the pre-wiring full Visual+ suite passed with a deliberately invalid artifact override, proving the override was ignored.
- RED: after wiring, the invalid override failed at module load because the CLI path was invalid.
- RED: verifier and workflow contract tests failed before the `--visual-plus` implementation and CI/release wiring.
- RED: missing CLI input reflected its path before the resolver sanitized the error.
- GREEN: focused resolver/verifier/readiness suite: 29 tests passed.

## Verification

- `mise exec node@24.15.0 -- pnpm build` passed.
- `mise exec node@24.15.0 -- pnpm exec vitest run test/visual-plus-cli.test.ts` passed: 32 tests.
- Local packed replay passed with `--visual-plus`: 32 tests, installed CLI SHA-256 `3a7980e4be50ff11e732ac1c9e47c1e4b6583abf573d036b6326fc5ab6dcbdfd`.
- `mise exec node@24.15.0 -- pnpm schemas:check` passed.
- `mise exec node@24.15.0 -- pnpm typecheck` passed.
- `mise exec node@24.15.0 -- pnpm exec biome check --error-on-warnings .` passed.
- `mise exec node@24.15.0 -- pnpm test:release` passed: 103 tests.
- `git diff --check` passed.

## Review follow-up

- The Ubuntu/macOS Visual+ CI matrix now bootstraps exact npm `11.12.0` in a disposable runner root, exports only its isolated configuration, and removes it in an always cleanup step.
- The verifier now creates a minimal allowlisted Visual+ test environment with verifier-owned HOME, temporary, and cache paths; it does not inherit the complete parent environment.
- The focused identity control retains the fixed 120-second bound, while the unchanged complete replay has a fixed 15-minute bound with no environment or CLI override.
