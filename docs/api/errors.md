# Error Classes

All errors thrown by depfresh extend `depfreshError`, which gives you a stable broad `code`, a
specific `reason`, and an optional `cause` for wrapping underlying failures. Rendered CLI and JSON
errors redact credentials, authorization values, sensitive query parameters, and nested causes.
Import them directly:

```ts
import {
  depfreshError,
  AddonError,
  RegistryError,
  CacheError,
  ConfigError,
  ContractValidationError,
  WriteError,
  ResolveError,
} from 'depfresh'
```

## Error Reference

| Class | Code | Typical reasons | When it fires |
|-------|------|-----------------|---------------|
| `depfreshError` | (base) | `UNKNOWN_ERROR` | Abstract base. Use `instanceof depfreshError` to catch everything depfresh throws. |
| `RegistryError` | `ERR_REGISTRY` | `REGISTRY_REQUEST_FAILED` | HTTP errors from the npm/JSR registry. Has `.status` and a redacted `.url`. |
| `CacheError` | `ERR_CACHE` | `CACHE_FAILURE` | SQLite failures, corrupt entries, or connection issues. |
| `AddonError` | `ERR_ADDON` | `ADDON_FAILURE` | Addon hook failures. Includes `.addon` and `.hook`. |
| `ConfigError` | `ERR_CONFIG` | `UNKNOWN_OPTION`, `MISSING_OPTION_VALUE`, `CONFLICTING_OPTION`, `INVALID_BOOLEAN`, `INVALID_OPTION_VALUE`, `UNSUPPORTED_COMBINATION`, `AUTHORITY_REQUIRED`, `CONFIG_LOAD_FAILED`, `CONFIG_PARSE_FAILED`, `INVALID_CONFIG` | Invalid argv, config, or invocation authority. |
| `WriteError` | `ERR_WRITE` | `WRITE_FAILURE` | File system failures during package writes. |
| `ResolveError` | `ERR_RESOLVE` | `RESOLUTION_FAILURE` | Network timeouts, DNS failures, and non-HTTP fetch errors. |
| `ContractValidationError` | `ERR_CONTRACT_VALIDATION` | Schema or semantic contract failure | An `assert*()` helper rejects an incomplete, forged, or unsupported public contract. |

## Usage

```ts
import { check, resolveConfig, RegistryError, ConfigError } from 'depfresh'

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

Every error includes a `cause` property when wrapping a lower-level failure. Treat raw causes as
diagnostic data; use the CLI/JSON rendering boundary when output may be visible to untrusted logs.
