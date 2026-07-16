# Programmatic API

I exposed the internals. On purpose. You can `import` from `depfresh` and do whatever you want with your dependency graph. ESM-only, obviously. It's not 2019.

## Pages

- **[Overview](./overview.md)** -- Quick start, defaults, workflow examples. The "just show me some code" page.

- **[Functions](./functions.md)** -- Inspect/plan/apply contracts, check/configuration, repository policy compilation/evaluation, package resolution, compatibility writes, lifecycle callbacks, and addons.

- **[Types](./types.md)** -- The full type catalogue, including inspect/plan/apply schemas and options,
  policy inputs, compatibility signals/evidence, contexts, compiled rules, provenance, decisions,
  and candidate reasons.

- **[Repository Model](./repository-model.md)** -- Versioned read-only repository inspection,
  stable IDs, exact source hashes, occurrences, catalogs, relationships, and diagnostics.

- **[Errors](./errors.md)** -- Structured error classes: `RegistryError`, `CacheError`, `ConfigError`, `WriteError`, `ResolveError`, `AddonError`. All extend `depfreshError`, all have stable codes.
