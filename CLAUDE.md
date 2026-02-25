# depfresh

CLI tool and library for checking/updating npm dependencies. Fast, correct, zero-config. TypeScript, ESM-only, Node >= 24.

## Architecture

Two entry points: `src/cli/index.ts` (CLI via citty) and `src/index.ts` (library exports).

### Flow: CLI -> Config -> Check -> Resolve -> Render/Write

- **CLI** (`src/cli/`) — Arg parsing with citty, calls `resolveConfig()` then `check()`
- **Config** (`src/config.ts`) — Merges CLI args > `.depfreshrc`/`package.json#depfresh` > defaults (jiti + defu)
- **Check** (`src/commands/check/`) — Orchestrates: load packages -> resolve each -> render -> interactive select -> write
- **Package loading** (`src/io/packages.ts`) — Finds `package.json` files via tinyglobby, detects indentation
- **Dependency parsing** (`src/io/dependencies.ts`) — Extracts deps from standard fields + overrides/resolutions, handles npm:/jsr: protocols
- **Resolution** (`src/io/resolve.ts`) — Fetches registry metadata with p-limit concurrency, SQLite cache (`~/.depfresh/cache.db`) with memory fallback
- **Registry** (`src/io/registry.ts`) — npm (abbreviated metadata) and JSR registries, retry with exponential backoff
- **Write** (`src/io/write/`) — Writes updated versions preserving formatting and indentation
- **Catalogs** (`src/io/catalogs/`) — Loaders for pnpm/bun/yarn workspace catalogs
- **Addons** (`src/addons/`) — Plugin system with lifecycle hooks
- **Cache** (`src/cache/`) — SQLite-backed cache layer (better-sqlite3)

### Key types (`src/types/`)

- `depfreshOptions` — All config including lifecycle callbacks
- `PackageMeta` — A package.json with raw deps and resolved changes
- `RawDep` -> `ResolvedDepChange` — Before/after registry resolution
- `RangeMode` — `default | major | minor | patch | latest | newest | next`
- `DiffType` — `major | minor | patch | none | error`
- `DEFAULT_OPTIONS` — Exported defaults (concurrency: 16, timeout: 10s, cacheTTL: 30min, retries: 2)

## Code Style

**Biome** enforces everything:
- 2-space indent, single quotes, no semicolons, trailing commas
- 100 char line width, LF line endings, arrow parens always
- `noUnusedImports: error`, `noUnusedVariables: error`, `useImportType: error`
- `noConsole: warn` — use logger, not console.log
- `noAccumulatingSpread: error` — no spreading in loops

**TypeScript** strict mode:
- `noUncheckedIndexedAccess` — array/object access returns `T | undefined`
- `verbatimModuleSyntax` — explicit `import type` required
- `noUnusedLocals`, `noUnusedParameters`
- Module: ESNext, moduleResolution: bundler

## Testing

**Vitest** with colocated tests (`src/**/*.test.ts` next to source files). Additional integration tests in `test/`.

Coverage: v8 provider, reporters: text + lcov. Excludes `src/cli.ts`, type declarations, and test files themselves.

```bash
pnpm test              # Vitest watch mode
pnpm test:run          # Single run
pnpm test:run --coverage  # With coverage
```

## Commands

```bash
pnpm build             # unbuild -> dist/ (cli.mjs + index.mjs)
pnpm dev               # Run CLI via tsx
pnpm test              # Vitest watch
pnpm test:run          # Single test run
pnpm lint              # Biome check
pnpm lint:fix          # Biome auto-fix
pnpm format            # Biome format
pnpm typecheck         # tsc --noEmit
```

## Dependencies

**Runtime:** @clack/prompts, ansis, better-sqlite3, citty, defu, detect-indent, find-up-simple, ini, jiti, p-limit, pathe, pnpm-workspace-yaml, semver, tinyglobby, undici, yaml

**Dev:** @biomejs/biome, @vitest/coverage-v8, tsx, typescript, unbuild, vitest

**Build:** unbuild with rollup, inlines dependencies, externalizes better-sqlite3 (native module)

**Package manager:** pnpm 10.30.1

## Review Guidelines

- **Cache correctness** — SQLite cache has TTL and cooldown logic; verify cache invalidation on changes
- **Registry protocol handling** — npm:, jsr:, workspace: protocols have special parsing; test edge cases
- **Indentation preservation** — Write operations must preserve original file formatting (detect-indent)
- **Concurrency** — p-limit controls parallel registry fetches; watch for race conditions in cache writes
- **Error boundaries** — Custom error hierarchy (RegistryError, CacheError, etc.); errors should never leak raw stack traces to CLI users
- **Native module fallback** — better-sqlite3 may not be available; memory cache fallback must work identically
- **Exit codes** — 0 = up-to-date, 1 = outdated found, 2 = error. These are part of the public API.
- **YAML/JSON write safety** — Catalog writes touch workspace config files; verify no data loss on round-trip

## Important

Never mention Claude Code or Anthropic in any documentation, GitHub, or any other public or private communication. Not in code, GitHub, PRs, comments, commits, etc.
