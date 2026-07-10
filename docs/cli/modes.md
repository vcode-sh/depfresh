# Mode Reference

The `--mode` flag controls how depfresh picks target versions. It's the philosophical core of the tool -- how aggressive do you want to be?

## `default`

Respects existing range prefixes. If your manifest says `^1.2.3`, depfresh finds the latest version that satisfies `^1.x.x`. If it says `~1.2.3`, you get the latest `1.2.x`. This is the polite, society-approved mode.

Note that no mode -- not even `latest` -- will rewrite a range whose meaning it can't preserve. See [What gets rewritten](#what-gets-rewritten).

## `major`

Only shows major version updates. Filters out minor and patch updates entirely. Use this when you're feeling brave and want to see what breaking changes await. `depfresh major` is the shorthand.

## `minor`

Shows minor and patch updates within the current major version. Skips anything that would cross a major boundary. The "I want new features but I also want to sleep tonight" mode.

## `patch`

Only patch updates within the current minor version. The most conservative option. Security fixes and bug patches, nothing else. For the risk-averse and the production-adjacent.

## `latest`

Ignores range prefixes entirely and resolves to the latest version on the `latest` dist-tag. `^1.2.3` might become `4.0.0` if that's what's out there. This is `default` mode with the safety off.

## `newest`

The most recently published version by timestamp, regardless of dist-tags. If someone published `2.0.0-beta.3` five minutes ago, that's what you get. Chaotic neutral energy.

## `next`

Resolves to whatever the `next` dist-tag points at. Useful for testing pre-release versions of frameworks that use the `next` tag convention (React, etc.). Returns nothing if the package doesn't have a `next` tag.

## `ignore`

Not available via CLI flags -- this one's for the config file's `packageMode` option. Set a package to `ignore` and depfresh will skip it entirely. Useful for pinning a specific package while letting everything else update.

```json
{
  "depfresh": {
    "packageMode": {
      "typescript": "minor",
      "react": "ignore"
    }
  }
}
```

## What gets rewritten

Modes decide *which version* depfresh aims for. The shape of the spec already in your manifest decides whether depfresh is willing to touch it at all. This applies to every mode, including `latest` and `newest`.

Rewritten, shape preserved:

| Spec in your manifest | Example result |
|------|-------------|
| Exact pin -- `1.2.3` | `2.0.0` |
| Prefixed -- `^1.2.3`, `~1.2.3`, `=1.2.3` | `^2.0.0`, `~1.2.9`, `=2.0.0` |
| x-range -- `1.x`, `1.2.x` (also `1.X`, `1.*`, `1.2.*`) | `2.x`, `1.9.x` |

Held, never rewritten:

| Spec in your manifest | Example |
|------|-------------|
| Comparator range | `>=1.2.0` |
| Compound range | `>=1.0.0 <2.0.0` |
| OR range | `^1 \|\| ^2` |
| Hyphen range | `1.2 - 1.5` |
| Bare wildcard | `*`, `x`, `X` |
| Partial version | `1`, `1.2` |

depfresh cannot rewrite any of these without changing what they mean -- there is no single version that expresses "anything at or above 1.2.0" -- so it leaves them exactly as it found them rather than silently collapsing them into a pin. They're skipped, not reported as errors. If you want one of them updated, you're the one who has to decide what it should say.

A spec that is *not* a valid semver range at all -- a bare dist-tag like `beta`, or a typo -- is a different story. It isn't held; it goes down the normal resolution path and surfaces with an `error` diff, so you find out about it instead of quietly keeping it forever.

## Summary

| Mode | What it does |
|------|-------------|
| `default` | Respects the existing semver range in your manifest |
| `major` | Allows major version jumps. Brave. |
| `minor` | Up to minor updates. The sensible middle ground. |
| `patch` | Patch updates only. Maximum conservatism. |
| `latest` | Whatever the `latest` dist-tag points to. Living dangerously. |
| `newest` | The most recently published version, regardless of dist-tags. Chaotic neutral. |
| `next` | The `next` dist-tag. For beta enthusiasts. |
| `ignore` | Skip this package entirely. Out of sight, out of mind. Config file only. |
