# Integrations

Reference patterns for running depfresh in CI and tool ecosystems.

Want a ready-made workflow instead of copy-paste therapy?

- **[GitHub Action](./github-action.md)** -- fixed-input check/capabilities/inspect/plan/apply
  workflows with structured contracts.
- Repository workflow: `.github/workflows/dependency-freshness.yml`

Looking for taze comparisons? Those live in [docs/compare/](../compare/).

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
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009b4744f4bb1efb9dd2dec
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

## Thin MCP Wrapper

If you want depfresh exposed as a tool in an MCP server, keep the wrapper thin:

1. Accept typed tool input (cwd, mode, write, failOnOutdated) and reject unknown fields.
2. Build a shell-safe argument array and execute depfresh with `--output json`; only the active
   request may add `--write`.
3. Return parsed JSON directly to the MCP client.
4. Preserve depfresh exit codes in tool errors/status.

Example wrapper command:

```bash
depfresh --output json --cwd /path/to/workspace
```

Recommended mapping:
- Tool success payload: full depfresh JSON envelope
- Tool warning state: exit code `1` with parsed JSON attached
- Tool error state: exit code `2` with the parsed JSON error envelope and stable `error.reason`

For dynamic tool UIs, discover flags and enum values via:

```bash
depfresh --help-json
```
