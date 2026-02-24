# depfresh

[![npm version](https://img.shields.io/npm/v/depfresh)](https://www.npmjs.com/package/depfresh)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-3178c6)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24+-339933)](https://nodejs.org/)

Keep your dependencies fresh. Taze alternative. Zero config, fast, monorepo-ready. Your AI agent already knows how to use this.

## Install

```bash
# One-off run (no install)
npx depfresh
pnpm dlx depfresh
bunx depfresh

# Global install
npm install -g depfresh

# Local devDependency (recommended for team + CI)
pnpm add -D depfresh
```

| If you want... | Use | Example |
| --- | --- | --- |
| Run once in any repo | One-off | `npx depfresh` |
| Always available on your machine | Global | `pnpm add -g depfresh` |
| Pinned for team/CI consistency | Local devDep | `npm install -D depfresh` |

## Quick Start

```bash
# What's outdated?
depfresh

# Update everything
depfresh --write

# Interactive -- pick what to update
depfresh -I

# JSON output for scripts and AI agents
depfresh --output json

# Only minor/patch (living cautiously)
depfresh minor -w

# CI: fail if anything is outdated
depfresh --fail-on-outdated
```

## Features

- **Zero config** -- run `depfresh` and it works. No YAML. No PhD.
- **Monorepo & workspace support** -- pnpm, bun, yarn, npm. Auto-detected. Catalogs included.
- **7 range modes** -- `default`, `major`, `minor`, `patch`, `latest`, `newest`, `next`
- **Interactive cherry-picking** -- grouped multiselect with colour-coded severity
- **Per-package modes** -- `packageMode` with exact, glob, or regex patterns per dependency
- **Write safely** -- `--write` updates files. `--verify-command` tests each dep and reverts failures.
- **Post-write hooks** -- `--execute`, `--install`, `--update`. Chain commands after writing.
- **Global packages** -- `--global` for one manager, `--global-all` scans npm + pnpm + bun (deduped)
- **Private registries** -- full `.npmrc` support. Scoped registries, auth tokens, env vars.
- **GitHub dependencies** -- `github:owner/repo#tag` with protocol-preserving writes
- **JSON output** -- structured envelope for scripts and AI agents. No ANSI noise.
- **CI mode** -- `--fail-on-outdated` exits with code 1. Plug it into your pipeline.
- **SQLite cache** -- WAL mode, 30min TTL, auto-fallback to memory
- **Provenance tracking** -- warnings for unsigned or downgraded attestations
- **Node engine compat** -- flags updates that don't match your Node version
- **Cooldown filter** -- skip versions published less than N days ago
- **Programmatic API** -- lifecycle callbacks + addon system for custom workflows

Full CLI reference: **[docs/cli/](docs/cli/)**

## Configuration

Zero config works. But if you want it:

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

Supports `depfresh.config.ts`, `.depfreshrc`, or a `depfresh` key in `package.json`. Full reference: **[docs/configuration/](docs/configuration/)**

## Monorepo Support

depfresh auto-detects pnpm, bun, yarn, and npm workspaces -- no config needed. Workspace catalogs (`pnpm-workspace.yaml`, bun catalogs, yarn `.yarnrc.yml` catalogs) are resolved and updated in-place alongside your package manifests.

Details: **[docs/configuration/workspaces.md](docs/configuration/workspaces.md)**

## AI Agent Friendly

depfresh was built for humans and machines. `--output json` emits a structured envelope. `--help-json` returns the full CLI contract (flags, enums, exit codes, agent workflows). Exit codes are semantic: `0` = up to date, `1` = updates available, `2` = error. Non-TTY environments automatically suppress spinners and interactive prompts.

Details: **[docs/agents/README.md](docs/agents/README.md)**

## Coming from taze?

depfresh is a spiritual successor to [taze](https://github.com/antfu/taze) by Anthony Fu -- a tool that did the job well until maintenance slowed and issues piled up. depfresh rewrites everything from scratch, fixes long-standing bugs (private registries, bun catalogs, packageMode precedence), and adds structured JSON output, verify-and-rollback, SQLite caching, and proper AI agent support.

Migration guide: **[docs/compare/from-taze.md](docs/compare/from-taze.md)** | Full comparison: **[docs/compare/](docs/compare/)**

## Documentation

- **[CLI Reference](docs/cli/)** -- flags, modes, sorting, filtering, hooks, interactive, CI
- **[Configuration](docs/configuration/)** -- config files, options, packageMode, private registries, cache
- **[Programmatic API](docs/api/)** -- functions, lifecycle callbacks, addon plugins, types
- **[Output Formats](docs/output-formats/)** -- table, JSON, exit codes
- **[Agent Workflows](docs/agents/README.md)** -- quickstarts for AI coding assistants
- **[Integrations](docs/integrations/README.md)** -- GitHub Actions and MCP wrapper guidance
- **[Compare](docs/compare/)** -- coverage matrix, migration guide, solved issues
- **[Troubleshooting](docs/troubleshooting.md)** -- common issues, workspace gotchas, known limitations

## Standing on the Shoulders of People Who Actually Did the Work

depfresh wouldn't exist without [taze](https://github.com/antfu/taze). I rewrote everything from scratch, yes, but "from scratch" is easy when someone else already figured out what the thing should do. Every bug report, every feature PR, every typo fix in the taze repo was a free lesson in what users actually need. I just took notes and built a new house on someone else's blueprint.

So here's to every contributor who opened a PR on taze. Some of you added features I shamelessly reimplemented. Some of you fixed bugs that taught me where the landmines were. Some of you fixed typos, and honestly, that's braver than any architecture decision I've ever made.

Cheers to all of you. I owe you mass-produced coffee at minimum.

<!-- Contributors listed alphabetically by GitHub username, because favouritism is for people with better social skills than me -->

[a1mer](https://github.com/a1mersnow) · [Alex Liu](https://github.com/LarchLiu) · [Arash Sheyda](https://github.com/arashsheyda) · [await-ovo](https://github.com/await-ovo) · [Aymane Dara Hlamnach](https://github.com/azuradara) · [azaleta](https://github.com/azaleta) · [Benny Powers](https://github.com/bennypowers) · [Bruno Rocha](https://github.com/orochaa) · [btea](https://github.com/btea) · [Carter](https://github.com/Fyko) · [Charles](https://github.com/CharlesOkwuagwu) · [Daniel Bayley](https://github.com/danielbayley) · [Daniel Schmitz](https://github.com/blouflashdb) · [Dreamacro](https://github.com/Dreamacro) · [Duncan Lock](https://github.com/dflock) · [Dunqing](https://github.com/Dunqing) · [Eneko Rodr&iacute;guez](https://github.com/Nisgrak) · [Enzo Innocenzi](https://github.com/innocenzi) · [Eugene](https://github.com/outslept) · [Geoffrey Parrier](https://github.com/GeoffreyParrier) · [Han](https://github.com/hannoeru) · [Harry Yep](https://github.com/okisdev) · [Hassan Zahirnia](https://github.com/HassanZahirnia) · [hyrious](https://github.com/hyrious) · [iiio2](https://github.com/iiio2) · [Iridescent](https://github.com/Iridescent-cdu) · [Jakub Zomerfeld](https://github.com/devzom) · [Jaw](https://github.com/jaw52) · [jinghaihan](https://github.com/jinghaihan) · [Joaqu&iacute;n S&aacute;nchez](https://github.com/userquin) · [Johan Lindskogen](https://github.com/lindskogen) · [Julien Calixte](https://github.com/jcalixte) · [Kerman](https://github.com/kermanx) · [Kevin Deng](https://github.com/sxzz) · [Khalil Yao](https://github.com/yyz945947732) · [Kirk Lin](https://github.com/kirklin) · [Lo](https://github.com/LoTwT) · [Loann Neveu](https://github.com/lneveu) · [Lochlan Bunn](https://github.com/loklaan) · [mancuoj](https://github.com/mancuoj) · [Maxime Dubourg](https://github.com/mdubourg001) · [Nam Nguyen](https://github.com/willnguyen1312) · [ntnyq](https://github.com/ntnyq) · [Patryk Tomczyk](https://github.com/patzick) · [pdx](https://github.com/pdx-xf) · [Pier Dolique](https://github.com/Perdolique) · [RainbowBird](https://github.com/luoling8192) · [Renato Lacerda](https://github.com/ralacerda) · [rg](https://github.com/Gehbt) · [Riri](https://github.com/Daydreamer-riri) · [Runyasak Chaengnaimuang](https://github.com/runyasak) · [sapphi-red](https://github.com/sapphi-red) · [simexce](https://github.com/simexce) · [Simon He](https://github.com/Simon-He95) · [sinoon](https://github.com/sinoon) · [Stephen Zhou](https://github.com/hyoban) · [Sukka](https://github.com/SukkaW) · [Takuya Fukuju](https://github.com/chalkygames123) · [Tanimodori](https://github.com/Tanimodori) · [Tom&aacute;s Hern&aacute;ndez](https://github.com/THernandez03) · [tyler](https://github.com/tylersayshi) · [Vladislav Deryabkin](https://github.com/evermake) · [wChenonly](https://github.com/wChenonly) · [webdiscus](https://github.com/webdiscus) · [Wind](https://github.com/productdevbook) · [wuchao](https://github.com/jerrywu001) · [younggglcy](https://github.com/younggglcy) · [Yu Le](https://github.com/yuler)

## License

MIT - [Vibe Code](https://vcode.sh)
