# Machine-local MCP central

On Linux, `mcp-serve --host claude` selects the central by default when the host
provides `CLAUDE_CODE_SESSION_ID`. `H2A_MCP_CENTRAL=0` or
`h2a.central.enabled=false` selects stdio for new connections.
When auto-started via `launchCentral`, the detached central process is attached
via `busctl --user StartTransientUnit` into a generation-unique
`systemd --user` transient scope (`h2a-mcp-central-<generation>.scope`, with
`UnitExists` / `was already loaded or has a fragment file` fallback retry if an
explicit `H2A_MCP_CENTRAL_SYSTEMD_UNIT` collides) under `app.slice` with
`MemoryHigh=3G` and `MemoryMax=4G`, keeping central memory isolated from the
launching host session's cgroup scope. After `StartTransientUnit`, central scope
isolation polls `/proc/<pid>/cgroup` and sets `isolated: true` only when the
target unit appears in the process cgroup. When `systemd --user`, D-Bus user
transport, or scope verification is unavailable, central cleanly falls back with
`isolated: false` (`detached spawn in caller scope`) and logs the fallback
reason to `mcp-central.log` and stderr.
Routing happens before heavy imports. Codex,
agy, ambiguous Claude identities, explicit instance overrides, cluster-mesh,
and unsupported state roots retain full stdio. The shipped manifests are unchanged.

State root and workspace are different: the state root is `H2A_ROOT` or
`~/h2a-workspace/.h2a`; the workspace is captured from each shim's cwd. An
automatic daemon uses a neutral environment and cwd. Attachments also strip
launcher conversation, terminal and readiness fields after a manual daemon
start, before applying each client's captured environment.
Each attachment owns its MCP server, identity, presence, signer and wake target;
the file store is shared. The urgent implementation supports one state root.

Run and restore never install or rewrite MCP host/project configurations. Plugin
manifests still invoke `mcp-serve`. An explicit `host setup --write <file>` edits
only `mcpServers.h2a`, preserves all surrounding bytes and entries, and backs up
an existing file. Tracked files require `--allow-tracked`. Invalid/ambiguous JSON
is refused, including with `--force`; use the host's editor to repair it.

R6 is closed by the zero-project-write invariant and byte-preservation tests
on the exact pre-incident Graphify file (SHA-256
`4cb2e5d3186cb16665c91b69f7e93be1d9bc9eda61b5bab8a7adfcea8eb50f41`).
The historical cause remains unknown: the published 0.98.0 writer retained
Graphify in reproduction. See the [qualification report](reviews/mcp-central-default-claude.md).

The protected rendezvous is `h2a-mcp-central/marker.json` beneath the current
private `XDG_RUNTIME_DIR`, otherwise `/run/user/<uid>`. Without a systemd runtime,
use the fixed private `/tmp/h2a-mcp-runtime-<uid>` fallback. Ownership, file type
and permissions are checked; an insecure existing path is refused. The daemon
binds an ephemeral numeric loopback port and publishes it with its credential
and generation in a `0600` marker. No credential appears in a host config.

`h2a central status` reports the authenticated generation, root, attachment
count, and `ledgerMigrationComplete`. Unauthenticated loopback
`GET /_h2a-central/health` exposes `{ ok, generation, state, pid, ledgerMigrationComplete }`
immediately on listen (no secrets), and `initialize` is admitted before
background migration completes. `h2a central stop` writes an operator inhibition
and asks that generation to stop over its authenticated endpoint; it never
signals an unverified PID. Automatic launchers honor the inhibition. Resume
explicitly with `h2a mcp-central-serve` (foreground). An idle daemon exits after
60 seconds (once `ledgerMigrationComplete` is `true` and drain is complete);
orphaned HTTP sessions expire after 90 seconds without a shim lease.

Election combines `/proc/<pid>/stat` identity (`ownerLiveness`) with bounded
loopback `centralMcpPing` probes (`3 × 800 ms`, `150 ms` backoff, `5 s` startup
grace). Eviction of an unresponsive owner runs exclusively under
`acquirePreclaim` (`evictUnresponsiveOwnerLocked`), enforces O(1) active
transaction and writer-gate guards without reading `operation-*.json`, verifies
`processIdentity.pid` and `startTime`, escalates `SIGTERM` (`1 s`) → `SIGKILL`
(`500 ms`), and lets the successor settle orphaned prior-generation `pending`
operations to `unknown` (`execution_owner_dead`) on `drain()` once
`ledgerMigrationComplete` is `true`. On a stalled initial handshake (`1.5 s`),
the shim verifies `/_h2a-central/ping` (`500 ms`) and triggers `ensure()`
outside active `live-transfer` `PUBLISHED`/`RETIRED` states.

For always-on local operation, use `h2a mcp-central-serve --supervised` with the
official user unit `contrib/systemd/h2a-mcp-central.service` (`Restart=on-failure`,
`RestartPreventExitStatus=2 3`, `TimeoutStopSec=15`, `MemoryMax=512M`,
`EnvironmentFile=-%h/.config/sentropic/h2a/central.env`). Supervised mode disables
idle auto-exit (`idleTimeoutMs = 0`), resolves the default root via
`canonicalCentralRoot(env)`, passively monitors an existing healthy daemon in
`STANDBY` (0 restart loops), runs an independent `node:worker_threads` watchdog
probing `/_h2a-central/ping` in `SERVING`, and maps exits to `0` (normal/paused),
`1` (transient/watchdog), `2` (config/qualification), and `3` (disk/permissions).
Prefix trust (`handover/upg-trust.js`) accepts `0775` owned by an exclusive User
Private Group (UPG) while rejecting shared groups and world-writable modes (`0777`).

Handover state in `<stateDirectory>` is indexed in memory and synchronized in
O(1) via `participant-revision.json` and per-file stamps (`dev:ino:size:mtimeNs:ctimeNs`),
with bounded root retention per family:
- `operation-*.json`: `pending` and `unknown` are never archived; completed
  operations from previous generations (outside an active transaction) are
  archived; current-generation completed operations are FIFO-bounded to `64`
  (excluding `FROZEN`/`TRANSFERRING` attachments).
- `effect-*.json`: archived once their operation is terminal and their
  attachment is absent, `CLOSED`, or owned by a dead generation; active
  attachments keep 100% of `launch-delegation` effects and up to `256` recent
  `call`/`callback` effects.
- `generation-end-*.json`: retains the `64` most recent plus all generations
  referenced by non-`CLOSED` ownerships; archived proofs resolve in O(1) via
  `archivedGenerationEnds`.
- `ownership-*.json` (`CLOSED` without active operations), `launch-*.json` +
  `launch-location-*.json` (`completed`), `wake-*.json` (`delivered`/`deferred`),
  and unreferenced `checkpoint-*.json`: bounded to `64` terminal entries at root.

Archival moves files reversibly (never deleting) into
`<stateDirectory>/archive/batch-<YYYYMMDD>/` with an append-only
`archive/manifest.jsonl`, scanning candidates outside the lock and committing
in sub-lots of at most `32` files under `<canonicalRoot>/.h2a-writer-control/.mutation.lock`
with `(dev, ino)` revalidation, directory + manifest `fsync`, and a
`participant-revision.json` bump. When root contains more than `128` JSON files
at startup, historical migration runs asynchronously in `<= 8 ms` slices while
`ledgerMigrationComplete` transitions from `false` to `true`.

`h2a central compact [--root <path>] [--runtime-base <dir>] [--dry-run] [--restore] [--json]`
invokes the same locked compaction/restoration protocol locally without HTTP.
`--dry-run` reports eligible counts without modifying disk. `--restore` refuses
with exit code `2` (`central_running_or_liveness_unknown`) unless central owner
liveness is proven `dead`, restores files in sub-lots of at most `32`, skips
identical root files, and never overwrites divergent root files (exiting `2`
with `conflictCount > 0` and `conflicts`).

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
remains large-volume qualification of the existing launch-index, multiple state roots, coordinated
upgrade/succession, full notification qualification and cluster-mesh per
principal. The central reuses stdio activation and its existing identity worker;
it skips per-attachment auto-upgrade. Use an explicit upgrade and allow old
daemons to exit idle. Claude `/clear`/resume must reopen the MCP attachment when
the native conversation changes: a live attachment's context is immutable.
