# H2A Compatibility Matrix

> Last update: 2026-05-20. Source of truth for host wave state: `h2a host status` (DEC-037).

This matrix tracks what is shipped for each host adapter in V1. It is intentionally operational: if a cell says "shipped", there is code, a CLI surface, and test coverage behind it. If a cell says "deferred", the descriptor may exist but the user-facing integration is not yet committed as supported.

| Host | Wave | Descriptor in `h2a hosts` | MCP adapter (`mcp-serve` + in-process) | `h2a host setup` snippet | End-to-end host scenario | Notes |
| --- | ---: | --- | --- | --- | --- | --- |
| Codex | 1 | Shipped | Shipped | Shipped | TODO | `host setup --host codex` merges `mcpServers.h2a` into Codex config; Codex-driven inbox/negotiation scenario still pending. |
| Claude Code | 1 | Shipped | Shipped | Shipped | TODO | `host setup --host claude` covers global and project-local MCP config paths; Claude-driven inbox/negotiation scenario still pending. |
| Gemini | 2 | Shipped | Shipped | Deferred | Deferred | Descriptor is visible for planning, but Gemini setup and end-to-end enablement stay wave 2 (DEC-028). |

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
      "summary": "wave 1 — host setup snippet shipped; MCP adapter (stdio + local) wired"
    }
  ]
}
```

Unknown hosts return exit code `1` with a stderr message listing supported names.

## Reading The Columns

- **Descriptor in `h2a hosts`** means `@sentropic/h2a-cli` exports a host descriptor and the CLI lists it.
- **MCP adapter** means the host can point at the same shipped local MCP server surface: JSON-RPC 2.0 over stdio and in-process handlers backed by the local-files runtime.
- **`host setup` snippet** means the CLI can render or merge a ready `mcpServers.h2a` config entry for that host.
- **End-to-end host scenario** means a host-specific automation test has driven inbox / negotiation / MCP operations through that host. This is still pending for Codex and Claude despite the setup snippets being shipped.
