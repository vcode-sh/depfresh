# Hosted macOS packed Visual+ replay diagnosis

## Scope and outcome

- Candidate: `eed33777ac374b8f7e46a4ac585971e955c5457d`
- Workflow run: `29683662980`
- Original failing job: `88184164463`
- Exact failing step: `Replay Visual Plus against the installed packed artifact`
- Classification: a nondeterministic hosted test/process event, not deterministic package, hash,
  npm, path-length, or global-timeout behavior.

The original child assertion cannot be recovered. The verifier intentionally retained its stdout
and stderr privately, emitted only `Installed Visual+ replay failed`, and removed its owned
temporary root. The unchanged retry on the same commit and runner image passed. Therefore this
change does not claim a more specific historical assertion or alter Visual+ product behavior.

## Paired hosted evidence

Both attempts used `macos-15-arm64` runner image `20260715.0234.1` with different hosted machines.

| Attempt | Source Visual+ | Installed packed Visual+ | Result |
| --- | --- | --- | --- |
| 1, job `88184164463` | 32/32 in 40.15s | failed after 52.24s | failed |
| 2, job `88185390424` | 32/32 in 57.01s | passed in 43.61s | passed |

The identical commit, image, workflow, tarball contract, and fixed 15-minute verifier deadline
produced opposite packed outcomes. The slower source pass on attempt 2 also rules out a simple
whole-suite CPU or deadline threshold.

## Exact local reproduction controls

The local macOS arm64 checkout was clean at the exact candidate commit before diagnosis. The exact
toolchain was activated through mise:

```text
Node v24.15.0
npm 11.12.1 for the repository
npm 11.12.0 for the hosted-style isolated npm prefix
pnpm 10.33.0
```

Frozen install and build passed. A hosted-style isolated root nested below a synthetic
`Users/runner/work/_temp` path supplied isolated `RUNNER_TEMP`, `HOME`, npm cache/config, XDG cache,
and a deliberately long `TMPDIR`. The resulting fixture filler prefix was 227 bytes before its
220-byte filename body, longer than the corresponding hosted prefix. The unchanged packed verifier
still passed 32/32 tests and retained the exact artifact identity:

```text
tarball: depfresh-2.1.0.tgz
integrity: sha512-OkDqQ4V1MKAeJJbMBbXYTiigjFqV72aD4UEAHuHSKM0sc/G1j4kQZCRqTnPXFY792LGhzBaLbg2sJ3ZPOn4Rbg==
installed CLI SHA-256: 3a7980e4be50ff11e732ac1c9e47c1e4b6583abf573d036b6326fc5ab6dcbdfd
```

The exact tarball was then installed manually. The Visual+ Vitest child ran directly with the
verifier's minimal environment so a real assertion would have been visible. It passed 32/32 in
50.91s. Four additional JSON-report repetitions under the same long root passed 32/32. This
disproves deterministic installed-byte, canonical-path, npm-version, minimal-environment, and
absolute-path-length hypotheses on the available local macOS host.

## Proof-hardening change

The repository Vitest configuration retries a failing test twice by default, which the RED output
made visible as `retry x2`. Release evidence must not silently convert a transient failure into a
pass, so both hosted source Visual+ and the verifier's full installed replay now pass `--retry=0`
explicitly.

When a no-retry installed replay exits nonzero and a JSON report exists, the verifier reads only
the failed assertion status and exact full title. A pure allowlist maps trusted titles to fixed,
bounded categories such as `pty-process-cleanup`, `pty-evidence`, and `product-journey`. Multiple
trusted categories become `multiple-known`; malformed, incomplete, count-mismatched, or unknown
input becomes `unclassified`.

The classifier never reads or emits failure messages, paths, argv, environment, stdout, stderr, or
stacks. The verifier continues to keep raw child output private and bounded. Tarball bounds, path
binding, byte/hash comparison, distinct-byte negative control, timeouts, and cleanup remain
unchanged.

## TDD and verification evidence

RED:

- The focused workflow/verifier tests failed on the two missing explicit `--retry=0` contracts.
- After a fail-closed classifier scaffold, the classifier suite failed on five expected trusted
  mappings while its malformed and untrusted cases already returned `unclassified`.

GREEN before the final gate:

- Focused classifier/verifier/readiness: 3 files, 31 tests passed with `--retry=0`.
- Source Visual+: 1 file, 32 tests passed with `--retry=0` in 53.19s.
- Post-change packed verifier in the reproducing long environment: two consecutive passes, each
  with 32 installed Visual+ tests and the exact CLI SHA-256 above.

Fresh final gate:

- Focused classifier/verifier/readiness: 3 files, 31 tests passed with `--retry=0`.
- Generated schemas: passed.
- TypeScript typecheck: passed.
- Biome: 354 files checked with `--error-on-warnings`, no fixes or warnings.
- Release readiness: 5 files, 103 tests passed with `--retry=0`.
- `git diff --check`: passed.

No push, tag, publication, registry mutation, or release-evidence completion claim occurred.

## Subsequent no-retry isolation and adapter correction

The hardened no-retry run `29685151490` isolated the macOS installed replay to the fixed fallback
category. Splitting the fallback journeys then made the next exact run `29685720822` expose the
specific failure in the macOS source CI fallback: the normalized capture observed one lone carriage
return where the contract requires zero. Ubuntu source and installed Visual+, full Test, Lint,
Build, and Distribution Smoke passed on that exact SHA; the macOS installed replay was not reached.

Repeated isolated CI and TERM=dumb controls, including bounded CPU load, retained zero lone carriage
returns locally. A synthetic BSD nested-PTY control demonstrated a deterministic local mechanism
consistent with the hosted symptom: the pre-fix Expect/script adapter could transform one line
ending into `CRCRLF`, which normalizes to one lone carriage return. The raw hosted bytes remain
private, so this does not claim recovery of their exact sequence or a uniquely proven hosted root
cause. The correction in `054dea9` makes the outer Expect PTY raw/no-echo and explicitly gives the
inner CLI PTY the one `opost onlcr` transform. Commits `66f6d81` and `29cc9c6` strengthen the live
termios regression so it fails on the pre-fix macOS adapter while retaining the correct, narrower
output-mode contract on Linux util-linux.

Fresh exact-Node source and packed Visual+ replays each passed 36/36 with `--retry=0`; the packed
integrity and CLI SHA-256 remained unchanged. Focused tests passed 39/39, and build, schemas,
typecheck, zero-warning Biome, and diff checks passed. Independent final review reproduced macOS
RED/GREEN and real Linux GREEN and reported C0/I0/M0. No normalizer, cleanup, raw-output privacy,
or zero-lone-CR assertion was weakened. This remains local correction evidence pending a new exact
hosted `main` run; no tag or publication claim is made.

## Installed CI fallback phase isolation

Run `29687703913` at `b8a4f50532e58407a110e979231760e7fc7f66a7` passed the macOS source
Visual+ suite 36/36 and the complete Ubuntu source/installed lane. Full Test, Lint, Build, and
Distribution Smoke also passed. The macOS installed replay failed with the fixed
`fallback-ci-pty` category, and its later reduced-motion step was not reached. The category proves
only which journey failed. Because the bounded private report was removed during owned cleanup, it
does not retain enough evidence to identify the historical assertion or claim a root cause.

An exact local workflow-style replay used Node `24.15.0`, isolated npm `11.12.0`, long hosted-like
HOME/TMPDIR/CLI paths, and installed tarball bytes. It passed 36/36, and 20 subsequent focused
installed CI fallback controls also passed. This weakens deterministic artifact, path-length,
isolated-environment, and dependency-install hypotheses but does not convert the hosted failure into
a pass.

Commit `0280309` keeps one CI fixture and one PTY journey while replacing the aggregate assertion
title with five sequential, exact title-only phases: execution/evidence, semantic output, terminal
controls, transition uniqueness, and read-only bytes/Git state. Each phase becomes ready only after
the previous phase passes, so later checks cannot obscure the first violated contract. Setup/run
errors become a fixed execution-readiness failure; original errors are neither retained nor
re-thrown. The classifier continues to ignore failure messages, raw output, paths, environment, and
stacks. Source and packed replays passed 40/40 with `--retry=0`; focused contracts passed 43/43,
release gates passed 103/103, and build, schemas, typecheck, zero-warning Biome, artifact identity,
and diff checks passed. Independent review reported C0/I0/M0. This is diagnostic evidence only; a
new exact hosted all-job success remains mandatory before tagging.

## Process identity lifecycle correction

Exact `main` run `29688672949` at `601c932012053b31da42a3611352bf39bb50c2aa` passed the complete
Ubuntu source and installed Visual+ lane, full Test, Lint, Build, and Distribution Smoke. The macOS
source lane passed 39/40 tests, including all five CI fallback diagnostic phases, then failed the
first 40-column success journey at `registerEvidenceIdentity` with
`PTY process identity evidence changed`. The installed replay and reduced-motion step were skipped.
The cleanup aggregate was a consequence of the primary path setting the ambiguity flag.

Two independent read-only audits agreed on a deterministic control-flow mechanism consistent with
the hosted symptom. The observer defines stable identity as PID plus start token and process group,
so a parent-only transition is the same process. It nevertheless overwrote the first parent after a
valid macOS wrapper reparenting, and the final sidecar check then compared that terminal parent with
the wrapper's historical parent. The private hosted report does not retain the compared tuples, so
the exact transition is not claimed as recovered from that run. The TDD fix
records the first topology only, retains the exact historical-parent check, limits `/bin/ps` to the
current numeric UID, and marks changed start/group or absent-then-reappeared PID evidence ambiguous
without adopting or signaling it. Cleanup remains parent-insensitive only for the unchanged exact
PID/start/group tuple and retains TERM/KILL, survivor, and aggregate-error behavior.

The deterministic focused RED failed three contracts: first-parent preservation, same-user scan
arguments, and absent-then-reappeared lifecycle state. Focused GREEN passed 6/6. Exact Node
`24.15.0` source/verifier/readiness passed 66/66, source Visual+ passed 46/46 without retries, and an
isolated npm `11.12.0` packed replay passed 46/46. The latter retained 56 files, 332890 packed bytes,
the reviewed SHA-512 integrity, and installed CLI SHA-256
`3a7980e4be50ff11e732ac1c9e47c1e4b6583abf573d036b6326fc5ab6dcbdfd`. The complete no-retry suite
passed 162 files and 2,177 tests; release gates passed 103/103; schemas, typecheck, build, full
zero-warning Biome, and diff checks passed. Two independent final reviews reported C0/I0/M0 after
direct Darwin and Linux procps same-user probes. This is local correction evidence only; a new exact
hosted all-job success remains required before tagging.

## CLI identity-axis isolation

Exact `main` run `29690064055` at `c091c8d7fe87d35b9beeb1149ad0ccc56195cc20` passed the complete
Ubuntu source/installed lane, full Test, Lint, Build, and Distribution Smoke. The macOS source suite
passed 45/46 tests and again failed the first 40-column success journey. Its installed replay and
reduced-motion step were skipped. The primary stack now points to CLI evidence registration rather
than wrapper registration; the cleanup ambiguity remains consequential.

The generic registration error combines parent, group, and start mismatches. The hosted report does
not retain the compared tuples, so it cannot support an identity-rule change. A diagnostic-only TDD
slice assigns fixed `wrapper`/`cli` roles and exact allowlisted parent/group/start combination labels
without changing any comparison, ambiguity flag, matching, signaling, cleanup, or survivor rule.
RED failed 6/6 against the prior generic signature. Exact Node `24.15.0` GREEN passed all 9
fixed-label/privacy cases, the unchanged Visual+ suite passed 46/46 with retries disabled, typecheck
passed, focused zero-warning Biome passed, and diff checks passed. Exact-message tests prove the
diagnostics contain no PID, parent PID, process-group ID, start timestamp, path, environment value,
or raw child output value. This is local diagnostic evidence only. The complete no-retry suite
passed 163 files and 2,186 tests;
schemas, typecheck, full zero-warning Biome, and diff checks passed. Two independent reviews reported
C0/I0/M0 after one privacy-wording correction. A new exact hosted run remains mandatory.
