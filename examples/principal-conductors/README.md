# Example — 1 PRINCIPAL / 15 CONDUCTORS

> This example is the **executable definition** of the target use case
> documented in [`PLAN.md`](../../PLAN.md) (WP-50 / WP-60). It runs the full
> `h2a` stack end-to-end, in memory and on disk, against the public APIs of the
> two published packages.

## Topology

- **1 PRINCIPAL**: `human:antoine`
- **15 CONDUCTORS**: `conductor:01` … `conductor:15`, all attached to the
  scope `scope:principal/antoine` and negotiating on `scope:engagement/ship-v1`.

Each instance has its own `ed25519` key pair (PEM PKCS8 for the private key,
SPKI for the public key registered in the registry).

## Scenario played

The `run.mjs` script:

1. Initialises an ephemeral `local-files` store under `<tmp>/h2a-pc-*/.h2a`.
2. Generates **16 key pairs** `ed25519` (1 PRINCIPAL + 15 CONDUCTORS).
3. Registers the 16 instances via `createLocalStore(...).registerInstance(...)`
   (library API, not the CLI binary).
4. Opens the negotiation `nego-charter` with
   `requiredSigners = ["conductor:01", "conductor:02", "conductor:03"]`
   (quorum 3 of 15).
5. `conductor:01` emits an `offer` (artifact `ENGAGEMENT`
   `engagement:ship-v1`).
6. `conductor:02` and `conductor:03` each emit a `counter` carrying the final
   artifact; the three then sign that same artifact via
   `signCanonical({ artifactHash }, { by, privateKeyPem })`.
7. Stabilises the negotiation via `stabilizeNegotiation` (ed25519 verification
   against the registry `publicKeys` + quorum check) and prints the resulting
   record together with the winning `artifactHash`.
8. Starts the MCP server (`node packages/h2a-cli/dist/bin.js mcp-serve --root <tempRoot>`)
   as a child process, sends an `initialize`, a `tools/list`, then a
   `tools/call` `h2a_discover_instances({ role: "CONDUCTOR" })` and prints the
   list returned by the server (the 15 conductors).
9. Cleans up all temporary directories.

The script exits `0` on full success and prints a green summary line.

## Prerequisites

- Node.js ≥ 20.
- A **built** workspace: the MCP server is started as a child process and
  needs `packages/h2a-cli/dist/bin.js`. Run `npm test` or
  `npm --workspaces run build` at least once before launching the example.
- No external dependencies: everything relies on the `node:*` modules and on
  the two workspace packages `@sentropic/h2a` and `@sentropic/h2a-cli`.

## Launching

From the repository root:

```bash
# Portable variant (build + run)
./examples/principal-conductors/run.sh

# Or directly, if `dist/` is already up to date
node examples/principal-conductors/run.mjs
```

## Expected output (excerpt)

```
1. Bootstrap local-files store
  root                   /tmp/h2a-pc-XXXXXX/.h2a

...

7. Stabilize the negotiation (quorum check + ed25519 verify)
  status                 stabilized
  winning artifactHash   sha256:9e388a51...
  signers                conductor:01, conductor:02, conductor:03

8. Probe the MCP server (JSON-RPC 2.0 over stdio)
  server                 @sentropic/h2a-cli@0.1.1
  tools/list             10 tools
  MCP returned           15 conductors

[OK] stabilized engagement:ship-v1 / quorum 3 of 15 conductors / 15 conductors discovered via MCP
```

## Wiring into Codex / Claude Code

Once `@sentropic/h2a-cli` is installed (the `h2a` binary must be resolvable via
`PATH`), a single command emits the MCP snippet to paste into the host config.
The `host setup` verb never writes anywhere other than the target passed
explicitly to `--write`; without `--write` it just prints the JSON on `stdout`
and the path hint on `stderr`.

### Codex CLI

```bash
h2a host setup --host codex --print
# {
#   "mcpServers": {
#     "h2a": {
#       "command": "h2a",
#       "args": ["mcp-serve"]
#     }
#   }
# }
# # codex — paste this snippet under `mcpServers` in:
# # Codex CLI reads its MCP config from either ~/.codex/config.json (legacy)
# # or ~/.config/codex/mcp.json (XDG). Merge the snippet under the top-level
# # `mcpServers` key in whichever file your Codex CLI uses.
# # example path: ~/.config/codex/mcp.json
```

To apply it directly (with a non-destructive merge of any other MCP servers
already present):

```bash
h2a host setup --host codex --write ~/.config/codex/mcp.json
# add --root /path/to/project/.h2a to pin the server's local store,
# --force to overwrite a divergent mcpServers.h2a already present.
```

### Claude Code

```bash
h2a host setup --host claude --print
# {
#   "mcpServers": {
#     "h2a": {
#       "command": "h2a",
#       "args": ["mcp-serve"]
#     }
#   }
# }
# # claude — paste this snippet under `mcpServers` in:
# # Claude Code reads its MCP config from either ~/.config/claude/mcp.json
# # (user-global) or a workspace-local .mcp.json at the root.
```

Equivalent variants:

```bash
# User-global config
h2a host setup --host claude --write ~/.config/claude/mcp.json

# Project config, pinned to a local .h2a store
h2a host setup --host claude --root "$PWD/.h2a" --write "$PWD/.mcp.json"
```

> Gemini is deliberately refused (`DEC-028` — wave 2). The descriptor stays
> visible via `h2a hosts`.

## Why this example?

It serves as **living documentation** and a **smoke test** for the three layers
of the runtime:

- the **artifacts / signatures** layer of `@sentropic/h2a`
  (`computeHash`, `signCanonical`, journal `prevHash`, quorum);
- the **local-files** runtime of `@sentropic/h2a-cli`
  (`createLocalStore`, opening / journal / stabilisation);
- the **MCP** layer (`runMcpStdio`) accessed the way an external client would
  via JSON-RPC 2.0 over stdio.

The integration test
[`packages/h2a-cli/test/integration-example.test.js`](../../packages/h2a-cli/test/integration-example.test.js)
re-runs the script when `H2A_RUN_EXAMPLE=1` is set (skipped by default to keep
the default suite fast).
