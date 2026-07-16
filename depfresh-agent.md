# depfresh automation

This historical design document has been superseded. The operational authority is the packaged
[`skills/depfresh/SKILL.md`](skills/depfresh/SKILL.md), with public workflow documentation in
[`docs/agents/README.md`](docs/agents/README.md).

Discover the installed contract with:

```bash
depfresh capabilities --json
```

Validate machine results with the versioned schemas published under `depfresh/schemas/*-v1.json`.
Only shipped CLI commands and library exports are supported. Earlier proposals for agent modes,
NDJSON, SARIF, dashboards, automatic Git operations, or automatic publication are not product
contracts.
