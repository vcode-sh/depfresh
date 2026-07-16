# GitHub Action

The composite Action installs the exact depfresh version recorded in its reviewed `package.json`
from the fixed public npm registry, using an owned temporary home, cache, empty user/global config,
and prefix. It invokes the exact contained installed CLI path, validates results with the sibling
installed library, verifies the package version, and removes the owned installation. Pin the Action
itself to a reviewed full commit SHA.

## Inputs

| Input | Default | Contract |
| --- | --- | --- |
| `command` | `check` | `check`, `capabilities`, `inspect`, `plan`, or `apply` |
| `mode` | `default` | One published range mode; check/plan only |
| `write` | `false` | Legacy check write, or required explicit apply grant |
| `plan-file` | empty | Contained regular non-symlink file; apply only |
| `sync-lockfile` | `false` | Plan/grant the reviewed sync phase |
| `install` | `false` | Plan/grant the contained install phase |
| `verify-artifacts` | `false` | Requires install and exact reviewed trust evidence |
| `fail-on-outdated` | `true` | Legacy check exit policy |
| `include` / `exclude` | empty | One inert pattern argument each; check/plan only |
| `recursive` | `true` | Recursive check/inspect/plan discovery |
| `working-directory` | `.` | Existing physical directory inside the workspace |
| `node-version` | `24.15.0` | Exact stable version at or above the minimum |

Inputs are validated before setup and installation. Booleans accept only lowercase `true`/`false`.
Sync and install conflict; artifact verification requires install. Inspect/capabilities cannot
receive policy or authority inputs. Plan cannot receive write authority. Apply requires `write` and
the unchanged reviewed plan. There is no arbitrary argv input and no shell-string evaluation.

The Action exposes `json`, `exit-code`, `contract`, `result-status`, `has-findings`, plus the legacy
`outdated-count` and `has-updates`. Contract/exit mismatches fail closed. Raw installation/CLI
diagnostics remain in temporary files that an `always()` step removes.
The install does not inherit project/user npm config, registry credentials, proxy variables, or a
global prefix. A same-version executable earlier in `PATH` is not used.

## Read-only plan gate

Replace the placeholder with a reviewed full commit SHA before use:

```yaml
name: Dependency plan
on:
  pull_request:
permissions:
  contents: read
jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009b4744f4bb1efb9dd2dec
      - uses: vcode-sh/depfresh@d90574717322ac71dfd615fec81e2b2100a8844b
        id: depfresh
        with:
          command: plan
          node-version: 24.15.0
      - name: Preserve machine result
        if: always()
        env:
          DEPFRESH_JSON: ${{ steps.depfresh.outputs.json }}
        run: printf '%s' "$DEPFRESH_JSON" > "$RUNNER_TEMP/depfresh-plan.json"
```

This job has no mutation authority. Treat exit `1` as a reviewable plan with findings and exit `2`
as fatal/incomplete.

## Opt-in protected apply

The apply job must consume the exact reviewed plan artifact and reviewed commit in a clean
workspace. Use the packaged
[`protected-apply.yml`](../../skills/depfresh/examples/protected-apply.yml) template. It requires an
exact 40-character reviewed commit, numeric source run, and reviewed plan-file SHA-256; checks out
that commit without persisted credentials; downloads the named artifact from that run; verifies the
file digest; and runs in an environment-protected job before passing the contained file to the
Action.

Add `sync-lockfile`, `install`, or `verify-artifacts` only when present in and approved from the
plan. A stale/conflicted/unknown exit `1` requires a new plan; it is never retried by weakening
evidence. The Action stops after observed local apply. It does not stage, commit, push, create an
issue/PR, merge, tag, publish, or deploy.

Exact verification argv is intentionally not exposed by this fixed-input Action. Use the pinned
CLI with an argument array when that separately reviewed capability is required.

## Release coupling

The repository release workflow accepts only `v${package.json.version}`, uses exact Node 24.15.0
and an isolated npm 11.12.0 tool, then runs schemas, types, zero-warning lint, adversarial and full
tests, coverage, build, smoke, dry-run packaging, and installed-tarball verification. It uploads one
verified tarball and publishes only those exact bytes after approval of the `release` environment.
Safe reruns skip publication only when the existing public version has identical SHA-512 integrity.
The public artifact is then installed and its CLI, library exports, capabilities version, and every
package export are rechecked.

Curated hosted release creation is a separate `release-hosted` environment boundary with only
repository-content permission. The workflow does not create or move a mutable Action tag; that is a
separate manual decision after the exact public package has been verified.
