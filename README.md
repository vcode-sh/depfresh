# bump

[![npm version](https://img.shields.io/npm/v/bump-cli)](https://www.npmjs.com/package/bump-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-3178c6)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24+-339933)](https://nodejs.org/)

Keep your npm dependencies fresh. Fast, correct, zero-config.

Spiritual successor to [taze](https://github.com/antfu/taze) by Anthony Fu - a tool that did the job well until maintenance slowed and issues piled up. I took the best ideas, rewrote everything from scratch, fixed the bugs that sat open for years, and made it work for humans and AI agents alike. Credit where it's due.

## Why

Because `npm outdated` gives you a table and then abandons you. Because Renovate requires a PhD in YAML. Because your AI coding assistant should be able to update your deps without you holding its hand.

bump checks every `package.json` in your project, tells you what's outdated, and optionally writes the updates. Monorepos, workspace catalogs, private registries - it handles all of it without a config file.

## Install

```bash
npm install -g bump-cli
```

Or don't install globally. I'm not your parent.

```bash
npx bump-cli
pnpm dlx bump-cli
bunx bump-cli
```

## Usage

```bash
# Check for outdated dependencies
bump

# Actually update them
bump --write

# Interactive mode -- pick what to update like a civilised person
bump --interactive

# Only major updates (living dangerously)
bump --mode major

# Only patch updates (living cautiously)
bump --mode patch

# JSON output for scripts and AI agents
bump --output json

# Filter specific packages
bump --include "react,vue" --exclude "eslint"

# Only devDependencies
bump --dev-only

# Only production dependencies
bump --deps-only
```

## CLI Flags

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `--recursive` | `-r` | `true` | Recursively search for package.json files |
| `--write` | `-w` | `false` | Write updated versions to package files |
| `--interactive` | `-I` | `false` | Select which deps to update |
| `--mode` | `-m` | `default` | Range mode: `default` `major` `minor` `patch` `latest` `newest` `next` |
| `--include` | `-n` | — | Only include packages matching regex (comma-separated) |
| `--exclude` | `-x` | — | Exclude packages matching regex (comma-separated) |
| `--force` | `-f` | `false` | Force update even if version is satisfied |
| `--peer` | `-P` | `false` | Include peer dependencies |
| `--include-locked` | `-l` | `false` | Include pinned dependencies |
| `--output` | `-o` | `table` | Output format: `table` `json` |
| `--concurrency` | `-c` | `16` | Max concurrent registry requests |
| `--deps-only` | — | `false` | Only check dependencies |
| `--dev-only` | — | `false` | Only check devDependencies |
| `--global` | `-g` | `false` | Check global packages |
| `--loglevel` | — | `info` | Log level: `silent` `info` `debug` |

## Config File

Zero config works. But if you want it, create `bump.config.ts` (or `.bumprc`, or add a `bump` key to `package.json`):

```typescript
import { defineConfig } from 'bump-cli'

export default defineConfig({
  mode: 'minor',
  exclude: ['typescript'],
  packageMode: {
    'eslint': 'latest',
    '/^@types/': 'patch',
  },
})
```

## JSON Output

`--output json` emits a single structured envelope. No log noise. No ANSI codes. Just clean JSON that machines can parse without having an existential crisis.

```json
{
  "packages": [
    {
      "name": "my-app",
      "updates": [
        {
          "name": "react",
          "current": "^18.2.0",
          "target": "^19.1.0",
          "diff": "major",
          "source": "dependencies"
        }
      ]
    }
  ],
  "summary": {
    "total": 12,
    "major": 1,
    "minor": 7,
    "patch": 4,
    "packages": 3
  },
  "meta": {
    "cwd": "/path/to/project",
    "mode": "default",
    "timestamp": "2026-02-22T12:00:00.000Z"
  }
}
```

## AI Agent Usage

bump was designed to work with AI coding assistants out of the box. No special configuration needed.

```bash
# Check for updates, get structured output
bump --output json --loglevel silent

# Apply all updates
bump --write

# Apply only safe updates
bump --write --mode patch
```

**Exit codes are semantic:**
- `0` — all deps up to date (or updates were written)
- `1` — updates available (not written)
- `2` — error

**TTY detection** — when stdout isn't a terminal (piped, captured by an agent), bump automatically suppresses spinners and interactive prompts. `NO_COLOR` is respected.

## Monorepo Support

bump auto-detects workspace structures. No config needed.

| Package Manager | Workspaces | Catalogs |
|----------------|------------|----------|
| pnpm | `pnpm-workspace.yaml` | `catalog:` protocol |
| Bun | `workspaces` in `package.json` | `workspaces.catalog` |
| Yarn | `workspaces` in `package.json` | `yarn.config.cjs` catalogs |
| npm | `workspaces` in `package.json` | — |

Workspace catalogs are resolved and updated in-place. Your `pnpm-workspace.yaml` catalog entries get bumped alongside your `package.json` deps. No manual sync needed.

## Private Registries

bump reads `.npmrc` from your project and home directory. Scoped registries, auth tokens, proxies -- all respected.

```ini
# .npmrc
@mycompany:registry=https://npm.mycompany.com/
//npm.mycompany.com/:_authToken=${NPM_TOKEN}
```

This was broken in taze for 4+ years. I fixed it on day one. You're welcome.

## Programmatic API

```typescript
import { check, resolveConfig } from 'bump-cli'

const options = await resolveConfig({
  cwd: process.cwd(),
  mode: 'minor',
  output: 'json',
})

const exitCode = await check(options)
```

Lifecycle callbacks for custom workflows:

```typescript
const options = await resolveConfig({
  cwd: process.cwd(),
  beforePackageStart: (pkg) => {
    console.log(`Checking ${pkg.name}...`)
  },
  onDependencyResolved: (pkg, dep) => {
    if (dep.diff === 'major') {
      console.log(`Major update: ${dep.name} ${dep.currentVersion} -> ${dep.targetVersion}`)
    }
  },
  beforePackageWrite: (pkg) => {
    // Return false to skip writing this package
    return true
  },
  afterPackageWrite: (pkg) => {
    console.log(`Updated ${pkg.name}`)
  },
})
```

## What I Fixed from taze

Not to throw shade at taze -- it served the community well for years. But some things needed fixing, and "PR welcome" only goes so far when the PRs sit open for months.

| Problem | taze | bump |
|---------|------|------|
| `.npmrc` / private registries | Ignored | Full support |
| Network retry | None | Exponential backoff |
| Write clobber (bun catalogs) | Data loss | Single-writer architecture |
| Version resolution ordering | Assumed sorted arrays | Explicit semver comparison |
| Interactive mode | Flickery | @clack/prompts |
| JSON output | None | Structured envelope |
| Dep type filtering | None | `--deps-only` / `--dev-only` |
| Config merging | deepmerge (CJS) | defu (ESM) |
| npm config loading | @npmcli/config (heavy, hacky) | Direct ini parsing |
| Cache | JSON file (race conditions) | SQLite with WAL mode |

## Requirements

- Node.js >= 24

## License

MIT - [Vibe Code](https://vcode.sh)
