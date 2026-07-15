# Mode Reference

The `--mode` flag controls how depfresh picks target versions. Every mode selects from the same
eligible-candidate set after semver normalization, prerelease-channel checks, deprecation checks,
and cooldown checks. A target below the normalized current version is never selected implicitly.

## `default`

Respects existing range prefixes. If your manifest says `^1.2.3`, depfresh finds the latest version that satisfies `^1.x.x`. If it says `~1.2.3`, you get the latest `1.2.x`. This is the polite, society-approved mode.

Exact pins are normally excluded before resolution. With `--include-locked`, default mode selects
the highest eligible version for the pin because an exact version has no wider range to preserve.

Note that no mode -- not even `latest` -- will rewrite a range whose meaning it can't preserve. See [What gets rewritten](#what-gets-rewritten).

## `major`

Allows updates across major-version boundaries and selects the highest eligible version. If no
major jump exists, it can still select a newer minor or patch version. `depfresh major` is the
shorthand.

## `minor`

Shows minor and patch updates within the current major version. Skips anything that would cross a major boundary. The "I want new features but I also want to sleep tonight" mode.

## `patch`

Only patch updates within the current minor version. The most conservative option. Security fixes and bug patches, nothing else. For the risk-averse and the production-adjacent.

## `latest`

Ignores range prefixes and considers the version named by the registry's `latest` dist-tag. The tag
must be valid semver, must exist in the registry version set, and must pass the shared safety
filters. `^1.2.3` might become `4.0.0` if that is the eligible tagged version.

## `newest`

The highest eligible semantic version, regardless of dist-tags. Registry array or object ordering
does not affect the result. Stable dependencies do not cross into prerelease channels; a dependency
already on a prerelease channel can advance within that channel or move to a stable release.

## `next`

Resolves to the eligible version named by the `next` dist-tag. If `next` is absent or invalid,
depfresh falls back to the eligible `latest` tag. A present `next` candidate rejected by deprecation
or cooldown filtering is not replaced after the fact by a less-restricted candidate.

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
| Exact pin with `--include-locked` -- `1.2.3` | `2.0.0` |
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

A spec that is not a valid semver range at all -- a bare unknown tag like `beta`, or a typo -- has
no provable normalized current version. depfresh skips it instead of fabricating a safe comparison
or selecting a possible downgrade. A current value that exactly matches a registry dist-tag is also
skipped because the package manager resolves it dynamically.

## Shared candidate safety

- Stable current versions reject prerelease candidates. Prerelease current versions accept only the
  same prerelease channel plus stable releases.
- Deprecated targets are rejected unless the normalized current version is itself deprecated, which
  preserves the escape path from a deprecated line.
- `--cooldown` requires valid publish-time evidence. Missing or invalid timestamps are unknown, not
  silently mature.
- Registry tags cannot bypass those filters, and a filtered candidate never re-enters as a fallback.
- All selected targets are members of the final eligible set and are greater than or equal to the
  normalized current version.

## Summary

| Mode | What it does |
|------|-------------|
| `default` | Respects the existing semver range in your manifest |
| `major` | Highest eligible version, including major jumps. Brave. |
| `minor` | Up to minor updates. The sensible middle ground. |
| `patch` | Patch updates only. Maximum conservatism. |
| `latest` | Eligible, semver-valid version named by the `latest` dist-tag. |
| `newest` | Highest eligible semantic version, regardless of dist-tags. |
| `next` | Eligible `next` dist-tag, falling back to eligible `latest` when absent or invalid. |
| `ignore` | Skip this package entirely. Out of sight, out of mind. Config file only. |
