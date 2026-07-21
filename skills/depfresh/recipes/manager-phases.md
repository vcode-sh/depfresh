# Manager phases

`plan` records exact manager, version, lockfile, fixed lifecycle-disabled argv, allowed paths, and
required capabilities. Review those fields before granting a phase.

- `--sync-lockfile`: may execute the confirmed manager and write only the selected lockfile.
- `--install`: may also change contained dependency install state. It conflicts with
  `--sync-lockfile`.
- Plan with `--verify-argv '["command","arg"]'`; after review, apply that exact plan with
  `--verify`. Each flag is rejected on the other command.
- `--verify-artifacts`: requires `--install`; it verifies exact installed npm artifacts from the
  planned lockfile and registry evidence.

Supported manager/version/lockfile combinations are discoverable from
`depfresh capabilities --json`. Unsupported, ambiguous, malformed, unavailable, or changed evidence
blocks execution. Process phases never run lifecycle scripts.

Exact artifact verification is narrower than install support: capabilities advertise npm
`>=11.12.0 <12.0.0 || >=12.0.0 <12.1.0`, the public `https://registry.npmjs.org/`, and exact
SHA-512 integrity evidence. Other managers, npm versions, registries, or missing integrity block
that phase before apply.

Global updates are a separate observed workflow. `--global-all` inspects npm, pnpm, and Bun;
`--global-all --write` requires explicit global write/process authority and reports each manager
independently. Re-observe inventory after apply. Global results are not a cross-manager transaction.
