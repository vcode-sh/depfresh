# depfresh

[![npm version](https://img.shields.io/npm/v/depfresh)](https://www.npmjs.com/package/depfresh)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-3178c6)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24.15+-339933)](https://nodejs.org/)

Inspect dependency evidence, create a reviewable immutable plan, then apply only the changes you
explicitly authorize. depfresh stays fast and zero-config for everyday checks while giving
monorepos, CI, and automation a deterministic machine contract. Unknown state is never reported as
success.

## Install

### One-off run (no install needed)

```bash
npm exec --yes --package=depfresh@2.0.0 -- depfresh
pnpm dlx depfresh@2.0.0
bunx depfresh@2.0.0
yarn dlx depfresh@2.0.0
```

### Global install

```bash
npm install -g depfresh@2.0.0
pnpm add -g depfresh@2.0.0
bun add -g depfresh@2.0.0
yarn global add depfresh@2.0.0
```

### Local devDependency (recommended for team + CI)

```bash
npm install -D --save-exact depfresh@2.0.0
pnpm add -D --save-exact depfresh@2.0.0
bun add -D --exact depfresh@2.0.0
yarn add -D --exact depfresh@2.0.0
```

| If you want... | Use | Example |
| --- | --- | --- |
| Run once in any repo | Exact one-off | `npm exec --yes --package=depfresh@2.0.0 -- depfresh` |
| Always available on your machine | Exact global | `npm install -g depfresh@2.0.0` |
| Pinned for team/CI consistency | Exact local devDep + lockfile | `pnpm add -D --save-exact depfresh@2.0.0` |

Automation should prefer the repository-local binary pinned by the committed lockfile, then an
exact approved package version. See the [official automation workflow](docs/agents/README.md).

## Evidence-backed workflow

```bash
# Deterministic installed command/schema/capability descriptor
depfresh capabilities --json

# Deterministic repository evidence (no registry or subprocess)
depfresh inspect --json

# Reviewable dependency plan (registry reads, no writes)
depfresh plan --json > depfresh-plan.json

# Apply exactly that reviewed plan with explicit write authority
depfresh apply --json --write --plan-file depfresh-plan.json
```

The compatibility check workflow remains available for quick local use:

```bash
# What's outdated?
depfresh

# Update everything through the stale-safe compatibility path
depfresh --write

# Interactive -- pick what to update
depfresh -wI

# JSON output for existing scripts
depfresh --output json

# Only minor/patch (living cautiously)
depfresh minor -w

# CI: fail if anything is outdated
depfresh --fail-on-outdated
```

## Features

- **Zero config** -- run `depfresh` and it works. No YAML. No PhD.
- **Monorepo & workspace support** -- pnpm, bun, yarn, npm. Auto-detected. Catalogs included.
- **Repository model** -- deterministic read-only inspection with stable IDs, exact byte hashes,
  boundaries, package-manager and lockfile conclusions, declared Node runtimes, and read-only Git
  state per effective or nested repository boundary.
- **Inspect and plan contracts** -- versioned, schema-valid machine documents with canonical
  repository and plan fingerprints, exact occurrence operations, complete policy traces, candidate
  traces when registry resolution runs, one terminal decision per occurrence, and fingerprinted
  compatibility/passive-evidence signals. Planning uses memory-only cache state and never writes.
- **Stale-safe apply contract** -- validates one immutable plan, exact target hashes and values,
  target Git state, and explicit write authority before same-filesystem staging. Every target is
  reparsed and rechecked before atomic per-file replacement; byte-exact backups and a durable
  journal support observed recovery without claiming a repository-wide transaction.
- **Explicit lockfile phases** -- a plan may fingerprint each affected boundary's supported
  manager/version, selected lockfile hash, fixed lifecycle-disabled argv, allowed paths, and optional exact verification
  argv. Apply runs those phases only with separate sync/install/verify grants and reports every
  observed mutation and non-transactional effect.
- **7 range modes** -- `default`, `major`, `minor`, `patch`, `latest`, `newest`, `next`
- **Interactive cherry-picking** -- grouped multiselect with colour-coded severity
- **Occurrence policy** -- validated ordered rules select by dependency, workspace, catalog,
  field, role, manager, protocol, and current specifier context, with independent action and mode
  winners and complete decision traces.
- **Write safely** -- exact manifest/catalog occurrences are preconditioned and re-read after writes.
  Legacy `--write` file changes delegate to the same stale-safe file engine. Legacy shell-string
  post-write flags are rejected; manager and verification work uses the reviewed plan/apply flow.
- **Observed global updates** -- `--global` inspects one supported manager and `--global-all`
  scans npm, pnpm, and Bun. Writes preflight every manager, block downgrades, and report each
  occurrence from post-command inventory without claiming rollback.
- **Private registries** -- full `.npmrc` support. Scoped registries, auth tokens, env vars.
- **GitHub dependencies** -- `github:owner/repo#tag` with protocol-preserving writes
- **JSON output** -- structured envelope with itemized physical write outcomes for scripts and AI
  agents. No ANSI noise.
- **CI mode** -- `--fail-on-outdated` exits with code 1. Plug it into your pipeline.
- **SQLite cache** -- WAL mode, 30min TTL, auto-fallback to memory
- **Compatibility signals** -- evaluates target engines against repository-declared Node ranges and
  peer requirements against the complete proposed declaration graph for each exact owner. Catalog
  owners are projected physically; unproven cross-workspace/hoist topology remains unknown.
- **Coordination and release evidence** -- explicit cohorts can block divergent targets; inferred
  repository families are non-mutating suggestions. Channel, maturity, and deprecation use the
  plan's fixed clock.
- **Passive trust presence** -- signature and provenance metadata remain distinct
  `present`/`absent`/`unknown` observations and never claim artifact verification.
- **Exact npm artifact verification** -- install plans may fingerprint npm 11.12.x
  `audit signatures` verification for public npm artifacts. Apply binds each result to the final
  lockfile integrity and installed location, keeps signature and provenance truth independent, and
  requires explicit process, install, artifact-verification, and network authority. Unsupported
  managers, registries, npm versions, or missing integrity block planning. Offline, stale, or
  unavailable execution stays unknown; matching policy rules may warn or block without changing
  the observed state.
- **Cooldown filter** -- skip versions published less than N days ago; immutable planning requires
  an explicit `--as-of`, while legacy check uses its active invocation clock
- **Candidate safety** -- filtered versions never re-enter through tags or fallbacks, and updates never implicitly downgrade
- **Programmatic API** -- lifecycle callbacks + addon system for custom workflows

Full CLI reference: **[docs/cli/](docs/cli/)**

Exact artifact verification uses the reviewed machine workflow:

```bash
depfresh plan --json --install --verify-artifacts > depfresh-plan.json
depfresh apply --json --write --install --verify-artifacts --plan-file depfresh-plan.json
```

General dependency resolution supports private registries, but exact artifact verification is
currently public npm registry only and treats project `.npmrc` configuration as unavailable.
The npm result can prove exact invalid/missing signature records but does not expose safe
per-artifact positive signature coverage, so signature verification never reports pass.

## Configuration

Zero config works. But if you want it:

```typescript
import { defineConfig } from 'depfresh'

export default defineConfig({
  mode: 'latest',
  policyRules: [
    {
      id: 'native-catalog-minor',
      selectors: { catalogName: 'native' },
      mode: 'minor',
    },
  ],
})
```

That rule caps the physical `native` catalog owner and its linked consumer occurrences. A direct
declaration of the same dependency name still uses `latest`. Existing `include`, `exclude`,
`mode`, and `packageMode` configuration remains supported through a compatibility compiler.
Configuration can shape selection but cannot grant write or process authority.
Signal rules change only a signal's policy effect; they never rewrite evidence state or select a
different target.

Machine planning loads only declarative JSON configuration. Put plan-risk policy in `.depfreshrc`,
`depfresh.config.json`, or `package.json#depfresh` (or pass the same plain data to `plan()`):

```json
{
  "cohorts": [
    { "id": "react-family", "members": ["react", "react-dom"], "strategy": "same-major" }
  ],
  "signalRules": [
    {
      "id": "review-peer-failures",
      "selectors": { "family": "peer", "state": "fail" },
      "effect": "block"
    }
  ]
}
```

Legacy checks support `depfresh.config.ts`; machine planning accepts declarative JSON files,
`.depfreshrc`, or a `depfresh` key in `package.json`. Full reference:
**[docs/configuration/](docs/configuration/)**

## Monorepo Support

depfresh auto-detects pnpm, bun, yarn, and npm workspaces -- no config needed. Workspace catalogs (`pnpm-workspace.yaml`, bun catalogs, yarn `.yarnrc.yml` catalogs) are resolved and updated in-place alongside your package manifests.

Details: **[docs/configuration/workspaces.md](docs/configuration/workspaces.md)**

## AI Agent Friendly

depfresh was built for humans and machines. `depfresh inspect --json` describes repository evidence,
`depfresh plan --json` resolves a reviewable dependency plan, and
`depfresh apply --json --write --plan-file <path>` applies only that exact plan. The compatibility
`--output json` check report remains available for existing automation. `--help-json` returns the
CLI contract, schema paths, and workflows. Inspect and plan exit `0` when complete without
actionable or incomplete findings and `1` for a valid finding-bearing document. Apply exits `0` for
`applied` or `noop` and `1` for a valid `conflicted`, `reverted`, `failed`, or `unknown` result. Exit
`2` is a fatal machine-command error. Non-TTY environments suppress spinners and interactive prompts.
Before apply, review every failed or unknown signal, explicit cohort block, inferred suggestion,
and effect override. Passive presence and an override are policy evidence, not proof of safety.

To synchronize a supported lockfile and run an exact verification command, plan the phase first,
review the JSON, then repeat only the matching grants at apply time:

```bash
depfresh plan --json --sync-lockfile --verify-argv '["pnpm","test"]' > depfresh-plan.json
depfresh apply --json --write --sync-lockfile --verify --plan-file depfresh-plan.json
```

Manager execution currently supports Linux and macOS. It fails closed on Windows until equivalent
inherited-descendant process observation is available. Final lockfile proof includes both the
requested manifest specifier and the exact resolved target version.

Details: **[docs/agents/README.md](docs/agents/README.md)**

## Coming from taze?

depfresh is a spiritual successor to [taze](https://github.com/antfu/taze) by Anthony Fu -- a tool that did the job well until maintenance slowed and issues piled up. depfresh rewrites everything from scratch, fixes long-standing bugs (private registries, bun catalogs, packageMode precedence), and adds structured JSON output, reviewed aggregate verification with recovery, SQLite caching, and proper AI agent support.

Migration guide: **[docs/compare/from-taze.md](docs/compare/from-taze.md)** | Full comparison: **[docs/compare/](docs/compare/)**

## Documentation

- **[CLI Reference](docs/cli/)** -- flags, modes, sorting, filtering, hooks, interactive, CI
- **[Configuration](docs/configuration/)** -- config files, occurrence policy, compatibility inputs, private registries, cache
- **[Programmatic API](docs/api/)** -- functions, lifecycle callbacks, addon plugins, types
- **[Output Formats](docs/output-formats/)** -- table, JSON, exit codes
- **[Agent Workflows](docs/agents/README.md)** -- quickstarts for AI coding assistants
- **[Integrations](docs/integrations/README.md)** -- version-coupled GitHub Action and MCP wrapper guidance
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
