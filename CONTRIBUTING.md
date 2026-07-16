# Contributing

I accept contributions. Genuinely didn't expect to be writing this section, but here I am.

Found a bug? Want a feature? Just feel like improving something on a Sunday afternoon? Welcome. The bar is low but it does exist.

## Setup

```bash
git clone https://github.com/vcode-sh/depfresh.git
cd depfresh
pnpm install
```

**Requirements:** Node.js >= 24.15.0 and pnpm 10.33.0. Use the exact Node version from `.nvmrc`
for release-facing verification.

## Commands

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Run CLI in dev mode via tsx |
| `pnpm build` | Build with unbuild |
| `pnpm test` | Vitest watch mode |
| `pnpm test:run` | Single test run |
| `pnpm test:release` | Release contracts, Action, package assets, and official workflow |
| `pnpm lint` | Biome check |
| `pnpm lint:fix` | Biome auto-fix |
| `pnpm format` | Biome format |
| `pnpm typecheck` | tsc --noEmit |
| `pnpm schemas:check` | Verify generated JSON Schemas are current |
| `pnpm test:smoke` | Run built CLI integration smoke tests |

## Project Structure

```
src/
  cli/index.ts            # CLI entry (citty)
  index.ts                # Library exports
  config.ts               # Config resolution (jiti + defu)
  config.test.ts          # Tests live next to source. Like adults.
  types/                  # Public and internal type contracts
  commands/check/         # Check command, interactive mode, rendering
  io/
    packages.ts           # Package discovery and parsing
    dependencies.ts       # Dep extraction (overrides, protocols, the works)
    resolve.ts            # Registry resolution with concurrency control
    registry.ts           # npm/JSR fetching with retry
    write/                # Writes updates, preserves formatting
    catalogs/             # Workspace catalog loaders (pnpm, bun, yarn)
  cache/
    sqlite.ts             # SQLite cache, WAL mode, memory fallback
  utils/
    versions.ts           # Semver logic, range detection, diff calc
    npmrc.ts              # .npmrc parsing, scoped registries, auth
    format.ts             # ANSI colour helpers
    logger.ts             # Levelled logger (use this, not console.log)
```

Unit tests are colocated as `foo.test.ts`. Cross-entry-point, Action, packaging, and practical CLI
integration tests live in `test/`.

## The Rules

1. **Write tests.** If your change touches logic, it gets a test. No "I'll add them later." You won't.
2. **Run `pnpm lint` and `pnpm exec biome check --error-on-warnings .` before committing.** Biome
   warnings are release failures.
3. **Run `pnpm typecheck`.** TypeScript strict mode is on. `noUncheckedIndexedAccess` is on. I enjoy suffering and now so do you.
4. **Use `import type` for type-only imports.** `verbatimModuleSyntax` will yell at you if you don't.
5. **Use the logger, not console.log.** There's a `noConsole` lint rule. Respect it.
6. **ESM only.** No CommonJS. It's 2026. Let it go.
7. **Update the CHANGELOG.** If your change faces a user, document it. Future you will be grateful. Past you never is.

## Pull Requests

1. Fork it. Branch from `main`.
2. Make your changes. Write tests. Run the whole suite.
3. `pnpm schemas:check && pnpm typecheck && pnpm lint && pnpm test:run && pnpm build && pnpm test:smoke`
   -- all green before opening the PR.
4. Write a real PR description. What changed, why, how to test it. "Fixed stuff" is not a description, it's a cry for help.
5. One PR per feature or fix. This isn't a charity shop, don't bundle unrelated changes.

## Reporting Issues

- Use the issue templates. They're there for a reason.
- Include: Node version, OS, package manager, the command you ran, what happened, what you expected. Minimum viable bug report.
- **Security vulnerabilities:** email hello@vcode.sh. Do NOT open a public issue. See [SECURITY.md](SECURITY.md).

## Style

Biome handles formatting. Don't fight it. 2-space indent, single quotes, no semicolons, trailing commas. If you disagree with any of these choices, you're entitled to your wrong opinion.

---

No CLA. No 47-page contributor agreement. No corporate nonsense. Just write good code and don't be terrible to people. That's genuinely it.
