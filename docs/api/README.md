# Programmatic API

I exposed the internals. On purpose. You can `import` from `bump-cli` and do whatever you want with your dependency graph. ESM-only, obviously. It's not 2019.

## Pages

- **[Overview](./overview.md)** -- Quick start, defaults, workflow examples. The "just show me some code" page.

- **[Functions](./functions.md)** -- Every exported function: `check`, `resolveConfig`, `loadPackages`, `resolvePackage`, `writePackage`, and the rest. Plus lifecycle callbacks for the control freaks.

- **[Types](./types.md)** -- The full type catalogue. `BumpOptions`, `PackageMeta`, `ResolvedDepChange`, and 15 other things your editor wants to autocomplete.

- **[Errors](./errors.md)** -- Structured error classes: `RegistryError`, `CacheError`, `ConfigError`, `WriteError`, `ResolveError`. All extend `BumpError`, all have stable codes.
