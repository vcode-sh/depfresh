# Contributing

I accept contributions. Genuinely didn't expect to be writing this section, but here I am.

Found a bug? Want a feature? Just feel like improving something on a Sunday afternoon? Welcome. The bar is low but it does exist.

## Setup

```bash
git clone https://github.com/vcode-sh/depfresh.git
cd depfresh
pnpm install
```

**Requirements:** Node.js >= 24, pnpm. If you're still on Node 18, I can't help you. That's not sarcasm, it literally won't run.

## Commands

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Run CLI in dev mode via tsx |
| `pnpm build` | Build with unbuild |
| `pnpm test` | Vitest watch mode |
| `pnpm test:run` | Single test run |
| `pnpm lint` | Biome check |
| `pnpm lint:fix` | Biome auto-fix |
| `pnpm format` | Biome format |
| `pnpm typecheck` | tsc --noEmit |

## Project Structure

```
src/
  cli.ts                  # CLI entry (citty)
  index.ts                # Library exports
  config.ts               # Config resolution (jiti + defu)
  config.test.ts          # Tests live next to source. Like adults.
  types.ts                # All the types
  commands/check/         # Check command, interactive mode, rendering
  io/
    packages.ts           # Package discovery and parsing
    dependencies.ts       # Dep extraction (overrides, protocols, the works)
    resolve.ts            # Registry resolution with concurrency control
    registry.ts           # npm/JSR fetching with retry
    write.ts              # Writes updates, preserves formatting
    catalogs/             # Workspace catalog loaders (pnpm, bun, yarn)
  cache/
    sqlite.ts             # SQLite cache, WAL mode, memory fallback
  utils/
    versions.ts           # Semver logic, range detection, diff calc
    npmrc.ts              # .npmrc parsing, scoped registries, auth
    format.ts             # ANSI colour helpers
    logger.ts             # Levelled logger (use this, not console.log)
```

Tests are colocated — `foo.ts` gets `foo.test.ts` in the same directory. No separate `test/` folder. It's not 2017.

## The Rules

1. **Write tests.** If your change touches logic, it gets a test. No "I'll add them later." You won't.
2. **Run `pnpm lint` before committing.** Biome is strict. That's a feature, not a bug.
3. **Run `pnpm typecheck`.** TypeScript strict mode is on. `noUncheckedIndexedAccess` is on. I enjoy suffering and now so do you.
4. **Use `import type` for type-only imports.** `verbatimModuleSyntax` will yell at you if you don't.
5. **Use the logger, not console.log.** There's a `noConsole` lint rule. Respect it.
6. **ESM only.** No CommonJS. It's 2026. Let it go.
7. **Update the CHANGELOG.** If your change faces a user, document it. Future you will be grateful. Past you never is.

## Pull Requests

1. Fork it. Branch from `main`.
2. Make your changes. Write tests. Run the whole suite.
3. `pnpm lint && pnpm typecheck && pnpm test:run` -- all green or don't bother opening the PR. I will not debug your CI for you.
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
