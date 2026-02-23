# Integrations

Reference patterns for running depfresh in CI and tool ecosystems.

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
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: npx depfresh --output json --fail-on-outdated > depfresh-report.json
      - uses: actions/upload-artifact@v4
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

1. Accept tool input (cwd, mode, write, failOnOutdated).
2. Execute depfresh with `--output json`.
3. Return parsed JSON directly to the MCP client.
4. Preserve depfresh exit codes in tool errors/status.

Example wrapper command:

```bash
depfresh --output json --cwd /path/to/workspace
```

Recommended mapping:
- Tool success payload: full depfresh JSON envelope
- Tool warning state: exit code `1` with parsed JSON attached
- Tool error state: exit code `2` with stderr/error message

For dynamic tool UIs, discover flags and enum values via:

```bash
depfresh --help-json
```
