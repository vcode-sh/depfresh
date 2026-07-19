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
