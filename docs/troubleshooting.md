# Troubleshooting

Things went wrong. Shocking, I know.

## "No packages found"

The most popular cry for help. bump scans for `package.json` files using glob patterns, and if it finds nothing, it tells you — bluntly.

**Check your working directory.** bump defaults to `cwd: '.'`, which means wherever you ran it from. If you're in the wrong folder, that's a you problem. Pass `--cwd /path/to/project` to point it somewhere useful.

**Check ignorePaths.** By default, bump ignores:

```
**/node_modules/**
**/dist/**
**/coverage/**
**/.git/**
```

If your package.json lives somewhere exotic that matches one of these patterns, bump will politely pretend it doesn't exist. Override with `ignorePaths` in your `.bumprc` config.

**Recursive is on by default.** `recursive: true` means bump walks subdirectories. If you only want the root package, set `--no-recursive`. If you DO want subdirectories and still see nothing — re-read the ignorePaths section. I'll wait.

**Nested workspace detection.** `--ignore-other-workspaces` defaults to `true`. If your monorepo contains _other_ monorepos (congrats on that life choice), bump skips packages belonging to nested workspaces. It detects these by looking for `pnpm-workspace.yaml`, `.yarnrc.yml`, `workspaces` fields, or `.git` directories between the package and your root. Disable with `--no-ignore-other-workspaces` if you actually want to scan everything.

## "Nothing was written"

You ran bump. It found updates. It showed you a lovely table. And then... nothing happened.

**Did you pass `--write`?** bump defaults to `write: false`. It's read-only by design. Add `-w` or `--write` to actually modify files. I'm not going to apologise for this safety net.

**Is `--interactive` on?** In interactive mode, you pick which deps to update. If you selected nothing (or hit Ctrl+C), nothing gets written. That's the deal.

**Did `beforePackageWrite` return false?** If you're using the programmatic API with a `beforePackageWrite` callback that returns `false`, bump skips writing that package. Check your own code. I'm not debugging your callbacks for you.

## Private registry auth fails

Ah, corporate life. Your packages live behind a firewall and bump can't reach them.

**Check .npmrc location.** bump reads `.npmrc` from both your project directory and your home directory (`~/.npmrc`). If your auth token is in neither, bump can't authenticate.

**Scoped registry syntax matters.** Make sure your `.npmrc` looks something like:

```ini
@mycompany:registry=https://npm.mycompany.com/
//npm.mycompany.com/:_authToken=${NPM_TOKEN}
```

Note the trailing slashes. Note the `//` prefix. npm invented this syntax and I refuse to explain why it looks like that.

**Environment variable expansion.** bump expands `${VAR}` references in `.npmrc` values. If the env var isn't set, the token will be empty and your registry will reject you. Double-check with `echo $NPM_TOKEN` before blaming bump.

## "Dependency not found"

**Is it a workspace package?** bump automatically skips dependencies that match names of other packages in your workspace. If `@myapp/utils` is both a workspace package and a dependency, bump won't hit the registry for it. This is intentional. You don't publish your local packages to npm just to check for updates.

**Check the registry URL.** If a package lives on a custom registry and you haven't configured `.npmrc` correctly, bump will look for it on the default npm registry and come back empty-handed.

**JSR packages.** bump supports `jsr:` protocol packages, but JSR metadata is more limited than npm's. Some fields may be missing.

## Workspace issues

### Catalogs not updating

bump handles workspace catalogs (pnpm, bun, yarn) by updating them in-place in their respective config files — `pnpm-workspace.yaml`, `bunfig.toml`, or `.yarnrc.yml`. If your catalog entries aren't updating, make sure `--write` is set and that bump actually detected the catalog. Check debug output with `--loglevel debug`.

### Wrong packages showing up

If bump is picking up packages you didn't expect, check two things:

1. **ignorePaths** — are you accidentally scanning `node_modules` or build artifacts?
2. **Nested workspaces** — is `--ignore-other-workspaces` doing what you think? Run with `--loglevel debug` to see which packages get skipped and why.

## Interactive mode not showing

The custom TUI requires both `process.stdin.isTTY` and `process.stdout.isTTY` to be true. If you're piping output, running in CI, or using an AI agent, bump falls back to a `@clack/prompts` grouped multiselect instead. If *that* doesn't show either, you're in a fully non-interactive environment and should drop the `-I` flag before it gets awkward.

**Cursor disappeared?** bump registers handlers for `SIGINT`, `SIGTERM`, and `exit` to restore the cursor and disable raw mode. If something goes catastrophically wrong and your cursor vanishes, run:

```bash
tput cnorm
```

Also restores your terminal if raw mode got stuck:

```bash
stty sane
```

**Keys not responding?** The TUI uses `readline.emitKeypressEvents()` in raw mode. Some terminal multiplexers (tmux, screen) intercept certain key sequences. If `Ctrl+C` works but vim keys don't, check your multiplexer's key pass-through settings. Or just use arrow keys like a normal person.

## Post-write issues

### `--execute` not running

Three conditions must ALL be true:

1. `--write` is set
2. `--execute` has a command
3. At least one file was **actually modified** (the `didWrite` flag)

If bump found updates but nothing changed on disk — maybe `beforePackageWrite` returned false, maybe interactive mode selected nothing — the execute command won't fire. This is deliberate. I'm not running your `npm test` for zero changes.

### `--verify-command` reverting everything

`--verify-command` tests each dependency update individually. It writes one change, runs your command, and if the command fails, it reverts that specific change. If your command fails for EVERY dependency, everything gets reverted.

Before blaming bump, check that your verify command works standalone:

```bash
# Does this actually work?
cd /your/project && your-verify-command
```

If the command itself is broken, every single dep will get reverted. That's not a bug, that's your test suite.

### `--install` / `--update` not running

Same conditions as `--execute`: `--write` must be set AND changes must have been written to disk. bump auto-detects your package manager from the `packageManager` field or lockfile presence (checks for `bun.lock`, `pnpm-lock.yaml`, `yarn.lock`, in that order, falling back to `npm`).

## Performance

### Concurrency

Default is 16 concurrent registry requests. If you're hitting rate limits (HTTP 429), lower it:

```bash
bump --concurrency 4
```

If you've got bandwidth to spare and a massive monorepo, crank it up:

```bash
bump --concurrency 32
```

### Cache

bump uses a SQLite cache at `~/.bump/cache.db` with a 30-minute TTL. To clear it, just delete the file:

```bash
rm ~/.bump/cache.db
```

If `better-sqlite3` isn't available (hello, exotic environments), bump falls back to an in-memory cache. It works, but nothing persists between runs.

### Large monorepos

For monorepos with dozens of packages: increase concurrency, double-check your `ignorePaths` aren't scanning the entire universe, and use `--loglevel debug` to see where time is being spent.

## Known limitations

**SARIF output.** The type exists in the codebase. The implementation doesn't. Yet.

**Yarn global packages.** `--global` supports npm, pnpm, and bun. Yarn global is not supported. I don't make the rules. Actually I do, and I chose not to support it.

**JSR registry.** Works, but metadata is sparser than npm. Some features like provenance tracking or detailed time data may be incomplete.

**Node compatibility.** The `--nodecompat` flag checks the `engines.node` field in package metadata. This is best-effort — not every package declares engine constraints, and some declarations are optimistic at best.

**Exit codes.** For the automation crowd: `0` means no updates (or written successfully), `1` means updates available (with `--fail-on-outdated`), `2` means something actually broke.
