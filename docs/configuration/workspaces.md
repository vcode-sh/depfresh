# Workspace Configuration

Monorepos, catalogs, and the art of scanning too many directories. This page covers everything workspace-related in upgr's config.

## Recursive Scanning

`recursive` (default: `true`) tells upgr to scan subdirectories for `package.json` files. It respects `ignorePaths`, which defaults to:

```
**/node_modules/**
**/dist/**
**/coverage/**
**/.git/**
```

Set `recursive: false` if you only want the root package. Override `ignorePaths` if your project structure is... creative.

```typescript
import { defineConfig } from 'upgr'

export default defineConfig({
  recursive: true,
  ignorePaths: [
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/.git/**',
    '**/fixtures/**', // skip test fixtures
  ],
})
```

## Nested Workspace Detection

`ignoreOtherWorkspaces` (default: `true`) detects when a subdirectory belongs to a separate workspace and skips it. upgr looks for these markers:

- `pnpm-workspace.yaml`
- `.yarnrc.yml`
- `workspaces` field in `package.json`
- `.git` directories between the package and your root

This prevents upgr from double-processing packages in monorepo-within-monorepo setups. If you genuinely want to scan everything, set it to `false`. But you probably don't.

```typescript
import { defineConfig } from 'upgr'

export default defineConfig({
  ignoreOtherWorkspaces: false, // scan ALL the things
})
```

## Workspace Catalogs

upgr understands workspace catalogs for **pnpm**, **bun**, and **yarn**. These are centralised version declarations that individual packages reference instead of specifying versions directly.

### pnpm

Reads `catalog:` and `catalog:<name>` protocol references from `pnpm-workspace.yaml`:

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'

catalog:
  typescript: ^5.7.0
  vitest: ^2.1.0
```

```json
// packages/my-app/package.json
{
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

### bun

Reads catalog entries from `bunfig.toml`:

```toml
# bunfig.toml
[install.catalog]
typescript = "^5.7.0"
vitest = "^2.1.0"
```

### yarn

Reads catalog entries from `.yarnrc.yml`:

```yaml
# .yarnrc.yml
catalog:
  typescript: ^5.7.0
  vitest: ^2.1.0
```

### How catalogs are updated

Catalog dependencies are resolved and updated alongside regular dependencies. When writing (`--write`), upgr updates both the catalog source file and any `package.json` files that reference it. The catalog protocol references (`catalog:`, `catalog:<name>`) are preserved -- upgr only changes the version in the source file.

## Workspace Protocol

`includeWorkspace` (default: `true`) controls whether `workspace:*` and `workspace:^` dependencies are included in the check. These are inter-package references within a monorepo. Usually you want them included so upgr can show you if a workspace package's version constraint is outdated relative to the actual published version.

Set to `false` if workspace references aren't meaningful in your setup:

```typescript
import { defineConfig } from 'upgr'

export default defineConfig({
  includeWorkspace: false,
})
```
