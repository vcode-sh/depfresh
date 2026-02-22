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
| `--execute` | `-e` | — | Run command after writing (e.g. `"pnpm test"`) |

## Post-write Hooks

Run commands after bump writes your updated dependencies. Because updating deps is only half the job.

### `--execute`

```bash
# Run tests after updating
bump -w --execute "pnpm test"

# Reinstall and rebuild
bump -w --execute "pnpm install && pnpm build"

# Commit the changes
bump -w --execute "git add -A && git commit -m 'chore: update deps'"

# Chain it all
bump -w --execute "pnpm install" --install
```

The command runs once after all packages are written. If it fails, bump logs the error but still exits 0 -- your deps were already updated successfully, the command is a bonus.

### `--install` / `--update`

Convenience flags that auto-detect your package manager and run `install` or `update` after writing.

```bash
bump -w --install    # runs pnpm/npm/yarn/bun install
bump -w --update     # runs pnpm/npm/yarn/bun update
```

### In config

```typescript
import { defineConfig } from 'bump-cli'

export default defineConfig({
  write: true,
  execute: 'pnpm install && pnpm test',
})
```

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

## Standing on the Shoulders of People Who Actually Did the Work

bump wouldn't exist without [taze](https://github.com/antfu/taze). I rewrote everything from scratch, yes, but "from scratch" is easy when someone else already figured out what the thing should do. Every bug report, every feature PR, every typo fix in the taze repo was a free lesson in what users actually need. I just took notes and built a new house on someone else's blueprint.

So here's to every contributor who opened a PR on taze. Some of you added features I shamelessly reimplemented. Some of you fixed bugs that taught me where the landmines were. Some of you fixed typos, and honestly, that's braver than any architecture decision I've ever made.

Cheers to all of you. I owe you mass-produced coffee at minimum.

<!-- Contributors listed alphabetically by GitHub username, because favouritism is for people with better social skills than me -->

[a1mer](https://github.com/a1mersnow) · [Alex Liu](https://github.com/LarchLiu) · [Arash Sheyda](https://github.com/arashsheyda) · [await-ovo](https://github.com/await-ovo) · [Aymane Dara Hlamnach](https://github.com/azuradara) · [azaleta](https://github.com/azaleta) · [Benny Powers](https://github.com/bennypowers) · [Bruno Rocha](https://github.com/orochaa) · [btea](https://github.com/btea) · [Carter](https://github.com/Fyko) · [Charles](https://github.com/CharlesOkwuagwu) · [Daniel Bayley](https://github.com/danielbayley) · [Daniel Schmitz](https://github.com/blouflashdb) · [Dreamacro](https://github.com/Dreamacro) · [Duncan Lock](https://github.com/dflock) · [Dunqing](https://github.com/Dunqing) · [Eneko Rodr&iacute;guez](https://github.com/Nisgrak) · [Enzo Innocenzi](https://github.com/innocenzi) · [Eugene](https://github.com/outslept) · [Geoffrey Parrier](https://github.com/GeoffreyParrier) · [Han](https://github.com/hannoeru) · [Harry Yep](https://github.com/okisdev) · [Hassan Zahirnia](https://github.com/HassanZahirnia) · [hyrious](https://github.com/hyrious) · [iiio2](https://github.com/iiio2) · [Iridescent](https://github.com/Iridescent-cdu) · [Jakub Zomerfeld](https://github.com/devzom) · [Jaw](https://github.com/jaw52) · [jinghaihan](https://github.com/jinghaihan) · [Joaqu&iacute;n S&aacute;nchez](https://github.com/userquin) · [Johan Lindskogen](https://github.com/lindskogen) · [Julien Calixte](https://github.com/jcalixte) · [Kerman](https://github.com/kermanx) · [Kevin Deng](https://github.com/sxzz) · [Khalil Yao](https://github.com/yyz945947732) · [Kirk Lin](https://github.com/kirklin) · [Lo](https://github.com/LoTwT) · [Loann Neveu](https://github.com/lneveu) · [Lochlan Bunn](https://github.com/loklaan) · [mancuoj](https://github.com/mancuoj) · [Maxime Dubourg](https://github.com/mdubourg001) · [Nam Nguyen](https://github.com/willnguyen1312) · [ntnyq](https://github.com/ntnyq) · [Patryk Tomczyk](https://github.com/patzick) · [pdx](https://github.com/pdx-xf) · [Pier Dolique](https://github.com/Perdolique) · [RainbowBird](https://github.com/luoling8192) · [Renato Lacerda](https://github.com/ralacerda) · [rg](https://github.com/Gehbt) · [Riri](https://github.com/Daydreamer-riri) · [Runyasak Chaengnaimuang](https://github.com/runyasak) · [sapphi-red](https://github.com/sapphi-red) · [simexce](https://github.com/simexce) · [Simon He](https://github.com/Simon-He95) · [sinoon](https://github.com/sinoon) · [Stephen Zhou](https://github.com/hyoban) · [Sukka](https://github.com/SukkaW) · [Takuya Fukuju](https://github.com/chalkygames123) · [Tanimodori](https://github.com/Tanimodori) · [Tom&aacute;s Hern&aacute;ndez](https://github.com/THernandez03) · [tyler](https://github.com/tylersayshi) · [Vladislav Deryabkin](https://github.com/evermake) · [wChenonly](https://github.com/wChenonly) · [webdiscus](https://github.com/webdiscus) · [Wind](https://github.com/productdevbook) · [wuchao](https://github.com/jerrywu001) · [younggglcy](https://github.com/younggglcy) · [Yu Le](https://github.com/yuler)

## License

MIT - [Vibe Code](https://vcode.sh)
