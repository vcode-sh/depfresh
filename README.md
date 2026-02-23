# depfresh

[![npm version](https://img.shields.io/npm/v/depfresh)](https://www.npmjs.com/package/depfresh)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-3178c6)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24+-339933)](https://nodejs.org/)

Keep your npm dependencies fresh. Fast, correct, zero-config. Your AI agent already knows how to use this. You don't even need to read this README -- it did.

Spiritual successor to [taze](https://github.com/antfu/taze) by Anthony Fu -- a tool that did the job well until maintenance slowed and issues piled up. I took the best ideas, rewrote everything from scratch, fixed the bugs that sat open for years, and made it work for humans and AI agents alike. Credit where it's due.

## Features

- **Zero-config dependency checking** -- run `depfresh` and it tells you what's outdated. No YAML. No PhD.
- **Monorepo & workspace support** -- pnpm, bun, yarn, npm. Auto-detected. Catalog deps included.
- **7 range modes** -- `default`, `major`, `minor`, `patch`, `latest`, `newest`, `next`. One flag, total control.
- **Interactive cherry-picking** -- grouped multiselect with colour-coded severity. Pick what you want, ignore the rest.
- **Per-package modes** -- `packageMode` lets you set exact, glob, or regex patterns per dependency.
- **Write safely** -- `--write` updates files. `--verify-command` tests each dep individually and reverts failures.
- **Post-write hooks** -- `--execute`, `--install`, `--update`. Chain commands after writing.
- **Global packages** -- `--global` checks one detected manager, `--global-all` scans npm + pnpm + bun with deduped package names.
- **Private registries** -- full `.npmrc` support. Scoped registries, auth tokens, env vars. Fixed from day one.
- **JSON output** -- structured envelope for scripts and AI agents. No ANSI noise.
- **CI mode** -- `--fail-on-outdated` exits with code 1. Plug it into your pipeline.
- **SQLite cache** -- WAL mode, 30min TTL, auto-fallback to memory. Fast repeat runs.
- **Provenance tracking** -- warnings for unsigned or downgraded attestations.
- **Node engine compat** -- flags updates that don't match your Node version.
- **Cooldown filter** -- skip versions published less than N days ago. Let the early adopters find the bugs.
- **Sorting** -- 6 strategies: by diff severity, publish time, or name.
- **CRLF preservation** -- Windows line endings survive the write. You're welcome.
- **Nested workspace detection** -- auto-skips monorepos inside monorepos.
- **Programmatic API** -- lifecycle callbacks + addon system for custom workflows.

## Why

Because `npm outdated` gives you a table and then abandons you. Because Renovate requires a PhD in YAML. Because your AI coding assistant should be able to update your deps without you holding its hand.

depfresh checks every package manifest (`package.json`, `package.yaml`) in your project, tells you what's outdated, and optionally writes the updates. Monorepos, workspace catalogs, private registries - it handles all of it without a config file.

If both `package.yaml` and `package.json` exist in the same directory, depfresh uses `package.yaml` and skips the sibling `package.json` to avoid duplicate package entries.

## Install

```bash
npm install -g depfresh
```

Or don't install globally. I'm not your parent.

```bash
npx depfresh
pnpm dlx depfresh
bunx depfresh
```

Lost? `depfresh help` prints every flag and mode. `depfresh --help-json` spits out the full CLI contract as JSON for the robots. Between the two of them, there's no excuse for not knowing what this thing does.

## Usage

```bash
# Check for outdated dependencies
depfresh

# Lost? This prints everything.
depfresh help

# Same thing but for machines and AI agents who can't read tables
depfresh --help-json

# Actually update them
depfresh --write

# Interactive mode -- pick what to update like a civilised person
depfresh --interactive

# Only minor/patch updates (living cautiously)
depfresh minor -w

# JSON output for scripts and AI agents
depfresh --output json

# Filter specific packages
depfresh --include "react,vue" --exclude "eslint"

# Verify each dep individually, revert failures
depfresh -w --verify-command "pnpm test"

# CI: fail if anything is outdated
depfresh --fail-on-outdated

# Skip specific directories from recursive scan
depfresh --ignore-paths "apps/legacy/**,examples/**"

# Bypass cache for one run (same behavior)
depfresh --refresh-cache
depfresh --no-cache

# Check globals across npm + pnpm + bun (deduped names)
depfresh --global-all
```

## CLI Flags

The top flags to get you started. Full reference with all CLI flags: **[docs/cli/](docs/cli/)**

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `--recursive` | `-r` | `true` | Recursively search for package manifests (`package.json`, `package.yaml`) |
| `--write` | `-w` | `false` | Write updated versions to package files |
| `--interactive` | `-I` | `false` | Select which deps to update |
| `--mode` | `-m` | `default` | Range mode: `default` `major` `minor` `patch` `latest` `newest` `next` |
| `--include` | `-n` | -- | Only include packages matching regex/glob patterns (comma-separated) |
| `--exclude` | `-x` | -- | Exclude packages matching regex/glob patterns (comma-separated) |
| `--ignore-paths` | -- | -- | Extra ignore globs (comma-separated), merged with default ignored paths |
| `--force` | `-f` | `false` | Force update even if version is satisfied (does not bypass cache) |
| `--refresh-cache` | -- | `false` | Bypass cache reads and fetch fresh metadata for this run |
| `--no-cache` | -- | `false` | Alias for `--refresh-cache` |
| `--global` | `-g` | `false` | Check global packages for one detected package manager |
| `--global-all` | -- | `false` | Check global packages across npm, pnpm, and bun with deduped package names |
| `--output` | `-o` | `table` | Output format: `table` `json` |
| `--execute` | `-e` | -- | Run command after writing (e.g. `"pnpm test"`) |
| `--verify-command` | `-V` | -- | Run command per dep, revert on failure |
| `--install` | `-i` | `false` | Run package manager install after writing |
| `--fail-on-outdated` | -- | `false` | Exit code 1 when outdated deps found (CI mode) |
| `--cooldown` | -- | `0` | Skip versions published less than N days ago |
| `--sort` | `-s` | `diff-asc` | Sort: `diff-asc` `diff-desc` `time-asc` `time-desc` `name-asc` `name-desc` |

## Config File

Zero config works. But if you want it, create `depfresh.config.ts` (or `.depfreshrc`, or add a `depfresh` key to `package.json`):

```typescript
import { defineConfig } from 'depfresh'

export default defineConfig({
  mode: 'minor',
  exclude: ['typescript'],
  packageMode: {
    'eslint': 'latest',
    '/^@types/': 'patch',
  },
})
```

Addon example (programmatic API):

```typescript
import { check, resolveConfig, type depfreshAddon } from 'depfresh'

const addon: depfreshAddon = {
  name: 'audit-log',
  afterPackageWrite(_ctx, pkg, changes) {
    console.log(`updated ${pkg.name}: ${changes.length} changes`)
  },
}

const options = await resolveConfig({ write: true, addons: [addon] })
await check(options)
```

Full options reference: **[docs/configuration/](docs/configuration/)**

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
  "errors": [
    {
      "name": "some-private-pkg",
      "source": "dependencies",
      "currentVersion": "^1.0.0",
      "message": "Failed to resolve from registry"
    }
  ],
  "summary": {
    "total": 12,
    "major": 1,
    "minor": 7,
    "patch": 4,
    "packages": 3,
    "scannedPackages": 3,
    "packagesWithUpdates": 3,
    "plannedUpdates": 0,
    "appliedUpdates": 0,
    "revertedUpdates": 0
  },
  "meta": {
    "schemaVersion": 1,
    "cwd": "/path/to/project",
    "mode": "default",
    "timestamp": "2026-02-22T12:00:00.000Z",
    "noPackagesFound": false,
    "didWrite": false
  }
}
```

Full schema and field reference: **[docs/output-formats/](docs/output-formats/)**

## AI Agent Usage

depfresh was designed to work with AI coding assistants out of the box. No special configuration needed. Run it blind and it tells you what to do next.

**Auto-discovery** -- when stdout isn't a TTY (piped, captured by an agent), depfresh prints a hint to stderr: `Tip: Use --output json for structured output. Run --help-json for CLI capabilities.` Agents are stateless. They don't remember your last hint.

**`--help-json`** returns a full machine-readable contract: version, flags, enums, exit codes, plus:
- `workflows` -- 4 copy-paste agent recipes (`checkOnly`, `safeUpdate`, `fullUpdate`, `selective`)
- `flagRelationships` -- which flags require or conflict with others
- `configFiles` -- every supported config file pattern
- `jsonOutputSchema` -- field descriptions of the JSON envelope

```bash
# First run -- just see what happens (agents get the stderr hint)
depfresh

# Discover the full CLI contract
depfresh --help-json

# Check for updates, get structured output
depfresh --output json

# Apply only safe updates
depfresh --write --mode minor --output json

# Selective update
depfresh --write --include "typescript,vitest" --output json

# Full send
depfresh --write --mode latest --output json
```

**Exit codes are semantic:**
- `0` -- all deps up to date (or updates were written)
- `1` -- updates available (with `--fail-on-outdated`)
- `2` -- error (structured JSON error envelope when `--output json` is active)

**Structured errors** -- when `--output json` is active and something fails, you get a JSON error envelope with `error.code`, `error.message`, and `error.retryable` instead of plaintext stderr. Resolution failures for individual deps appear in the `errors[]` array of the normal envelope.

**TTY detection** -- when stdout isn't a terminal, depfresh automatically suppresses spinners and interactive prompts. `NO_COLOR` is respected.

## Programmatic API

```typescript
import { check, resolveConfig } from 'depfresh'

const options = await resolveConfig({
  cwd: process.cwd(),
  mode: 'minor',
  write: true,
  onDependencyResolved: (pkg, dep) => {
    if (dep.diff === 'major') {
      console.log(`Major update: ${dep.name} ${dep.currentVersion} -> ${dep.targetVersion}`)
    }
  },
  beforePackageWrite: (pkg) => {
    return true // return false to skip
  },
})

const exitCode = await check(options)
```

Programmatic API with lifecycle callbacks, addon plugins, and full typed exports. Full reference: **[docs/api/](docs/api/)**

## Monorepo Support

depfresh auto-detects workspace structures. No config needed.

| Package Manager | Workspaces | Catalogs |
|----------------|------------|----------|
| pnpm | `pnpm-workspace.yaml` | `catalog:` protocol |
| Bun | `workspaces` in `package.json` or `package.yaml` | `workspaces.catalog` |
| Yarn | `workspaces` in `package.json` or `package.yaml` | `.yarnrc.yml` catalogs |
| npm | `workspaces` in `package.json` or `package.yaml` | -- |

Workspace catalogs are resolved and updated in-place. Your `pnpm-workspace.yaml` catalog entries get depfreshaded alongside your manifest deps (`package.json` / `package.yaml`). No manual sync needed.

## Private Registries

depfresh reads `.npmrc` from your project and home directory. Scoped registries, auth tokens, proxies -- all respected.

```ini
# .npmrc
@mycompany:registry=https://npm.mycompany.com/
//npm.mycompany.com/:_authToken=${NPM_TOKEN}
```

This was broken in taze for 4+ years. I fixed it on day one. You're welcome.

## depfresh vs taze

Verified against taze v19.9.2 (commit `31c6fe8`, 2026-01-20). Not marketing. Real code inspection, runtime test runs, CLI smoke checks on actual repos.

### Feature parity (both have it)

| Feature | taze | depfresh | Notes |
|---------|------|----------|-------|
| 7 range modes | yes | yes | |
| Include/exclude filters | yes | yes | depfresh adds glob patterns alongside regex |
| Interactive TUI | yes | yes | Both have vim keys + per-version selection |
| `--cwd` | yes | yes | |
| `--fail-on-outdated` | yes | yes | |
| `package.yaml` support | yes | yes | |
| Addon/plugin API | yes | yes | |
| pnpm catalogs | yes | yes | |
| Yarn catalogs | yes | yes | |
| CRLF preservation | yes | yes | |
| CJK width handling | yes | yes | |

### Where depfresh is ahead

| Feature | taze | depfresh |
|---------|------|----------|
| JSON output envelope | no ([#201](https://github.com/antfu-collective/taze/issues/201) open) | Structured envelope with schema version |
| Machine-readable CLI contract | no | `--help-json` with workflows, flag relationships, schema |
| `--deps-only` / `--dev-only` | no ([#101](https://github.com/antfu-collective/taze/issues/101) open) | yes |
| `packageMode` precedence | buggy ([#91](https://github.com/antfu-collective/taze/issues/91) open) | Deterministic |
| Global package breadth | npm + pnpm | npm + pnpm + bun (`--global-all`) |
| Bun catalog writes | Bug history, data loss risk | Single-writer architecture, tested |
| `.npmrc` / private registries | Ignored for years | Full support from day one |
| `.npmrc` transport (proxy/TLS/CA) | Parsed, not applied | Applied via `undici` transport adapter |
| Network retry | None | Exponential backoff, non-transient errors fail fast |
| Cache | JSON file (race conditions) | SQLite WAL mode, memory fallback |
| Verify + rollback | no | `--verify-command` tests each dep, reverts failures |
| Typed error hierarchy | Limited | Structured subclasses with `.code` and `.cause` |
| Structured JSON errors | no | JSON error envelope with `error.code`, `error.retryable` |
| Explicit cache bypass | no | `--refresh-cache` / `--no-cache` |

### Where taze is ahead

| Area | Why |
|------|-----|
| Ecosystem adoption | 4,061 stars, years of trust, larger user base |
| npm config edge cases | `@npmcli/config` may cover obscure auth patterns we haven't hit yet |

### Numbers

| Metric | taze v19.9.2 | depfresh v0.11.0 |
|--------|-------------:|------------------:|
| Test files | 13 | 77 |
| Passing tests | 55 | 598 |
| CLI flags | 24 | 36 |

## Documentation

The full docs, for people who read manuals before assembling furniture.

- **[CLI Reference](docs/cli/)** -- all CLI flags, modes, sorting, filtering, hooks, interactive, CI, workspaces
- **[Configuration](docs/configuration/)** -- config files, every option, packageMode, depFields, private registries, cache
- **[Programmatic API](docs/api/)** -- exported functions, lifecycle callbacks, addon plugins, types, workflow examples
- **[Output Formats](docs/output-formats/)** -- table, JSON, exit codes, AI agent integration
- **[Agent Workflows](docs/agents/README.md)** -- copy-paste quickstarts for Codex, Claude Code, and Gemini CLI
- **[Integrations](docs/integrations/README.md)** -- GitHub Actions and thin MCP wrapper guidance
- **[Troubleshooting](docs/troubleshooting.md)** -- common issues, workspace gotchas, known limitations

## Requirements

- Node.js >= 24

## Standing on the Shoulders of People Who Actually Did the Work

depfresh wouldn't exist without [taze](https://github.com/antfu/taze). I rewrote everything from scratch, yes, but "from scratch" is easy when someone else already figured out what the thing should do. Every bug report, every feature PR, every typo fix in the taze repo was a free lesson in what users actually need. I just took notes and built a new house on someone else's blueprint.

So here's to every contributor who opened a PR on taze. Some of you added features I shamelessly reimplemented. Some of you fixed bugs that taught me where the landmines were. Some of you fixed typos, and honestly, that's braver than any architecture decision I've ever made.

Cheers to all of you. I owe you mass-produced coffee at minimum.

<!-- Contributors listed alphabetically by GitHub username, because favouritism is for people with better social skills than me -->

[a1mer](https://github.com/a1mersnow) · [Alex Liu](https://github.com/LarchLiu) · [Arash Sheyda](https://github.com/arashsheyda) · [await-ovo](https://github.com/await-ovo) · [Aymane Dara Hlamnach](https://github.com/azuradara) · [azaleta](https://github.com/azaleta) · [Benny Powers](https://github.com/bennypowers) · [Bruno Rocha](https://github.com/orochaa) · [btea](https://github.com/btea) · [Carter](https://github.com/Fyko) · [Charles](https://github.com/CharlesOkwuagwu) · [Daniel Bayley](https://github.com/danielbayley) · [Daniel Schmitz](https://github.com/blouflashdb) · [Dreamacro](https://github.com/Dreamacro) · [Duncan Lock](https://github.com/dflock) · [Dunqing](https://github.com/Dunqing) · [Eneko Rodr&iacute;guez](https://github.com/Nisgrak) · [Enzo Innocenzi](https://github.com/innocenzi) · [Eugene](https://github.com/outslept) · [Geoffrey Parrier](https://github.com/GeoffreyParrier) · [Han](https://github.com/hannoeru) · [Harry Yep](https://github.com/okisdev) · [Hassan Zahirnia](https://github.com/HassanZahirnia) · [hyrious](https://github.com/hyrious) · [iiio2](https://github.com/iiio2) · [Iridescent](https://github.com/Iridescent-cdu) · [Jakub Zomerfeld](https://github.com/devzom) · [Jaw](https://github.com/jaw52) · [jinghaihan](https://github.com/jinghaihan) · [Joaqu&iacute;n S&aacute;nchez](https://github.com/userquin) · [Johan Lindskogen](https://github.com/lindskogen) · [Julien Calixte](https://github.com/jcalixte) · [Kerman](https://github.com/kermanx) · [Kevin Deng](https://github.com/sxzz) · [Khalil Yao](https://github.com/yyz945947732) · [Kirk Lin](https://github.com/kirklin) · [Lo](https://github.com/LoTwT) · [Loann Neveu](https://github.com/lneveu) · [Lochlan Bunn](https://github.com/loklaan) · [mancuoj](https://github.com/mancuoj) · [Maxime Dubourg](https://github.com/mdubourg001) · [Nam Nguyen](https://github.com/willnguyen1312) · [ntnyq](https://github.com/ntnyq) · [Patryk Tomczyk](https://github.com/patzick) · [pdx](https://github.com/pdx-xf) · [Pier Dolique](https://github.com/Perdolique) · [RainbowBird](https://github.com/luoling8192) · [Renato Lacerda](https://github.com/ralacerda) · [rg](https://github.com/Gehbt) · [Riri](https://github.com/Daydreamer-riri) · [Runyasak Chaengnaimuang](https://github.com/runyasak) · [sapphi-red](https://github.com/sapphi-red) · [simexce](https://github.com/simexce) · [Simon He](https://github.com/Simon-He95) · [sinoon](https://github.com/sinoon) · [Stephen Zhou](https://github.com/hyoban) · [Sukka](https://github.com/SukkaW) · [Takuya Fukuju](https://github.com/chalkygames123) · [Tanimodori](https://github.com/Tanimodori) · [Tom&aacute;s Hern&aacute;ndez](https://github.com/THernandez03) · [tyler](https://github.com/tylersayshi) · [Vladislav Deryabkin](https://github.com/evermake) · [wChenonly](https://github.com/wChenonly) · [webdiscus](https://github.com/webdiscus) · [Wind](https://github.com/productdevbook) · [wuchao](https://github.com/jerrywu001) · [younggglcy](https://github.com/younggglcy) · [Yu Le](https://github.com/yuler)

## License

MIT - [Vibe Code](https://vcode.sh)
