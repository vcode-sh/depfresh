# Capabilities Contract

`depfresh capabilities --json` describes the exact installed automation surface without inspecting
a repository, contacting a registry, or requesting side-effect authority.

The command writes one deterministic `depfresh.capabilities` schema-v1 document. Validate it with
the packaged `depfresh/schemas/capabilities-v1.json` schema or the public
`validateCapabilities()` library function.

```bash
depfresh capabilities --json > depfresh-capabilities.json
```

The document includes:

- package and schema versions;
- commands, flags, enum values, and flag relationships;
- legacy and machine-command exit semantics;
- invocation-only authority grants and config-ignored options;
- public result-schema paths and stable error reasons;
- policy/signal/apply-phase registries and supported manager boundaries;
- the exact npm artifact-verification boundary;
- official runner priority and every packaged schema, skill, recipe, and example asset.

The output is stable for one installed package version and contains no timestamp, absolute path,
credential, repository state, or environment-derived success claim. Exit `0` means the complete
descriptor was emitted. Exit `2` is fatal; capabilities never uses finding-bearing exit `1`.

Capability discovery describes what the package implements. It does not grant file, process,
install, verification, global, Git, or publishing authority.
