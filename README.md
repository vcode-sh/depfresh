# depfresh

[![npm version](https://img.shields.io/npm/v/depfresh)](https://www.npmjs.com/package/depfresh)
[![CI](https://github.com/vcode-sh/depfresh/actions/workflows/ci.yml/badge.svg)](https://github.com/vcode-sh/depfresh/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-24.15+-339933)](https://nodejs.org/)

Fast dependency updates for JavaScript projects, with safe writes, monorepo catalogs, and a
reviewable plan/apply workflow when you need stronger guarantees.

## Try it

Run depfresh from any project root. Recursive workspace discovery is on by default, so `-r` is not
needed.

```bash
# Bun
bunx depfresh@2.1.0

# pnpm
pnpm dlx depfresh@2.1.0

# npm
npm exec --yes --package=depfresh@2.1.0 -- depfresh

# Yarn
yarn dlx depfresh@2.1.0
```

Node.js 24.15.0 or newer is required.

For a team or CI, pin depfresh in the project instead:

```bash
pnpm add -D --save-exact depfresh@2.1.0
pnpm exec depfresh
```

## Everyday commands

```bash
depfresh                 # show available updates
depfresh minor           # allow minor and patch updates
depfresh major           # include major updates
depfresh -w              # write selected targets safely
depfresh -wI             # choose updates interactively
depfresh --output json   # structured compatibility output
depfresh --no-recursive  # inspect only the root package
```

`depfresh -w` updates package files while preserving their formatting. It does not run an install
or lifecycle scripts. Use the reviewed plan/apply workflow when lockfile, install, or verification
phases are required.

For eligible local CLI table runs, the Visual+ review keeps repository topology, severity,
major-risk, owner, shared-dependency, complete change-list, transaction, and final receipt evidence
in one terminal journey. Eligibility requires the CLI progress route, non-silent output,
non-interactive and non-global operation, and no direct or addon `beforePackageWrite` hook. A
capable terminal uses colour and replaceable lifecycle frames. `NO_COLOR` removes only colour, and
a narrow capable terminal only wraps; both retain motion. Pipes, CI, and `TERM=dumb` select durable
append-only fallbacks without removing semantic content. For example, a fully observed write ends
with:

```text
Complete · 76 updates applied across 14 files
Applied 76  Blocked 0  Not attempted 0  Failed 0  Unknown 0
All 14 target files were observed at the requested values. Recovery was not needed. 2.4s.
Exit 0
```

A clean command-level preflight block ends with `Safety block · no files were changed`, one safe
`Next:` action, and `Exit 2`. After replacement starts, a failure renders `Recovered`,
`Recovery incomplete`, or `Recovery unknown` first and names applied, restored, and unrecovered
paths. Each file replacement is atomic, but the repository is not one atomic transaction and
recovery is best effort. See the
[table output journey reference](docs/output-formats/table.md#visual-result-journeys) for
capable/plain examples and count definitions. Interactive selection, JSON output, and global writes
use their existing separate surfaces. Library `check()` calls and veto-capable hook routes retain
the compatibility table surface.

## Safe plan and apply

```bash
depfresh inspect --json > depfresh-inspect.json
depfresh plan --json > depfresh-plan.json

# Review depfresh-plan.json, then grant file-write authority for that exact plan.
depfresh apply --json --write --plan-file depfresh-plan.json
```

- `inspect` reads repository evidence without registry access, commands, config execution, or
  writes.
- `plan` may read the registry and declarative JSON config, but uses memory-only cache state and
  never writes.
- `apply` rejects stale, dirty, escaped, or changed targets. Configuration can select updates but
  can never grant write, install, process, network, or verification authority.
- Unknown or incomplete evidence is kept as unknown; it is never converted into success.

Machine commands return `0` for a complete result without findings, `1` for a schema-valid result
with findings or a non-success apply state, and `2` for a fatal contract or runtime error. Their
JSON output is still valid on exit `1`.

See [automation and machine workflows](docs/agents/README.md) for schemas, lockfile phases,
artifact verification, and CI examples.

<a id="skip-native-or-expo-updates-in-a-monorepo"></a>

## Exclude an exact workspace or catalog

Use repeatable exact-literal flags when one workspace or physical catalog should stay unchanged for
one invocation:

```bash
depfresh -r --exclude-workspace apps/admin
depfresh -r -w \
  --exclude-workspace apps/admin \
  --exclude-workspace packages/legacy \
  --exclude-catalog payments
depfresh plan --json --exclude-catalog default
```

`--exclude-workspace` excludes declarations owned by that workspace plus its explanatory catalog
consumers. It never excludes a physical catalog owner, even for the root workspace `.`. Use
`--exclude-catalog` separately to exclude every proven physical catalog with that exact name and
its linked consumers. Commas and punctuation are literal, so `--exclude-catalog=mobile,v2` is one
catalog name. Missing or unprovable targets fail before registry or write work.

Choose the narrowest control that matches your intent:

- `--exclude` filters dependency names.
- `--ignore-paths` changes repository discovery and therefore removes evidence.
- `--exclude-workspace` selects one proven repository-relative package path.
- `--exclude-catalog` selects all proven physical owners of one exact catalog name.

For persistent patterns, use declarative policy rules. For example, a native/Expo lane can still
use `.depfreshrc.json`:

```json
{
  "ignorePaths": ["**/.worktrees/**", "tmp/**"],
  "policyRules": [
    {
      "id": "skip-native-catalog",
      "selectors": { "catalogName": "^native$" },
      "action": "exclude"
    },
    {
      "id": "skip-native-direct",
      "selectors": {
        "workspacePath": "^apps/native$",
        "catalogRole": "direct"
      },
      "action": "exclude"
    }
  ]
}
```

The first rule freezes the physical `native` catalog and all of its consumers. The second freezes
dependencies declared directly in `apps/native`. Dependencies in the default catalog stay
eligible, even when a native app consumes them. Put native-only packages in the named `native`
catalog or add an exact rule for their physical catalog owner.

Path ignores control repository discovery; they are not dependency policy. `inspect` deliberately
does not load project config, so pass repository-specific discovery additions explicitly when
needed:

```bash
depfresh inspect --json --ignore-paths '**/.worktrees/**,tmp/**'
```

CLI ignore additions retain the built-in safety exclusions for `node_modules`, `dist`, `coverage`,
and `.git`.

## What depfresh handles

- npm, pnpm, Yarn, and Bun workspaces; pnpm, Yarn, and Bun catalogs
- npm, JSR, GitHub, alias, workspace, override, and resolution declarations
- seven update modes: `default`, `major`, `minor`, `patch`, `latest`, `newest`, and `next`
- private registries and scoped `.npmrc` configuration for normal dependency resolution
- formatting-preserving, stale-safe manifest and catalog writes
- deterministic inspect, plan, apply, and global-operation JSON contracts
- SQLite registry cache with an automatic in-memory fallback
- runtime, peer, cohort, release, deprecation, and evidence-completeness signals
- optional exact public-npm artifact verification with npm 11.12.x

Deliberate limits are documented rather than hidden: manager execution is supported on Linux and
macOS; Yarn manager execution, Windows manager execution, and legacy `bun.lockb` are unsupported.
File replacement is atomic per file, not across an entire repository. Exact artifact verification
is limited to the public npm registry and does not inherit project npm configuration.

## Documentation

- [CLI reference](docs/cli/README.md)
- [Configuration and policy](docs/configuration/README.md)
- [Workspace and catalog behavior](docs/configuration/workspaces.md)
- [Programmatic API](docs/api/README.md)
- [Output contracts](docs/output-formats/README.md)
- [GitHub Action and integrations](docs/integrations/README.md)
- [Troubleshooting](docs/troubleshooting.md)
- [2.1.0 release notes](docs/releases/v2.1.0.md)
- [2.0.2 release notes](docs/releases/v2.0.2.md)
- [2.0.1 release notes](docs/releases/v2.0.1.md)
- [2.0.0 release notes](docs/releases/v2.0.0.md)

## From taze

depfresh is a from-scratch successor inspired by [taze](https://github.com/antfu/taze) and the work
of its [contributors](https://github.com/antfu/taze/graphs/contributors). The migration guide
explains the practical differences: [coming from taze](docs/compare/from-taze.md).

## License

MIT - [Vibe Code](https://vcode.sh)
