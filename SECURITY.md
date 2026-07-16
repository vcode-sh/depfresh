# Security Policy

I take security seriously. Yes, I know that sentence usually precedes a data breach announcement, but I actually mean it.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.2.x   | Yes       |
| < 1.2   | No        |

Only the latest release gets patches. Running something older? Update first. That's literally what this tool does.

## Reporting a Vulnerability

**Do NOT open a public GitHub issue.** I will be very cross.

Email **hello@vcode.sh** with:

- **What** -- describe the vulnerability.
- **How** -- steps to reproduce it.
- **So what** -- what an attacker could actually do with this.
- **Fix** -- if you've got one. Not required, but I'll owe you a coffee.

### Response Times

- **48 hours** -- I'll acknowledge your report.
- **7 days** -- critical vulnerabilities get patched.
- **30 days** -- everything else gets a fix or a documented workaround.

If I go silent, follow up. I'm one person with a keyboard, not a 24/7 SOC team.

## What I've Already Thought About

So you don't have to:

- **SQLite cache with WAL mode** -- WAL and transactional writes reduce cross-process contention.
  If the cache path or database is unavailable, depfresh falls back to memory for the run. These
  controls are not a blanket guarantee against storage, filesystem, or process failure.
- **Auth token handling** -- `.npmrc` credentials are used for registry requests and are excluded
  from cache keys and public result contracts. Error and machine-output boundaries redact
  credential-like values instead of serializing raw request failures.
- **Exponential backoff** -- prevents request amplification. I won't accidentally DDoS npm. You're welcome, Isaac.
- **AbortController timeouts** -- every request has a timeout. No hanging connections, no resource leaks, no "why is my process still running" at 3am.
- **Explicit process authority** -- inspect and file planning do not run package-manager or
  lifecycle commands. Legacy shell-string post-write flags are rejected. A reviewed plan may name
  a supported exact manager/version, selected lockfile hash, fixed argument array, allowed paths,
  timeout, and optional verification argv. Apply requires separate process, lockfile-write,
  install, and verification grants; configuration cannot supply them.

## Stale-safe file apply

`depfresh apply --json --write --plan-file <path>` and the public `apply()` API validate a strict
immutable plan, its semantic fingerprint, clone-stable repository identity, target containment,
regular-file identity, exact source hashes and occurrence values, and target-only Git state before
mutation. Configuration cannot grant write authority. Dirty targets block; unrelated dirty paths do
not. An unavailable Git probe remains unavailable and cannot be treated as clean.

Apply owns a root-local `.depfresh/apply.lock/` and a relative-path journal under
`.depfresh/runs/<run-id>/`. It stages and backs up in each target's directory, fsyncs durable
evidence, rechecks all targets before the first replacement and each target before its rename, and
derives results from observed final bytes and occurrence values. Incomplete or unobservable recovery
retains evidence and returns `unknown`; it never becomes success.

Replacement is atomic per file, not across the repository. Recovery across several files is best
effort. A portable pure-JavaScript API cannot hold an ancestor directory descriptor through rename,
so hostile replacement of an ancestor after the final pathname check remains an operating-system
boundary.

When explicitly planned and granted, apply runs supported npm, pnpm, or Bun adapters without shell
interpolation while the apply lock and journal remain live. Lifecycle scripts are disabled; pnpm
also bypasses project hook files and fixes its lockfile, modules, virtual-store, linker, and
workspace-lock settings to contained values. Exact manager/version and lockfile bytes are checked
before source replacement and again before execution. The final lockfile must change, parse, and
match affected manifest specifiers plus exact resolved target versions. Repository and
linked-worktree Git metadata mutations outside the adapter allowlist fail; install roots and
contained symlinks are rechecked after execution. Lockfile/source bytes are restored only while
exact observed physical identity remains current. Manager caches and a full install tree are
non-transactional effects and are reported rather than presented as recovered. After a manager
command starts, any later manager or verification failure remains top-level `unknown` because its
cache effect cannot be rolled back, even when planned file bytes are restored exactly.
Yarn, legacy `bun.lockb`, and Windows manager execution are unsupported. Linux `/proc` or fixed
macOS process observers combine a private run marker with before/after same-user
PID/start/process-group identity evidence after exit, timeout, and output limits. Marked descendants
are terminated; any new unattributed same-user process and unavailable observers fail closed. This
can conservatively reject a phase when an unrelated process starts concurrently. Manager phases
accept only registry-backed `semver` and `npm:` alias occurrence protocols; unsupported protocols
block before apply. A baseline observation failure prevents spawn; a final observation failure is
unknown. Alias reconciliation binds the manifest alias key, exact registry package identity, exact
specifier, and exact version, so a same-version identity swap fails. The sanitized manager environment
excludes arbitrary credential and proxy variables, so private registries must use manager-readable
configuration and some proxy setups require an explicit future contract. These phases do not
establish package trust or update global packages.

## Disclosure

Once a fix ships, I publish a security advisory on GitHub with full details. Credit goes to the reporter unless they prefer to remain anonymous. Fame is optional, good security isn't.
