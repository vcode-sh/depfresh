# Documentation

You opened the docs. Voluntarily. I'm genuinely impressed -- most people just guess at flags until something works, then commit before anyone notices.

Everything I know about depfresh is in here, split into files so you can pretend you'll read more than one.

## Table of Contents

- **[CLI Reference](./cli/)** -- All CLI flags, range modes, sorting, filtering, lifecycle hooks, interactive mode, CI usage, and workspace support. The one you'll actually read.
  - [Flags](./cli/flags.md) -- every flag, organised by category
  - [Modes](./cli/modes.md) -- version resolution strategies explained
  - [Examples](./cli/examples.md) -- real-world commands, interactive mode, workspaces

- **[Configuration](./configuration/)** -- Config files, ordered occurrence policy, compatibility inputs, `depFields`, private registries, and cache settings.
  - [Config Files](./configuration/files.md) -- formats, private registries, cache
  - [Options Reference](./configuration/options.md) -- the exhaustive list
  - [Workspaces](./configuration/workspaces.md) -- monorepos, catalogs, scanning

- **[Programmatic API](./api/)** -- Exported policy/repository functions, lifecycle callbacks, addons, types, and workflow examples.
  - [Overview](./api/overview.md) -- quick start, defaults, examples
  - [Functions](./api/functions.md) -- every exported function
  - [Types](./api/types.md) -- the type catalogue
  - [Repository Model](./api/repository-model.md) -- deterministic read-only repository inspection
  - [Errors](./api/errors.md) -- structured error classes

- **[Output Formats](./output-formats/)** -- Table, JSON, exit codes, and AI agent integration. Machines deserve documentation too. They're doing most of the work anyway.
  - [Table](./output-formats/table.md) -- the default, colourful output
  - [JSON](./output-formats/json.md) -- legacy machine-readable check envelope
  - [Inspect and Plan](./output-formats/inspect-plan.md) -- versioned schemas, fingerprints, and terminal decisions

- **[Agent Workflows](./agents/README.md)** -- quickstarts for AI coding agents with copy-paste command patterns.

- **[Integrations](./integrations/README.md)** -- GitHub Actions usage and a thin MCP wrapper reference for tool ecosystems.

- **[Compare](./compare/)** -- How depfresh stacks up. Coverage matrix, migration guide, solved issues, receipts.

- **[Troubleshooting](./troubleshooting.md)** -- Common issues, workspace gotchas, and known limitations. The page you'll find via Google at 2 AM after everything breaks. I've been there. The kettle's already on.
