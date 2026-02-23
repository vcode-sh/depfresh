# Documentation

You opened the docs. Voluntarily. I'm genuinely impressed -- most people just guess at flags until something works, then commit before anyone notices.

Everything I know about depfresh is in here, split into files so you can pretend you'll read more than one.

## Table of Contents

- **[CLI Reference](./cli/)** -- All CLI flags, range modes, sorting, filtering, lifecycle hooks, interactive mode, CI usage, and workspace support. The one you'll actually read.
  - [Flags](./cli/flags.md) -- every flag, organised by category
  - [Modes](./cli/modes.md) -- version resolution strategies explained
  - [Examples](./cli/examples.md) -- real-world commands, interactive mode, workspaces

- **[Configuration](./configuration/)** -- Config files, every option worth documenting, `packageMode`, `depFields`, private registries, cache settings. For people who think defaults are a personal insult.
  - [Config Files](./configuration/files.md) -- formats, private registries, cache
  - [Options Reference](./configuration/options.md) -- the exhaustive list
  - [Workspaces](./configuration/workspaces.md) -- monorepos, catalogs, scanning

- **[Programmatic API](./api/)** -- Exported functions, lifecycle callbacks, addon plugins, types, and workflow examples. For when you want to wrap depfresh in your own tooling and take credit for it. I respect the hustle.
  - [Overview](./api/overview.md) -- quick start, defaults, examples
  - [Functions](./api/functions.md) -- every exported function
  - [Types](./api/types.md) -- the type catalogue
  - [Errors](./api/errors.md) -- structured error classes

- **[Output Formats](./output-formats/)** -- Table, JSON, exit codes, and AI agent integration. Machines deserve documentation too. They're doing most of the work anyway.
  - [Table](./output-formats/table.md) -- the default, colourful output
  - [JSON](./output-formats/json.md) -- machine-readable envelope

- **[Agent Workflows](./agents/README.md)** -- quickstarts for Codex, Claude Code, and Gemini CLI with copy-paste command patterns.

- **[Integrations](./integrations/README.md)** -- GitHub Actions usage and a thin MCP wrapper reference for tool ecosystems.

- **[Compare](./compare/)** -- How depfresh stacks up. Migration guide, solved issues, receipts.

- **[Troubleshooting](./troubleshooting.md)** -- Common issues, workspace gotchas, and known limitations. The page you'll find via Google at 2 AM after everything breaks. I've been there. The kettle's already on.
