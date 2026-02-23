# GitHub Action

Because manually checking dependencies is a lifestyle choice, and not a good one.

## Quick Start

```yaml
name: Dependency Check
on: pull_request
jobs:
  depfresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: vcode-sh/depfresh@v1
        id: depfresh
      - run: echo "${{ steps.depfresh.outputs.outdated-count }} outdated deps found"
```

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `mode` | `default` | Range mode. See [modes](../cli/modes.md). |
| `write` | `false` | Write updates to package files. |
| `fail-on-outdated` | `true` | Exit 1 when outdated deps found. Ignored when `write` is `true`. |
| `include` | `''` | Comma-separated package name patterns to include. |
| `exclude` | `''` | Comma-separated package name patterns to exclude. |
| `recursive` | `true` | Scan workspace packages recursively. |
| `working-directory` | `.` | Path to the project root. |
| `node-version` | `24` | Node.js version. depfresh requires >= 24. |
| `extra-args` | `''` | Additional [CLI flags](../cli/flags.md) passed verbatim. |

## Outputs

| Output | Description |
|--------|-------------|
| `json` | Full [JSON envelope](../output-formats/json.md). |
| `outdated-count` | Number of outdated dependencies. |
| `exit-code` | Raw exit code: `0` (current), `1` (outdated), `2` (error). |
| `has-updates` | `true` or `false`. For people who find integers ambiguous. |

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
        with:
          script: |
            const output = JSON.parse(`${{ steps.depfresh.outputs.json }}`);
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
        with:
          script: |
            const output = JSON.parse(`${{ steps.depfresh.outputs.json }}`);
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
        with:
          script: |
            const output = JSON.parse(`${{ steps.depfresh.outputs.json }}`);
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
      - uses: actions/upload-artifact@v4
        with:
          name: depfresh-${{ hashFiles(format('{0}/package.json', matrix.workspace)) }}
          path: /tmp/depfresh-*.json
          if-no-files-found: ignore
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

## Tip

`depfresh --help-json` returns a JSON object with all flags, types, defaults, and valid enum values. Useful for constructing `extra-args` dynamically.
