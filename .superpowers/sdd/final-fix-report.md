# Plan 037 final-review fix report

**Date:** 2026-07-20
**Base:** `41f00026f948e02b79430e791f5dc60061aa0aa2`
**Implementation commit:** `d72140d6ae9192fe0ca07461bd6a8525ffa63cf4`

## Outcome

The final-review source/test/evidence correction is DONE. Plan 037 remains IN PROGRESS only for
the separately owned artifact refresh: rebuild, repack, exact artifact verification, Bun global
replacement, and a fresh Spreadoo smoke.

## Findings closed

- I1: repository naming no longer trusts `PackageMeta.name`. It uses an explicit raw JSON/YAML
  manifest name or the controlled effective-root basename. Unnamed JSON and YAML coverage proves
  that the absolute loader fallback is absent from the metadata document.
- I2: lockfile markers now require a lexical regular non-symlink file and a no-follow read open
  where supported. BigInt lstat/fstat device, inode, and file-type identity must match. The
  descriptor closes in `finally`. Contained symlink, replacement, and disappearance races fail
  closed as unavailable evidence.
- M1: the replay failure allowlist contains the exact five current compact journey full names for
  40, 60, 80, 118, and 175 columns. A coupling test derives the active titles from
  `test/visual-plus-cli.test.ts`; the retired title remains unclassified.

## RED and GREEN evidence

- I1 RED: `run-metadata.test.ts` failed 2/16 for unnamed JSON and YAML absolute-path exposure.
  GREEN: 16/16 passed.
- I2 RED: `run-metadata.test.ts` failed 2/18 for the contained symlink and deterministic
  replacement race. GREEN: 18/18 passed. A follow-up RED failed 1/19 when post-lstat removal was
  incorrectly collapsed to absence; final GREEN passed 19/19.
- M1 RED: `visual-plus-replay-failure.test.ts` failed 2/29 because the current title and all five
  coupled width titles were unclassified. GREEN: 29/29 passed and the obsolete title failed closed.

## Fresh verification

- Focused metadata, renderer, orchestration, replay-failure, verifier, readiness, and asset tests:
  7 files, 159 tests passed, retry disabled.
- Release suite: 5 files, 106 tests passed, retry disabled.
- `pnpm typecheck`: passed.
- `pnpm build`: schema check and build passed.
- Focused Biome: passed with no fixes or warnings.
- Full Biome: 358 files passed with zero warnings.
- `git diff --check`: passed before the implementation commit.

## Package-byte and release-evidence boundary

Package-byte impact is YES because the runtime metadata source and packaged replay script changed.
This task intentionally did not rebuild a tarball, rewrite artifact hashes or metrics, reinstall
Bun, run Spreadoo, publish, tag, push, or run hosted workflows. The existing 2.1.1 artifact,
installed-product, and live-smoke evidence is explicitly marked historical for `41f0002` in the
release note, Plan 037, plan index, and tracked progress file.

## Remaining concern

The corrected commit is not an exact local release candidate until the root pass regenerates and
verifies the package artifact, replaces the Bun global installation, and repeats the read-only
Spreadoo smoke. No hosted or public proof exists for 2.1.1.
