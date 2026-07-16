# Workspace Configuration

Monorepos, catalogs, and the art of scanning too many directories. This page covers everything workspace-related in depfresh's config.

## Recursive Scanning

`recursive` (default: `true`) tells depfresh to scan subdirectories for package manifests (`package.json`, `package.yaml`). It respects `ignorePaths`, which defaults to:

```
**/node_modules/**
**/dist/**
**/coverage/**
**/.git/**
```

Set `recursive: false` if you only want root manifest files (`package.json`, `package.yaml`). In non-recursive mode, depfresh does not load workspace catalogs. Override `ignorePaths` if your project structure is... creative.

If both `package.yaml` and `package.json` exist in the same directory, depfresh prefers `package.yaml`.

```typescript
import { defineConfig } from 'depfresh'

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

## Repository Containment

depfresh resolves one repository root before discovery and canonicalises it using the filesystem's
real path. Running from a descendant directory or through an in-root symlink therefore resolves to
the same physical root and the same manifest identities.

Every discovered manifest, workspace marker, lockfile, and catalog must remain inside that root by
path component. depfresh rejects:

- workspace patterns containing a `..` component;
- absolute workspace patterns;
- paths that only share the root's string prefix;
- symlinks whose target is outside the selected root;
- catalog or package-manager files found above the selected root.

These candidates are blocked before their contents are parsed. `--explain-discovery` reports stable
reasons such as `workspace-pattern:PARENT_TRAVERSAL`, `workspace-pattern:ABSOLUTE_PATTERN`, and
`containment:SYMLINK_ESCAPE` without reading the external file. Symlinks that resolve to a target
inside the root remain supported; their real path is used so duplicate spellings cannot produce
duplicate packages or write targets.

If aliases cause more than one package-manager catalog format to claim the same physical file,
depfresh reports `catalog:DUPLICATE_IDENTITY` and excludes that ambiguous file instead of choosing a
manager by loader order. Multiple named catalogs in one unambiguous manager file remain supported.

## Nested Workspace Detection

`ignoreOtherWorkspaces` (default: `true`) detects when a subdirectory belongs to a separate workspace. In read-only discovery, the nested root remains visible while its descendants are skipped. depfresh looks for these markers:

- `pnpm-workspace.yaml`
- `.yarnrc.yml`
- `workspaces` field in `package.json` or `package.yaml`
- `.git` directories between the package and your root

This prevents depfresh from double-processing packages in monorepo-within-monorepo setups. Set it to `false` for a broad read-only report.

Write runs always exclude both a nested root and its descendants, even when
`ignoreOtherWorkspaces` is `false`. A nested repository is a separate authority boundary; target it
explicitly in another invocation, for example `depfresh -C vendor/other-project --write`.

```typescript
import { defineConfig } from 'depfresh'

export default defineConfig({
  ignoreOtherWorkspaces: false, // include nested packages in read-only discovery
})
```

## Repository Evidence Boundaries

`inspectRepository()` exposes the effective root as `.` and represents contained nested workspace
and Git roots as first-class boundaries. Every contained marker is retained with a canonical
repository-relative path. Packages and lockfiles link to their nearest owning boundary, so a
nested lockfile never changes the parent boundary's package-manager conclusion.

Workspace declarations from a boundary-root manifest and `pnpm-workspace.yaml` are compared as
evidence. Distinct authoritative declarations remain `ambiguous`; filename order never selects a
winner. Malformed supported declarations are `unsupported`, while unreadable declarations are
`unavailable`; neither is silently treated as missing. Catalog-only `pnpm-workspace.yaml` files and
empty `.yarnrc.yml` markers remain valid. Workspace evidence retains only pnpm `packages` patterns
and stable marker metadata: pnpm catalog values and unrelated Yarn configuration, including
registry credentials, are never serialized into the evidence conclusion. A nested `.git` marker
also prevents inspection started inside that repository from being attributed to an outer
workspace. Each nested Git boundary is probed separately, and escaped marker symlinks are diagnosed
and never followed.

## Workspace Catalogs

depfresh understands workspace catalogs for **pnpm**, **bun**, and **yarn**. These are centralised version declarations that individual packages reference instead of specifying versions directly.

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

Reads catalog entries from root `package.json`:

```json
{
  "workspaces": {
    "catalog": {
      "typescript": "^5.7.0",
      "vitest": "^2.1.0"
    },
    "catalogs": {
      "ui": {
        "react": "^19.0.0"
      }
    }
  }
}
```

`workspaces.catalog` is the default catalog. `workspaces.catalogs.<name>` are named catalogs.

### Peer-scoped catalogs

If you use a named catalog called `peers` (for example `catalog:peers` in pnpm, or `workspaces.catalogs.peers` in bun), depfresh treats it as peer-scoped:

- default (`--peer` off): skipped
- with `--peer`: included

This keeps peer-only catalog entries aligned with how manifest `peerDependencies` are handled.

```yaml
# pnpm-workspace.yaml
catalogs:
  peers:
    react: ^19.0.0
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

Catalog dependencies are resolved alongside regular dependencies, but the catalog owner is the only
physical version declaration. When writing (`--write`), depfresh updates that owner in the catalog
source file. Consumer manifests retain their `catalog:` or `catalog:<name>` references unchanged.

Policy can select `catalogName` and exact `catalogRole` values (`owner`, `consumer`, or `direct`).
Owners and consumers are evaluated independently. A workspace- or package-specific consumer rule
never propagates into a shared owner; only the owner decision controls the physical entry. A rule
that selects `catalogName: 'native'` matches the native owner and each linked consumer, while a
direct declaration of the same dependency name remains unaffected:

```typescript
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

## Workspace Protocol

`includeWorkspace` (default: `true`) controls whether `workspace:` dependencies are considered during checks.

Current semantics:

- `workspace:^1.2.3`
- `workspace:~1.2.3`
- `workspace:1.2.3`

These explicit-version forms are checked against the registry, even when the package also exists locally in the workspace. This lets depfresh show whether the declared workspace version range is behind the published version.

Prefix-only local forms are still treated as local-only and skipped:

- `workspace:^`
- `workspace:~`
- `workspace:*`

Those forms intentionally defer to the local workspace package version, so depfresh does not try to invent a published-range update for them.

Set to `false` if workspace references aren't meaningful in your setup:

```typescript
import { defineConfig } from 'depfresh'

export default defineConfig({
  includeWorkspace: false,
})
```
