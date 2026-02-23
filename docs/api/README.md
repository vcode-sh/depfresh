# Programmatic API

I exposed the internals. On purpose. You can `import` from `depfresh` and do whatever you want with your dependency graph. ESM-only, obviously. It's not 2019.

## Pages

- **[Overview](./overview.md)** -- Quick start, defaults, workflow examples. The "just show me some code" page.

- **[Functions](./functions.md)** -- Every exported function: `check`, `resolveConfig`, `loadPackages`, `resolvePackage`, `writePackage`, and the rest. Includes lifecycle callbacks and addon plugin hooks.

- **[Types](./types.md)** -- The full type catalogue. `depfreshOptions`, `depfreshAddon`, `PackageMeta`, `ResolvedDepChange`, and everything your editor wants to autocomplete.

- **[Errors](./errors.md)** -- Structured error classes: `RegistryError`, `CacheError`, `ConfigError`, `WriteError`, `ResolveError`, `AddonError`. All extend `depfreshError`, all have stable codes.
