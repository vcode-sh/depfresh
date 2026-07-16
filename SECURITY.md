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
  lifecycle commands. Legacy `--execute`, `--install`, `--update`, and `--verify-command` features
  run processes only when their required flags and explicit write authority are present. File apply
  does not run those commands.

## Stale-safe file apply

`depfresh apply --json --write --plan-file <path>` and the public `apply()` API validate a strict
immutable plan, its semantic fingerprint, clone-stable repository identity, target containment,
regular-file identity, exact source hashes and occurrence values, and target-only Git state before
mutation. Configuration cannot grant write authority. Dirty targets block; unrelated dirty paths do
not. An unavailable Git probe remains unavailable and cannot be treated as clean.

Apply owns a root-local `.depfresh/apply.lock` and a relative-path journal under
`.depfresh/runs/<run-id>/`. It stages and backs up in each target's directory, fsyncs durable
evidence, rechecks all targets before the first replacement and each target before its rename, and
derives results from observed final bytes and occurrence values. Incomplete or unobservable recovery
retains evidence and returns `unknown`; it never becomes success.

Replacement is atomic per file, not across the repository. Recovery across several files is best
effort. A portable pure-JavaScript API cannot hold an ancestor directory descriptor through rename,
so hostile replacement of an ancestor after the final pathname check remains an operating-system
boundary. Apply does not synchronize lockfiles, invoke managers, install packages, update globals,
or establish package trust.

## Disclosure

Once a fix ships, I publish a security advisory on GitHub with full details. Credit goes to the reporter unless they prefer to remain anonymous. Fame is optional, good security isn't.
