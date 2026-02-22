# Mode Reference

The `--mode` flag controls how depfresh picks target versions. It's the philosophical core of the tool -- how aggressive do you want to be?

## `default`

Respects existing range prefixes. If your `package.json` says `^1.2.3`, depfresh finds the latest version that satisfies `^1.x.x`. If it says `~1.2.3`, you get the latest `1.2.x`. This is the polite, society-approved mode.

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

## Summary

| Mode | What it does |
|------|-------------|
| `default` | Respects the existing semver range in your `package.json` |
| `major` | Allows major version jumps. Brave. |
| `minor` | Up to minor updates. The sensible middle ground. |
| `patch` | Patch updates only. Maximum conservatism. |
| `latest` | Whatever the `latest` dist-tag points to. Living dangerously. |
| `newest` | The most recently published version, regardless of dist-tags. Chaotic neutral. |
| `next` | The `next` dist-tag. For beta enthusiasts. |
| `ignore` | Skip this package entirely. Out of sight, out of mind. Config file only. |
