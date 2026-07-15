# GitHub Action

Because manually checking dependencies is a lifestyle choice, and not a good one.

## Quick Start

```yaml
name: Dependency Check
on: pull_request
jobs:
  depfresh:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: vcode-sh/depfresh@v1
        id: depfresh
      - run: printf '%s outdated deps found\n' "$OUTDATED_COUNT"
        env:
          OUTDATED_COUNT: ${{ steps.depfresh.outputs.outdated-count }}
```

The Action revision reads the exact depfresh version from its own reviewed `package.json`, installs
that exact npm release, and verifies the installed CLI reports the same version. A moving npm tag is
never used. If the matching package version is unavailable, the Action fails before running
depfresh.

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `mode` | `default` | Range mode. See [modes](../cli/modes.md). |
| `write` | `false` | Write updates to package files. |
| `fail-on-outdated` | `true` | Exit 1 when outdated deps found. Ignored when `write` is `true`. |
| `include` | `''` | Comma-separated package name patterns to include. |
| `exclude` | `''` | Comma-separated package name patterns to exclude. |
| `recursive` | `true` | Scan workspace packages recursively. |
| `working-directory` | `.` | Existing directory inside the checked-out workspace. |
| `node-version` | `24.15.0` | Exact Node.js version. Must be `>=24.15.0`. |

## Input and Authority Contract

- `mode` must be one of `default`, `major`, `minor`, `patch`, `latest`, `newest`, or `next`.
- Boolean inputs accept only the lowercase strings `true` and `false`.
- `node-version` must be an exact stable `major.minor.patch` version at or above `24.15.0`.
  Ranges, aliases, `v` prefixes, prereleases, and floating major versions are rejected.
- `working-directory` must exist and resolve inside `GITHUB_WORKSPACE`. Traversal and symlinks that
  escape the checked-out workspace are rejected.
- `include` and `exclude` are each passed as one argument. Spaces, quotes, newlines,
  option-looking text, and shell syntax do not create additional flags or commands.
- There is no arbitrary-argument input. Use the CLI directly when you need flags outside this
  Action's reviewed contract.
- `write: 'true'` is the only input that grants file mutation. The Action never exposes
  `--install`, `--update`, `--execute`, or `--verify-command`.

All validation happens before the package installation and before depfresh can write files.
Invalid input exits with code `2` and a stable error annotation that does not echo the rejected
value.

## Outputs

| Output | Description |
|--------|-------------|
| `json` | Full [JSON envelope](../output-formats/json.md). |
| `outdated-count` | Number of outdated dependencies. |
| `exit-code` | Raw exit code: `0` (current), `1` (outdated), `2` (error). |
| `has-updates` | `true` or `false`. For people who find integers ambiguous. |

The JSON output is transported through `GITHUB_OUTPUT` without being printed as a workflow
command. Pass it to later scripts through an environment variable, as shown below.

## Workflow Examples

### The Gatekeeper -- PR check that blocks the unworthy

```yaml
name: Dependency Gate
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  depfresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: vcode-sh/depfresh@v1
        id: depfresh
        with:
          fail-on-outdated: 'true'
        continue-on-error: true
      - name: Comment on PR
        if: steps.depfresh.outputs.has-updates == 'true'
        uses: actions/github-script@v7
        env:
          DEPFRESH_JSON: ${{ steps.depfresh.outputs.json }}
        with:
          script: |
            const output = JSON.parse(process.env.DEPFRESH_JSON);
            const s = output.summary;
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `### depfresh\n| Major | Minor | Patch | Total |\n|---|---|---|---|\n| ${s.major} | ${s.minor} | ${s.patch} | ${s.total} |`,
            });
      - if: steps.depfresh.outputs.exit-code == '1'
        run: exit 1
```

### The Weekly Nag -- passive-aggressive issue creation, every Monday

```yaml
name: Weekly Dependency Report
on:
  schedule:
    - cron: '0 9 * * 1'
  workflow_dispatch:
permissions:
  contents: read
  issues: write
jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: vcode-sh/depfresh@v1
        id: depfresh
        with:
          fail-on-outdated: 'false'
      - name: Create or update issue
        if: steps.depfresh.outputs.has-updates == 'true'
        uses: actions/github-script@v7
        env:
          DEPFRESH_JSON: ${{ steps.depfresh.outputs.json }}
        with:
          script: |
            const output = JSON.parse(process.env.DEPFRESH_JSON);
            const s = output.summary;
            const lines = [`**${s.total}** outdated (${s.major} major, ${s.minor} minor, ${s.patch} patch).`, ''];
            for (const pkg of output.packages) {
              if (!pkg.updates.length) continue;
              lines.push(`### ${pkg.name}`, '| Dep | Current | Target | Diff |', '|--|--|--|--|');
              for (const u of pkg.updates) lines.push(`| ${u.name} | ${u.current} | ${u.target} | ${u.diff} |`);
              lines.push('');
            }
            const title = `depfresh: ${s.total} outdated dependencies`;
            const existing = await github.rest.issues.listForRepo({
              owner: context.repo.owner, repo: context.repo.repo, state: 'open', labels: 'dependencies',
            });
            const prev = existing.data.find(i => i.title.startsWith('depfresh:'));
            if (prev) {
              await github.rest.issues.update({ owner: context.repo.owner, repo: context.repo.repo, issue_number: prev.number, body: lines.join('\n'), title });
            } else {
              await github.rest.issues.create({ owner: context.repo.owner, repo: context.repo.repo, title, body: lines.join('\n'), labels: ['dependencies'] });
            }
```

### The Auto-Updater -- daily minor/patch PR bot

```yaml
name: Auto-Update Dependencies
on:
  schedule:
    - cron: '0 4 * * *'
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: vcode-sh/depfresh@v1
        id: depfresh
        with:
          mode: 'minor'
          write: 'true'
          fail-on-outdated: 'false'
      - name: Create PR
        if: steps.depfresh.outputs.has-updates == 'true'
        uses: actions/github-script@v7
        env:
          DEPFRESH_JSON: ${{ steps.depfresh.outputs.json }}
        with:
          script: |
            const output = JSON.parse(process.env.DEPFRESH_JSON);
            const s = output.summary;
            const branch = `depfresh/auto-update-${Date.now()}`;
            await exec.exec('git', ['config', 'user.name', 'github-actions[bot]']);
            await exec.exec('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com']);
            await exec.exec('git', ['checkout', '-b', branch]);
            await exec.exec('git', ['add', '-A']);
            await exec.exec('git', ['commit', '-m', `chore(deps): update ${s.appliedUpdates} dependencies`]);
            await exec.exec('git', ['push', 'origin', branch]);
            const body = `Updated **${s.appliedUpdates}** deps (${s.minor} minor, ${s.patch} patch).\n\n` +
              output.packages.flatMap(p => p.updates.map(u => `- \`${u.name}\` ${u.current} -> ${u.target} (${u.diff})`)).join('\n');
            await github.rest.pulls.create({
              owner: context.repo.owner, repo: context.repo.repo,
              title: `chore(deps): update ${s.appliedUpdates} dependencies`, body, head: branch, base: 'main',
            });
```

### The Monorepo Wrangler -- matrix over workspaces, aggregated results

```yaml
name: Monorepo Dependency Check
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  discover:
    runs-on: ubuntu-latest
    outputs:
      workspaces: ${{ steps.list.outputs.workspaces }}
    steps:
      - uses: actions/checkout@v4
      - id: list
        run: |
          DIRS=$(find packages -maxdepth 1 -mindepth 1 -type d | jq -Rsc 'split("\n") | map(select(. != ""))')
          echo "workspaces=$DIRS" >> "$GITHUB_OUTPUT"
  check:
    needs: discover
    runs-on: ubuntu-latest
    strategy:
      matrix:
        workspace: ${{ fromJson(needs.discover.outputs.workspaces) }}
    steps:
      - uses: actions/checkout@v4
      - uses: vcode-sh/depfresh@v1
        id: depfresh
        with:
          working-directory: ${{ matrix.workspace }}
          recursive: 'false'
          fail-on-outdated: 'false'
      - name: Save result
        env:
          DEPFRESH_JSON: ${{ steps.depfresh.outputs.json }}
        run: printf '%s' "$DEPFRESH_JSON" > "$RUNNER_TEMP/depfresh-result.json"
      - uses: actions/upload-artifact@v4
        with:
          name: depfresh-${{ hashFiles(format('{0}/package.json', matrix.workspace)) }}
          path: ${{ runner.temp }}/depfresh-result.json
          if-no-files-found: error
  summarise:
    needs: check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          pattern: depfresh-*
          merge-multiple: true
      - uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const files = fs.readdirSync('.').filter(f => f.endsWith('.json'));
            let total = 0;
            const lines = ['### Monorepo Dependency Summary', ''];
            for (const f of files) {
              const d = JSON.parse(fs.readFileSync(f, 'utf8'));
              total += d.summary.total;
              if (d.summary.total > 0) lines.push(`**${d.meta.cwd}**: ${d.summary.total} outdated`);
            }
            if (total === 0) lines.push('All workspaces up to date.');
            if (context.issue?.number) {
              github.rest.issues.createComment({ issue_number: context.issue.number, owner: context.repo.owner, repo: context.repo.repo, body: lines.join('\n') });
            }
```

## Using Outputs

Pass JSON through an env var. Never inline `${{ }}` with untrusted content.

```yaml
- run: |
    echo "$DEPFRESH_JSON" | jq '.summary'
    MAJOR=$(echo "$DEPFRESH_JSON" | jq '.summary.major')
    [ "$MAJOR" -gt 0 ] && echo "::warning::$MAJOR major updates available"
  env:
    DEPFRESH_JSON: ${{ steps.depfresh.outputs.json }}
```

## Exit Codes

| Code | Meaning | Action behaviour |
|------|---------|------------------|
| `0` | Up to date or writes succeeded | `has-updates` = `false` |
| `1` | Outdated deps found | `has-updates` = `true`, fails step if `fail-on-outdated` |
| `2` | Fatal error | Fails immediately with error annotation |

Installation, runtime, and output-processing failures are reported with stable annotations. Raw
installer output, CLI stderr, and invalid JSON are retained only in temporary runner files and are
removed by an `always()` cleanup step.

## Permissions and Write Behaviour

For read-only checks, grant only `contents: read`. The Action does not use `GITHUB_TOKEN` to push,
open pull requests, or install project dependencies.

With `write: 'true'`, depfresh may modify dependency manifests and workspace catalog files inside
the validated working directory. It still does not commit or push. Any later commit or pull-request
step must receive its own explicit permissions and should inspect the changed files first.

## Release Upgrade Procedure

The Action installs the version recorded in the same revision's `package.json`. Maintainers must:

1. Bump the package version and update the changelog.
2. Build, test, and publish that exact npm version.
3. Verify the published CLI reports the expected version.
4. Only then create or move the Action release tag to the reviewed commit.

This order prevents an Action tag from referring to a package version that does not exist yet.

## CLI Escape Hatch

`depfresh --help-json` returns the complete CLI contract. If your workflow needs capabilities that
the Action intentionally does not expose, install and invoke the CLI directly with a shell array or
an equivalent argument-array API. Do not reconstruct commands with `eval` or word splitting.
