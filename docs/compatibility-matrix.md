# H2A Compatibility Matrix

> Last update: 2026-07-09. Source of truth for host wave state: `h2a host status` (DEC-037 / DEC-049). For the deeper skill/plugin integration matrix (native skill install, stop-hook/plugin scaffold, live-E2E gaps), see [`host-integration-matrix.md`](./host-integration-matrix.md).

This matrix tracks what is shipped for each host adapter in V1. It is intentionally operational: if a cell says "shipped", there is code, a CLI surface, and test coverage behind it.

| Host | Wave | Descriptor in `h2a hosts` | MCP adapter (`mcp-serve` + in-process) | `h2a host setup` snippet | End-to-end host scenario | Notes |
| --- | ---: | --- | --- | --- | --- | --- |
| Codex | 1 | Shipped | Shipped | JSON snippet / JSON merge | Shipped | `host setup --host codex --endpoint local|remote` replaces h2a aliases and standalone Track entries in the JSON shape; local host scenario drives register/open/offer/inbox over JSON-RPC (DEC-044). |
| Claude Code | 1 | Shipped | Shipped | JSON snippet / JSON merge | Shipped | `host setup --host claude` covers global and project-local MCP config paths; it selects one local stdio or remote URL endpoint. Local host scenario drives register/open/offer/inbox over JSON-RPC (DEC-044). |
| Gemini | 1 | Shipped | Shipped | JSON snippet / JSON merge | Shipped | `host setup --host gemini` emits a singleton snippet for `~/.gemini/settings.json` or project-local `.gemini/settings.json`; local host scenario drives register/open/offer/inbox over JSON-RPC (DEC-049). |
| agy (Antigravity) | 1 | Shipped | Shipped | JSON snippet / JSON merge | Shipped | `host setup --host agy` targets the embedded-runtime MCP slot `~/.gemini/config/mcp_config.json` and selects one endpoint; native lifecycle is poll-only (no push daemon). |
| Hermes | 1 | Shipped | Shipped | JSON snippet only for native YAML | Shipped | `host setup --host hermes` renders one local stdio or remote URL entry but refuses `--write` to YAML; live Hermes hook/plugin E2E still awaits a real binary. |
| OpenCode | 1 | Shipped | Shipped | JSON snippet / JSON merge; JSONC print-only | Shipped | `host setup --host opencode` renders one local stdio or remote URL entry but refuses JSONC writes; live OpenCode binary/plugin E2E still awaits a real binary. |

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
- **MCP adapter** means the host can point at the shipped local MCP server surface: JSON-RPC 2.0 over stdio and in-process handlers backed by the local-files runtime. Remote URL rendering is config-level coverage; it is not a hosted endpoint E2E.
- **`host setup` snippet** means the CLI can render one ready `mcpServers.h2a` config entry. Its generic `--write` reconciler operates on JSON only: it does not edit Codex TOML, Hermes YAML, or OpenCode JSONC native files. It removes recognized h2a aliases and standalone Track entries from the JSON shape it is given.
- **Package-plugin boundary**: the packaged Claude/Codex plugin manifests bootstrap one fixed local h2a endpoint. They are not dynamically rewritten by `host setup`; disable that local plugin entry before configuring a remote endpoint, or the host itself can still load two sources.
- **End-to-end host scenario** means a host-specific automation test has driven inbox / negotiation / MCP operations through that host. All six hosts (Codex, Claude Code, Gemini, agy, Hermes, OpenCode) are covered by `packages/h2a/test/host-mcp-scenario.test.js` (DEC-044, DEC-049). Live-binary hook/plugin E2E for Hermes and OpenCode is tracked separately in `host-integration-matrix.md`.

## Runtime host bridge: `@sentropic/remote` (DEC-059 / DEC-063)

Beyond the CLI hosts above, h2a defines a **host bridge contract** for runtimes that embed `h2a mcp-serve` as a Kubernetes sidecar (DEC-058). The first such runtime is `@sentropic/remote` (repo `rhanka/remote`).

| Runtime | Bridge profile | h2a side | Host side | Status |
| --- | --- | --- | --- | --- |
| `@sentropic/remote` | `H2A_HOST_BRIDGE_PROFILES["remote"]` (5 clauses: identity, lifecycle, resource-limits, disclosure, auth-boundary) | shipped (DEC-059, key `remote` since DEC-063) | adopted — JSON Schema merged in `rhanka/remote` (`packages/protocol`, PR `rhanka/remote#2`) | **bilateral, live both sides** |

The contract is symmetric: h2a publishes `hostId: "remote"`, `instanceTemplate: "remote:${SESSION_ID}"`, and `@sentropic/remote` validates the same shape at session creation. Any future change to the bridge requires paired PRs in both repos (DEC-059). Deployment scenarios B/C (cluster-wide tenant, network broker) remain deferred — see [`instruction-k8s-and-remote-interop.md`](./instruction-k8s-and-remote-interop.md).
