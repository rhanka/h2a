# H2A Compatibility Matrix

> Last update: 2026-05-22. Source of truth for host wave state: `h2a host status` (DEC-037 / DEC-049).

This matrix tracks what is shipped for each host adapter in V1. It is intentionally operational: if a cell says "shipped", there is code, a CLI surface, and test coverage behind it.

| Host | Wave | Descriptor in `h2a hosts` | MCP adapter (`mcp-serve` + in-process) | `h2a host setup` snippet | End-to-end host scenario | Notes |
| --- | ---: | --- | --- | --- | --- | --- |
| Codex | 1 | Shipped | Shipped | Shipped | Shipped | `host setup --host codex` merges `mcpServers.h2a` into Codex config; host scenario launches `mcp-serve` from the rendered snippet and drives register/open/offer/inbox over JSON-RPC (DEC-044). |
| Claude Code | 1 | Shipped | Shipped | Shipped | Shipped | `host setup --host claude` covers global and project-local MCP config paths; host scenario launches `mcp-serve` from the rendered snippet and drives register/open/offer/inbox over JSON-RPC (DEC-044). |
| Gemini | 1 | Shipped | Shipped | Shipped | Shipped | `host setup --host gemini` emits a snippet for `~/.gemini/settings.json` or project-local `.gemini/settings.json`; host scenario launches `mcp-serve` from the rendered snippet and drives register/open/offer/inbox over JSON-RPC (DEC-049). |

## Machine-Readable Status

Use the CLI when automation needs the current host matrix:

```sh
h2a host status
h2a host status --host codex
```

The stdout envelope is:

```json
{
  "ok": true,
  "hosts": [
    {
      "host": "codex",
      "wave": 1,
      "mcpAdapterShipped": true,
      "hostSetupShipped": true,
      "hostScenarioShipped": true,
      "summary": "wave 1 — host setup + MCP scenario shipped; MCP adapter (stdio + local) wired"
    }
  ]
}
```

Unknown hosts return exit code `1` with a stderr message listing supported names.

## Reading The Columns

- **Descriptor in `h2a hosts`** means `@sentropic/h2a-cli` exports a host descriptor and the CLI lists it.
- **MCP adapter** means the host can point at the same shipped local MCP server surface: JSON-RPC 2.0 over stdio and in-process handlers backed by the local-files runtime.
- **`host setup` snippet** means the CLI can render or merge a ready `mcpServers.h2a` config entry for that host.
- **End-to-end host scenario** means a host-specific automation test has driven inbox / negotiation / MCP operations through that host. Codex, Claude Code, and Gemini are all covered by `packages/h2a-cli/test/host-mcp-scenario.test.js` (DEC-044, DEC-049).
