# Comparing depfresh and taze

depfresh is a spiritual successor to [taze](https://github.com/antfu/taze) by Anthony Fu. taze pioneered the "run one command and see what's outdated" experience for npm projects, and we built depfresh on that foundation. Credit where it's due -- taze is the reason this tool exists.

We rewrote everything from scratch because we wanted stronger CI ergonomics, machine-readable output, and better handling of real-world registry failures. This section documents the differences factually.

## Key Differences

| Area | How depfresh handles it |
|------|------------------------|
| **Structured output** | `--output json` emits a typed envelope with schema version, summary, and error array |
| **Machine-readable CLI** | `--help-json` returns the full CLI contract (flags, enums, workflows) |
| **Registry resilience** | Exponential backoff, partial-failure isolation, typed error hierarchy |
| **Cache** | SQLite with WAL mode and memory fallback (no JSON file race conditions) |
| **Private registries** | Full `.npmrc` support including scoped registries, auth tokens, and proxy/TLS transport |
| **Safe writes** | `--verify-command` tests each dependency individually and reverts on failure |
| **Bun catalogs** | Single-writer architecture to prevent catalog clobbering |

For migration details, see [Migrating from taze](./from-taze.md).

## Pages in This Section

- **[Coverage Matrix](./coverage-matrix.md)** -- Canonical tracking of every open taze issue and PR, with `shipped` / `partial` / `missing` status and evidence links.
- **[Migrating from taze](./from-taze.md)** -- Practical migration guide: flag mapping, config changes, behavioral differences.
- **[Solved Issues](./solved-issues.md)** -- High-impact taze backlog items that depfresh addresses, with test evidence.
- **[Registry & Edge-Case Testing](./integration-testing.md)** -- Integration test scenarios covering registry failures, private auth, and edge cases.

## Ground Rules

- `shipped` means implemented and covered by tests or docs.
- `partial` means behavior exists but parity is incomplete.
- `missing` means not implemented.
- Claims without evidence should be treated as incorrect.
