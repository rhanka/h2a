# Machine-local MCP central

State root and workspace are different: the state root is `H2A_ROOT` or
`~/h2a-workspace/.h2a`; the workspace is captured from each shim's cwd. A daemon
never inherits a conversation id, tmux pane, or repo cwd from its launcher.
Each attachment owns its MCP server, identity, presence, signer and wake target;
the file store is shared. The urgent implementation supports one state root.

Run and restore never install or rewrite MCP host/project configurations. Plugin
manifests still invoke `mcp-serve`. An explicit `host setup --write <file>` edits
only `mcpServers.h2a`, preserves all surrounding bytes and entries, and backs up
an existing file. Tracked files require `--allow-tracked`. Invalid/ambiguous JSON
is refused, including with `--force`; use the host's editor to repair it.

The protected rendezvous is `h2a-mcp-central/marker.json` beneath the current
private `XDG_RUNTIME_DIR`, otherwise `/run/user/<uid>`. Without a systemd runtime,
use the fixed private `/tmp/h2a-mcp-runtime-<uid>` fallback. Ownership, file type
and permissions are checked; an insecure existing path is refused. The daemon
binds an ephemeral numeric loopback port and publishes it with its credential
and generation in a `0600` marker. No credential appears in a host config.

`h2a central status` reports the authenticated generation, root and attachment
count. `h2a central stop` writes an operator inhibition and asks that generation
to stop over its authenticated endpoint; it never signals an unverified PID.
Automatic launchers honor the inhibition. Resume explicitly with
`h2a mcp-central-serve` (foreground). An idle daemon exits after 60 seconds;
orphaned HTTP sessions expire after 90 seconds without a shim lease.

A restarted daemon does not close a live shim's host stdio. The shim rereads the
private marker and reinitializes its transport with the captured conversation
and workspace. Resume must prove the existing binding; it cannot mint a new
identity. Failed/indeterminate mutations return `outcome_unknown` and are never
replayed. Readiness/status calls can be retried. Notifications use the HTTP SSE
channel; leases do not count as host MCP activity.

Set `h2a.central.enabled=false` in `~/.config/sentropic/h2a/config.json` (or the
legacy `remote-cli/config.json` until migration), or launch with
`H2A_MCP_CENTRAL=0`. New connections then use full stdio. A healthy live shim
keeps its existing attachment; it never changes transport or identity in place.
After a failure/explicit stop with central disabled, it keeps host stdio open
and returns `central_unavailable`; it does not restart a daemon or spawn a full
stdio server. Reconnect the host to apply the stdio choice.

`h2a central residues --workspace <repo> [--agy-config <file>]` inventories v1
`.mcp.json`/Gemini configurations containing `mcp-central-connect`, the agy user
config, and repo store sentinels. It reports tracked status and never writes,
reformats or deletes anything. Review backups before any manual cleanup.

L-B remains the qualification of causal Codex/agy conversation signals. L-C
remains launch-index integration from PR #313, multiple state roots, coordinated
upgrade/succession, full notification qualification and cluster-mesh per
principal. The central reuses stdio activation and its existing identity worker;
it skips per-attachment auto-upgrade. Use an explicit upgrade and allow old
daemons to exit idle. Claude `/clear`/resume must reopen the MCP attachment when
the native conversation changes: a live attachment's context is immutable.
