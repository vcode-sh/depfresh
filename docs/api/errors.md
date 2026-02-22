# Error Classes

All errors thrown by bump extend `BumpError`, which gives you a stable `code` string for branching and an optional `cause` for wrapping underlying failures. Import them directly:

```ts
import {
  BumpError,
  RegistryError,
  CacheError,
  ConfigError,
  WriteError,
  ResolveError,
} from 'bump-cli'
```

## Error Reference

| Class | Code | When it fires |
|-------|------|---------------|
| `BumpError` | (base) | Abstract base. Use `instanceof BumpError` to catch everything bump throws. |
| `RegistryError` | `ERR_REGISTRY` | HTTP errors from the npm/JSR registry. Has `.status` (number) and `.url` (string). 4xx errors don't retry. 5xx errors do. |
| `CacheError` | `ERR_CACHE` | SQLite failures, corrupt entries, connection issues. bump logs and falls back to memory cache -- you'll only see this if you're using the cache API directly. |
| `ConfigError` | `ERR_CONFIG` | Invalid config file, malformed regex patterns in `include`/`exclude`, bad `packageMode` entries. Thrown during `resolveConfig()` or `parseDependencies()`. |
| `WriteError` | `ERR_WRITE` | File system failures during package writes. Permission denied, disk full, the usual suspects. |
| `ResolveError` | `ERR_RESOLVE` | Network timeouts, DNS failures, fetch errors that aren't HTTP status codes. The "something went wrong between you and the registry" bucket. |

## Usage

```ts
import { check, resolveConfig, RegistryError, ConfigError } from 'bump-cli'

try {
  const options = await resolveConfig({ mode: 'latest' })
  await check(options)
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`Bad config: ${error.message}`)
  } else if (error instanceof RegistryError) {
    console.error(`Registry ${error.status} at ${error.url}: ${error.message}`)
  } else {
    throw error
  }
}
```

Every error includes a `cause` property when wrapping a lower-level failure, so `error.cause` gives you the original `SyntaxError`, `TypeError`, or whatever cursed thing the runtime produced.
