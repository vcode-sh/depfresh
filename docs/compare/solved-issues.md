# Problems We Didn't Have to Invent

These are real issues filed by real developers in taze's issue tracker. We read every single one, plus every unmerged PR collecting dust. Not to dunk on anyone -- to build something that ships with the answers already in the box.

taze is a fine tool for happy paths. This page is about the other paths.

---

## Solved Issues

### Registry & Network

| Problem | taze Issue | Status in taze | depfresh Solution | How to verify |
|---------|-----------|----------------|-------------------|---------------|
| Private registry auth fails silently ("unknown error" on scoped packages) | [#13](https://github.com/antfu-collective/taze/issues/13), [#161](https://github.com/antfu-collective/taze/issues/161) | Open since 2020 | Full [`.npmrc` parsing](../configuration/files.md) with scoped registries and auth tokens from day one | `depfresh --output json` with a scoped private package |
| Proxy/TLS/CA settings not forwarded | No issue filed (silently ignored) | N/A | `undici` transport policy applies `https-proxy`, `strict-ssl`, `cafile` from `.npmrc` | Set `https-proxy` in `.npmrc`, run through corporate proxy |
| Network change hangs forever | [#44](https://github.com/antfu-collective/taze/issues/44) | Open | 10s default timeout + exponential backoff retry (2 retries) | `depfresh --timeout 1000` with a slow registry |
| Socket timeout crashes the process | [#18](https://github.com/antfu-collective/taze/issues/18) | Open | Caught, retried, reported in JSON `errors[]` | Kill network mid-run, check [JSON output](../output-formats/json.md) |
| One bad JSR package blocks entire run | [#140](https://github.com/antfu-collective/taze/issues/140) | Open | Partial failure -- healthy deps resolve, errors reported separately | Add a nonexistent `jsr:@fake/pkg` dep, run `--output json` |

### CLI & Output

| Problem | taze Issue | Status in taze | depfresh Solution | How to verify |
|---------|-----------|----------------|-------------------|---------------|
| No machine-readable output | [#201](https://github.com/antfu-collective/taze/issues/201) | Open since 2024 | [`--output json`](../output-formats/json.md) with full structured envelope (packages, errors, summary, meta) | `depfresh --output json \| jq .summary` |
| No machine discoverability | No equivalent | N/A | [`--help-json`](../cli/flags.md) returns version, all flags, enums, exit codes, relationships | `depfresh --help-json \| jq .flags` |
| Can't filter by dependency type | [#101](https://github.com/antfu-collective/taze/issues/101) | Open | `--deps-only` and `--dev-only` [flags](../cli/flags.md) | `depfresh --deps-only` |
| No detail/long mode (no homepage URLs) | [#48](https://github.com/antfu-collective/taze/issues/48) | Open | `--long` shows homepage per dependency | `depfresh --long` |
| Interactive mode flickers on arrow keys | [#107](https://github.com/antfu-collective/taze/issues/107) | Open | Custom readline TUI, no flicker | `depfresh -I` |

### Configuration & Behaviour

| Problem | taze Issue | Status in taze | depfresh Solution | How to verify |
|---------|-----------|----------------|-------------------|---------------|
| `packageMode` silently ignored when `mode` is set | [#91](https://github.com/antfu-collective/taze/issues/91) | Open | Deterministic precedence -- `packageMode` always applies on top | Set both `mode` and `packageMode` in [config](../configuration/options.md) |
| `npm_config_userconfig` env var overwritten | [#118](https://github.com/antfu-collective/taze/issues/118) | Open | Env var respected, XDG paths work | `npm_config_userconfig=/custom/path depfresh` |
| Invalid pnpm override parsing (`pnpm audit --fix` output) | [#173](https://github.com/antfu-collective/taze/issues/173) | Open | Correct `name@version-range` nested override parsing | Add `"tar-fs@>=2.0.0 <2.1.2"` to `pnpm.overrides` |
| Prerelease versions not detected (rc/beta) | [#185](https://github.com/antfu-collective/taze/issues/185) | Open | Channel-aware prerelease resolution | Pin a package to an old rc version, run depfresh |

### Write & Verify

| Problem | taze Issue | Status in taze | depfresh Solution | How to verify |
|---------|-----------|----------------|-------------------|---------------|
| No verify-then-rollback workflow | [#78](https://github.com/antfu-collective/taze/issues/78) | Open | [`--verify-command`](../cli/flags.md#verify-command) runs per-dep, rolls back on failure | `depfresh -w --verify-command "pnpm typecheck"` |
| Bun catalog updates silently clobbered by `taze -w` | [#239](https://github.com/antfu-collective/taze/issues/239) | Open | Single-writer architecture, regression-tested | Bun monorepo with catalog + regular deps, `depfresh -w` |

---

## Unmerged PRs We Shipped

Things that got built, reviewed, and then left to gather moss. We shipped them.

| Feature | taze PR | Status in taze | depfresh status |
|---------|---------|----------------|-----------------|
| Bun catalog support (read + write) | [#192](https://github.com/antfu-collective/taze/pull/192) | Open / unmerged | Shipped |
| `packageManager` hash preservation (SHA-224) | [#234](https://github.com/antfu-collective/taze/pull/234) | Open / unmerged | Shipped |
| Unsorted version array fix (`maxSatisfying`) | [#217](https://github.com/antfu-collective/taze/pull/217) | Open / unmerged | Shipped |
| Cooldown/maturity filter | [#205](https://github.com/antfu-collective/taze/pull/205) | Merged | Shipped as [`--cooldown N`](../cli/flags.md) |
| Provenance warnings (Sigstore attestation) | [#198](https://github.com/antfu-collective/taze/pull/198) | Merged | Shipped with full attestation tracking |
| Node engine compatibility check | [#165](https://github.com/antfu-collective/taze/pull/165) | Merged | Shipped as [`--nodecompat`](../cli/flags.md) (on by default) |

That's 3 unmerged PRs collecting mass, plus 3 merged PRs we also ship. For a total of 6, though who's counting. We are. Obviously.

---

## The Numbers

Because someone will ask.

| Metric | depfresh | taze |
|--------|----------|------|
| Test files | 77 | 13 |
| Tests passing | 598 | ~55 |
| CLI flags | 36 | 24 |
| Open issues solved at launch | 15 | -- |
| Unmerged PRs shipped at launch | 6 | -- |
| Cache architecture | SQLite WAL | JSON file |
| Default concurrency | 16 | 10 |
| Default timeout | 10s | 5s |
| Retry strategy | Exponential backoff | None |

---

We didn't build depfresh because taze is terrible. We built it because we got tired of waiting for the pull requests to merge.
