# Troubleshooting

Things went wrong. Shocking, I know.

## "No packages found"

The most popular cry for help. depfresh scans for package manifests (`package.json`, `package.yaml`) using glob patterns, and if it finds nothing, it tells you — bluntly.

**Check your working directory.** depfresh defaults to `cwd: '.'`, which means wherever you ran it from. If you're in the wrong folder, that's a you problem. Pass `--cwd /path/to/project` to point it somewhere useful.

**Check ignorePaths.** By default, depfresh ignores:

```
**/node_modules/**
**/dist/**
**/coverage/**
**/.git/**
```

Add project-specific exclusions with `ignorePaths` in `.depfreshrc` or `--ignore-paths`. The four
built-in safety exclusions remain active.

**Recursive is on by default.** `recursive: true` means depfresh walks subdirectories. If you only want the root package, set `--no-recursive`. If you DO want subdirectories and still see nothing — re-read the ignorePaths section. I'll wait.
In non-recursive mode, depfresh only checks root manifest files (`package.json`, `package.yaml`) and skips workspace catalog files.

**Nested workspace detection.** `--ignore-other-workspaces` defaults to `true`. If your monorepo contains _other_ monorepos (congrats on that life choice), depfresh skips packages belonging to nested workspaces. It detects these by looking for `pnpm-workspace.yaml`, `.yarnrc.yml`, `workspaces` fields, or `.git` directories between the package and your root. Disable with `--no-ignore-other-workspaces` if you actually want to scan everything.

## "Nothing was written"

You ran depfresh. It found updates. It showed you a lovely table. And then... nothing happened.

**Did you pass `--write`?** depfresh defaults to `write: false`. It's read-only by design. Add `-w` or `--write` to actually modify files. I'm not going to apologise for this safety net.

**Is `--interactive` on?** Interactive mode requires explicit write authority: use `depfresh -wI`.
If you selected nothing (or hit Ctrl+C), nothing gets written.

**Did `beforePackageWrite` return false?** If you're using the programmatic API with a `beforePackageWrite` callback that returns `false`, depfresh skips writing that package. Check your own code. I'm not debugging your callbacks for you.

## Compatibility "Partial result" or `VCS_UNAVAILABLE`

`Partial result` is the currently reachable grouped compatibility-table headline. Eligible Visual+
CLI writes use the recovery-first headings described below instead.

Local check writes collect and preflight every selected physical target before the first
replacement. `VCS_UNAVAILABLE` is an `unknown` outcome, not a write failure; a narrower sanitized
cause such as `VCS_OUTPUT_LIMIT_EXCEEDED` explains why Git evidence was unavailable. A clean
preflight block changes no selected file and exits with code `2`.

A reverted outcome also produces `Partial result` and exit code `2`: recovery observed the original
value, so the requested update was not retained. The headline reports both reverted operations and
the physical files recovered, including runs that also applied or blocked other targets.

Do not rerun blindly. Inspect the changed files named by the receipt first. When every local
blocking group is `VCS_UNAVAILABLE` **and** no strict resolution, global write, or strict post-write
failure also causes the final exit, correct the Git evidence problem and then rerun. If any local
blocking group has another cause, inspect that group and correct each named target before rerunning
instead of assuming Git is the only problem. When a non-local cause is also present, the receipt
uses position-neutral multi-cause guidance such as
`Exit 2 · review all reported errors and correct each blocked target before rerunning` rather than
claiming Git is the only blocker. A preflight-only receipt may say
`Safety block · no files were changed` only when no outcome was applied or reverted and every
blocked target proves replacement was not attempted and no recovery uncertainty remains. Each file
replacement is atomic, but the repository is not one atomic transaction; recovery across files is
best effort.

Visual+ retains a synthetic/internal `Partial` renderer projection, but the current eligible CLI
engine cannot produce it. After replacement starts, a failure renders `Recovered`,
`Recovery incomplete`, or `Recovery unknown` first and lists `Applied:`, `Restored:`, and
`Unrecovered:` physical paths. Visual+ operation totals can overlap: for example, an operation
whose replacement did not start because its Git evidence is unknown is counted in both
`Not attempted` and `Unknown`. Do not add the columns to infer the number of selected operations;
use the reviewed update count.

`Safety block · no files were changed` (or the ASCII
`Safety block - no files were changed` with `TERM=dumb`) is stronger than a generic failure. It
requires command-level preflight evidence for all selected physical targets and proves no
replacement, recovery, journal, external effect, or uncertain cleanup occurred. It still exits `2`
because the requested write was incomplete. Its single `Next:` line conservatively requires review
of every reported error because a Git blocker can coexist with a strict resolution or post-write
failure. Partial, failed, unknown, and recovery-first receipts likewise put one bounded inspection
or evidence-preservation action immediately before `Exit 2`.

### Visual+ output has a different default composition

Eligible Visual+ table output now uses the five-region hybrid review: context, overview, risk
focus, a complete update ledger, and a receipt. The ledger renders every selected update exactly
once without internal IDs. Run `depfresh --long` for the exhaustive audit with lifecycle, every
selected operation, owner, shared dependency, occurrence, physical target, and exact receipt.
Successful output has no durable lifecycle rail; capable terminals clear their one live line before
the review, while plain, pipes, CI, and `TERM=dumb` emit the same final semantic regions without
cursor control. Every non-success target and every applied, restored, or unrecovered recovery path
remains visible.

The former bounded-preview projection is the historical compact semantic contract completed by
[Plan 037](../plans/037-visual-plus-compact-2.1.1.md). [Plan 038](../plans/038-visual-plus-hybrid-default.md)
owns its in-progress visual-composition successor.

Repository and package-manager context now appears only after discovery has observed it. Seeing no
context during startup is expected and avoids false placeholders; an `unknown` value printed after
discovery means the evidence was actually absent. `depfresh --write --interactive` intentionally
uses the separate selection UI, so neither compact Visual+ nor Visual+ `--long` applies there.

### Visual+ is plain, colourless, or append-only

This can be the expected capability fallback rather than lost output:

- both stdout and stderr must be TTYs, CI must be inactive, and `TERM` must not be `dumb` for the
  capable local profile;
- `NO_COLOR` disables colour but preserves the same final review and one live line while work is
  active when the terminal is otherwise capable;
- a narrow otherwise-capable terminal wraps the complete ledger losslessly and keeps its active
  live line transient;
- CI and non-TTY pipes use colourless append-only final output without lifecycle history;
- `TERM=dumb` uses append-only ASCII without cursor control;
- every profile retains result evidence.

The final semantic content and exit code are unchanged. Direct table pipes print a stderr hint for
`--output json`; use JSON for machines rather than parsing terminal text. Interactive, JSON, and
global commands intentionally do not use Visual+. Neither do library `check()` calls or routes
with a direct or addon `beforePackageWrite` hook; those retain the compatibility table surface.

Global write failures have their own sanitized stdout section, for example:

```text
Global write outcomes
npm · typescript · unknown · INVENTORY_TIMEOUT
```

Each line preserves the global manager, package, status, and exact available reason. This includes
pre-execution outcomes such as `GLOBAL_TARGET_MISSING` or `GLOBAL_OBSERVATION_FAILED`; when an
executor result exists, its exact reason takes precedence over the compatibility-mapped write
reason. The section is separate from the local physical-target receipt, does not count global
managers as files, and makes no atomicity claim.

## "Invalid value for --mode/--output/--sort/--loglevel"

depfresh validates enum flags strictly and exits with code `2` for invalid values. There is no fallback to defaults for these flags.

```bash
# invalid
depfresh --sort ascending

# valid
depfresh --sort name-asc
```

## Private registry auth fails

Ah, corporate life. Your packages live behind a firewall and depfresh can't reach them.

**Check .npmrc location.** depfresh reads `.npmrc` from both your project directory and your home directory (`~/.npmrc`). If your auth token is in neither, depfresh can't authenticate.

**Scoped registry syntax matters.** Make sure your `.npmrc` looks something like:

```ini
@mycompany:registry=https://npm.mycompany.com/
//npm.mycompany.com/:_authToken=${NPM_TOKEN}
```

Note the trailing slashes. Note the `//` prefix. npm invented this syntax and I refuse to explain why it looks like that.

**Registry path matching is exact.** If your registry URL includes a path segment, the auth entry needs to include the same path:

```ini
@mycompany:registry=https://npm.mycompany.com/internal/
//npm.mycompany.com/internal/:_authToken=${NPM_TOKEN}
```

**Environment variable expansion.** depfresh expands `${VAR}` references in `.npmrc` values. If the env var isn't set, the token will be empty and your registry will reject you. Double-check with `echo $NPM_TOKEN` before blaming depfresh.

## "Dependency not found"

**Is it a workspace package?** depfresh automatically skips dependencies that match names of other packages in your workspace. If `@myapp/utils` is both a workspace package and a dependency, depfresh won't hit the registry for it. This is intentional. You don't publish your local packages to npm just to check for updates.

**Check the registry URL.** If a package lives on a custom registry and you haven't configured `.npmrc` correctly, depfresh will look for it on the default npm registry and come back empty-handed.

**JSR packages.** depfresh reads the explicit JSR `latest` value, per-version `createdAt` values, and
the `yanked` flag. It never guesses `latest` from object insertion order. A missing or inconsistent
latest value is skipped in `latest` mode; yanked versions are filtered like deprecated npm versions.

**GitHub dependencies.** depfresh supports `github:owner/repo#tag` when `tag` is semver-like (`v1.2.3`, `1.2.3`, `refs/tags/v1.2.3`). Branches, commits, and non-semver tags are skipped on purpose.

If you hit GitHub API rate limits:

- Set `GITHUB_TOKEN` or `GH_TOKEN` in your environment.
- Retry after the reset time shown in the error.
- Lower concurrency if you're scanning a lot of GitHub-sourced deps at once.

## Workspace issues

### Repository inspection says evidence is ambiguous or unavailable

`inspectRepository()` does not default an unknown package manager to npm. Conflicting valid
boundary-root `packageManager` fields, distinct lockfile managers, multiple lockfiles, workspace
declarations, or declared Node constraints remain explicit `ambiguous` conclusions with every
candidate retained. Invalid manager or supported runtime syntax is `unsupported`; absent evidence
is `missing`.

Git evidence is `unavailable` with a distinct stable diagnostic when Git is missing, the target is
not a Git repository, or a read-only probe fails or is corrupt. Raw Git stderr is not serialized.
Inspection sanitizes inherited Git control and trace variables, probes nested Git repositories
separately, and disables configured filesystem monitors and untracked-cache updates. It never
stages, restores, cleans, checks out, refreshes the index, runs a package manager, or executes
lifecycle scripts. Registry resolution, Node compatibility policy, lockfile synchronization,
installs, and apply behavior remain separate operations.

Supported lockfile names are `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`,
`yarn.lock`, `bun.lock`, and legacy `bun.lockb`. Modern `bun.lock` is parsed as JSONC; the binary
`bun.lockb` format is hashed but marked `unsupported`, and Bun is never invoked to interpret either
format. Declared Node evidence is limited to
`engines.node`, `.nvmrc`, `.node-version`, and the `nodejs` entry in `.tool-versions`.

### Apply says a plan is stale or a target is dirty

Apply requires the target file, occurrence value, physical identity, repository identity, and
target-only Git evidence to match the reviewed plan exactly. Do not edit hashes or expected values
to force a plan through. Run inspect and plan again, review the new operations, then apply the new
document. Dirty paths that are not targets do not block the run.

An unavailable Git probe is not the same as a clean target. Fix the Git availability or repository
problem before retrying. A definite non-Git directory can still apply from exact file evidence.

### Apply reports a lock or recovery requirement

The active owner is recorded at `.depfresh/apply.lock/owner.json`; durable run evidence is recorded
with repository-relative paths at `.depfresh/runs/<run-id>/journal.json`. Never delete a live,
foreign-host, malformed, unreadable, or otherwise unknown owner. Stop every apply process before
inspecting a confirmed dead run.

An interrupt such as `SIGTERM` may arrive after a file replacement. The process exits immediately
and intentionally leaves the owned lock, journal, and same-directory backups. A later write remains
blocked with `RECOVERY_REQUIRED`; it does not guess which prior run is safe to recover or clean.

For a dead crashed run, verify each same-directory backup against the journal's original hash,
atomically restore it over the target, and verify the final target bytes and occurrences. Remove
the retained run evidence only after every target is known. If any owner, backup, target, or final
state is ambiguous, preserve the evidence and keep the outcome `unknown`.

### Catalogs not updating

depfresh handles workspace catalogs (pnpm, bun, yarn) by updating them in-place in their respective source files — `pnpm-workspace.yaml`, root `package.json` (`workspaces.catalog` / `workspaces.catalogs`), or `.yarnrc.yml`. If your catalog entries aren't updating, make sure `--write` is set and that depfresh actually detected the catalog. Check debug output with `--loglevel debug`.

Named `peers` catalogs are skipped unless `--peer` is enabled.

### Wrong packages showing up

If depfresh is picking up packages you didn't expect, check two things:

1. **ignorePaths** — are you accidentally scanning `node_modules` or build artifacts?
2. **Nested workspaces** — is `--ignore-other-workspaces` doing what you think? Run with `--loglevel debug` to see which packages get skipped and why.

## Interactive mode not showing

Interactive mode requires `--write`; `depfresh -I` fails before discovery. Use `depfresh -wI` in
an interactive terminal.

The custom TUI requires both `process.stdin.isTTY` and `process.stdout.isTTY` to be true. If you're piping output, running in CI, or using an AI agent, depfresh falls back to a `@clack/prompts` grouped multiselect instead. If *that* doesn't show either, you're in a fully non-interactive environment and should drop the `-I` flag before it gets awkward.

**Cursor disappeared?** depfresh registers handlers for `SIGINT`, `SIGTERM`, and `exit` to restore the cursor and disable raw mode. If something goes catastrophically wrong and your cursor vanishes, run:

```bash
tput cnorm
```

Also restores your terminal if raw mode got stuck:

```bash
stty sane
```

**Keys not responding?** The TUI uses `readline.emitKeypressEvents()` in raw mode. Some terminal multiplexers (tmux, screen) intercept certain key sequences. If `Ctrl+C` works but vim keys don't, check your multiplexer's key pass-through settings. Or just use arrow keys like a normal person.

## Manager phase issues

Legacy `--execute`, check-mode `--install`, `--update`, `--verify-command`, and
`--strict-post-write` are rejected. Use a reviewed `plan` plus matching `apply` grants.

### Manager or lockfile preflight is blocked

The plan must contain one confirmed supported manager/version and one selected parsed lockfile for
each affected boundary. Apply checks the exact executable version and planned lockfile bytes while
holding its lock. Missing, ambiguous, unsupported, unavailable, stale, or mismatched evidence is
not guessed and never falls back to npm. Re-inspect and re-plan after correcting the declaration.

### A manager or verification phase failed

The apply result records exact argv, cwd, termination, final lockfile hash/parse/resolved-target
state, changed and unexpected paths, and external effects without stdout, stderr, secrets, or
stacks. Nonzero exit, signal, timeout, inherited surviving descendants, a new unattributed same-user
process, malformed or stale lockfile output, source drift, lock loss, or any unexpected repository
mutation prevents success. If the baseline process census is unavailable, the command is not
spawned. After spawn, an unavailable final census or an unattributed new process group is unknown.
Because the census is conservative, an unrelated process that starts in a new process group
concurrently can also make the phase unknown.
Verification uses only the fingerprinted JSON argv and may not mutate repository paths. Manager
execution currently fails closed on Windows because equivalent process-tree observation is not
available.

For `artifact-verify`, first confirm the immutable plan selected npm 11.12.x or verified npm 12.0.x,
public npm registry artifacts, canonical SHA-512 integrity, and full install. Pnpm, Bun, JSR, private registries,
unsupported npm versions, or missing integrity block planning. A project `.npmrc` produces
verifier-unavailable apply evidence rather than being inherited.
Offline network codes and expired signature-key evidence are reported as distinct unknown states;
retry only after the environment or upstream evidence changes. Timeout/output-limit termination is
visible on the command; malformed or oversized JSON becomes a sanitized verifier-error trust state.
These fail/unknown trust results warn by default, so apply may still succeed without claiming trust;
only a matching fingerprinted `block` rule triggers recovery. A final-lockfile/install mismatch,
unexpected repository mutation, or temporary-home cleanup failure is a safety failure. A missing
npm executable fails manager preflight before the artifact phase. Raw npm output is intentionally
not retained; use the stable phase, command termination, artifact reason, and matched/winning policy
IDs.

### Recovery is partial or unknown

Lockfile recovery occurs only when the current physical identity still matches evidence observed
for the owned command. An atomic replacement, symlink, concurrent change, lost lock/journal,
unexpected path, install tree, or manager cache can remain unrecovered. Preserve `.depfresh` run
evidence, stop competing apply processes, and follow the recovery procedure above. Never delete
retained evidence merely to make the next run proceed.

After any manager command starts, a later manager or verification failure is conservatively
top-level `unknown` because the declared package-manager-cache effect cannot be rolled back, even if
the planned source and lockfile bytes were restored exactly.

For an eligible local Visual+ write, any post-replacement failure enters recovery. The final
headline is `Recovered`, `Recovery incomplete`, or `Recovery unknown`, ahead of the renderer's
synthetic compatibility `Partial` projection. Read every `Applied:`, `Restored:`, `Unrecovered:`,
`Journal:`, and `External effects:` line. Preserve the journal and other `.depfresh` evidence,
inspect named paths, and stop competing writers before a fresh inspect/plan or retry. A
same-directory rename is atomic for one file only; recovery across the repository and manager
caches or install trees is not atomic.

## Performance

### Concurrency

Default is 16 concurrent registry requests. If you're hitting rate limits (HTTP 429), lower it:

```bash
depfresh --concurrency 4
```

If you've got bandwidth to spare and a massive monorepo, crank it up:

```bash
depfresh --concurrency 32
```

### Cache

depfresh uses a SQLite cache at `~/.depfresh/cache.db` with a 30-minute TTL. To clear it, just delete the file:

```bash
rm ~/.depfresh/cache.db
```

If the cache directory or database can't be opened, depfresh falls back to an in-memory cache. It works, but nothing persists between runs.

### Large monorepos

For monorepos with dozens of packages: increase concurrency, double-check your `ignorePaths` aren't scanning the entire universe, and use `--loglevel debug` to see where time is being spent.

## Error types

If you're using the programmatic API, all errors thrown by depfresh extend `depfreshError`. You can branch on error class or the `.code` string:

| Error | Code | Meaning |
|-------|------|---------|
| `RegistryError` | `ERR_REGISTRY` | HTTP errors from npm/JSR. Check `.status` and `.url`. 4xx errors (404, 403) don't retry. 5xx errors retry up to `retries` times. |
| `CacheError` | `ERR_CACHE` | SQLite corruption, connection failure. depfresh auto-falls back to memory cache, so you only see this if using the cache API directly. |
| `ConfigError` | `ERR_CONFIG` | Invalid config file, broken regex in `include`/`exclude`. Check your `.depfreshrc` or `depfresh.config.ts`. |
| `WriteError` | `ERR_WRITE` | File system failure during write. Permission denied, disk full, read-only filesystem. |
| `ResolveError` | `ERR_RESOLVE` | Network-level failures. DNS, timeouts, fetch errors that aren't HTTP status codes. |

All errors include a stable `.reason`. CLI and JSON rendering redact credentials and nested failure
details. Raw `.cause` values remain available to library callers for local diagnostics and should
not be printed directly into shared logs.

---

## Known limitations

**Global packages.** `--global` and `--global-all` support npm 10/11, pnpm 10/11, and Bun
`>=1.2.0 <2.0.0`. Yarn global is unsupported. Missing executables, unsupported versions, malformed
or timed-out inventory, a changed executable/global root, or lost post-command inventory fail
closed as unavailable, conflicted, or unknown. Re-run read-only inventory and create a fresh plan;
do not treat a successful process exit as proof that the package changed.

**JSR registry.** Works, but metadata is sparser than npm. Signature-presence and some passive
metadata may be unavailable. When `--cooldown` needs a missing publish time, the candidate is
skipped as unknown rather than assumed mature.

**Node compatibility.** The legacy `--nodecompat` display exposes target `engines.node` metadata;
it does not compare against the Node process running depfresh. `?node` means repository
compatibility is unknown. For machine decisions, use `depfresh plan`: its runtime signal requires
confirmed repository declarations and keeps missing, conflicting, or unsupported evidence unknown.

**Exit codes.** Legacy check uses `0` for a complete check or fully observed write, optional `1` for
outdated results with `--fail-on-outdated`, and `2` for fatal or incomplete writes. Inspect/plan use
`1` for a valid actionable/incomplete document; repository apply uses `1` for a schema-valid
non-success result. Global compatibility writes use `2` when any selected item is conflicted,
failed, or unknown; inspect `globalResults` instead of treating that as an absent result.
