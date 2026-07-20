# Integrations

Reference patterns for running depfresh in CI and tool ecosystems.

Want a ready-made workflow instead of copy-paste therapy?

- **[GitHub Action](./github-action.md)** -- fixed-input check/capabilities/inspect/plan/apply
  workflows with structured contracts.
- Repository workflow: `.github/workflows/dependency-freshness.yml`

Looking for taze comparisons? Those live in [docs/compare/](../compare/).

For local human review, the eligible table route uses the in-progress Plan 038 hybrid composition;
its [five-region output and `--long` audit boundary](../output-formats/table.md) are separate from
the JSON contracts used by integrations.

## GitHub Actions

Minimal workflow that runs depfresh in gate mode and uploads the JSON report as an artifact.

```yaml
name: Dependency Freshness

on:
  pull_request:
  schedule:
    - cron: '0 6 * * 1'

jobs:
  depfresh:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: 24.15.0
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec depfresh --output json --fail-on-outdated > depfresh-report.json
      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a
        if: always()
        with:
          name: depfresh-report
          path: depfresh-report.json
```

Exit handling:
- `0`: up to date or successful writes
- `1`: outdated dependencies found with `--fail-on-outdated`
- `2`: fatal/config/runtime error

## Fixed-input machine wrappers

Use the packaged [official workflow](../agents/README.md) instead of exposing arbitrary argv or a
generic write boolean. A wrapper should:

1. run `depfresh capabilities --json` and validate
   the current advertised schema (`depfresh/schemas/capabilities-v2.json` in 2.1.1);
2. expose separate fixed-input read-only `inspect` and `plan` operations;
3. validate complete result documents with the exact installed library validators;
4. accept apply only as a distinct operation with one contained reviewed plan file and explicit
   matching invocation grants;
5. preserve exit `1` as a reviewable schema-valid result and exit `2` as fatal;
6. never infer file, process, install, verification, global, Git, or publishing authority from
   configuration or wrapper defaults.

Use one argument array and reject unknown fields before discovery. The published GitHub Action is
the reference fixed-input adapter; additional protocol adapters remain outside the 2.0 contract.
