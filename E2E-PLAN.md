# PR #231 — live cross-CLI E2E plan

This plan exercises the built checkout with one real Claude Code process and
one real Codex process. It is intentionally **not** part of the automated test
suite: it consumes live model access, needs an enrolled local llm-mesh account
for the gateway checks, and cannot run in the headless CI environment used for
this change.

The executable harness is
[`scripts/e2e-live-native-restart.sh`](scripts/e2e-live-native-restart.sh). It
does not copy auth files, generate keys, print tokens, or write credential
values. The only process-environment observation is the boolean presence of
the non-secret `ANTHROPIC_BASE_URL` key. Do not add `set -x` when running it.

## Preconditions

Use a trusted machine with:

- authenticated, runnable `claude` and `codex` binaries;
- a working llm-mesh enrollment for Claude (`--gw` is fail-closed if none is
  available);
- `node` and `curl`;
- no other live central h2a MCP singleton for the same UID, unless it has been
  stopped first;
- the PR checkout built from a clean install.

Run these exact preflight commands from the PR worktree:

```bash
npm ci
npm run build
command -v claude
command -v codex
```

Do not export an auth token and do not copy `~/.claude`, `~/.codex`, or
`~/.sentropic`. The harness launches the already-authenticated host binaries
in a throwaway workspace and gives both an ephemeral MCP configuration through
argv; the configuration contains only the local endpoint.

## Exact launch

The run is live and billable, so it requires an explicit acknowledgement:

```bash
H2A_LIVE_E2E=1 \
H2A_E2E_PORT=37651 \
H2A_E2E_TIMEOUT_SECONDS=240 \
./scripts/e2e-live-native-restart.sh
```

To retain evidence at a chosen location or use another empty trusted
workspace:

```bash
H2A_LIVE_E2E=1 \
H2A_E2E_RUN_DIR=/tmp/h2a-pr231-live-manual \
H2A_E2E_WORKSPACE=/tmp/h2a-pr231-live-manual/workspace \
H2A_E2E_PORT=37651 \
./scripts/e2e-live-native-restart.sh
```

The script prepends three symlinks to `PATH`: `h2a` runs this checkout's built
`packages/h2a/dist/bin.js`; `claude` adds `--mcp-config ...
--strict-mcp-config`; and `codex` adds the equivalent
`mcp_servers.h2a.command/args` TOML overrides. Both clients therefore connect
to exactly this one sidecar:

```bash
H2A_MCP_CENTRAL=1 \
H2A_MCP_CENTRAL_ENDPOINT=http://127.0.0.1:37651/mcp \
h2a mcp-central-serve --root /tmp/h2a-pr231-live-manual/bus
```

The harness then issues these public session operations (the prompts themselves
are piped on stdin and never enter process argv):

```bash
h2a run codex  /tmp/h2a-pr231-live-manual/workspace --name e2e-codex  --no-attach --background --prompt-stdin --no-gw --json
h2a run claude /tmp/h2a-pr231-live-manual/workspace --name e2e-claude --no-attach --background --prompt-stdin --gw    --json
h2a restart e2e-codex  --relaunch-mcp h2a --json
h2a restart e2e-claude --gw off --json
h2a restart e2e-claude --gw on  --json
```

The full script supplies the two exact MCP briefs and owns cleanup; running the
five lines alone is not a substitute for the harness.

## Measurements and PASS criteria

### 1. Two real CLIs and one MCP

Measurement:

- `codex-launch.json` and `claude-launch.json` must each be an
  `h2a.run.result` with `ok:true`, host `native`, and distinct session names;
- `central-ping-before.json` and `central-ping-after.json` must contain the same
  generation;
- the PID started for `mcp-central-serve` must remain live for the whole run;
- both agents must successfully invoke `h2a_session_open` through their MCP
  client, producing `codex-ready.pass` and `claude-sent.pass`.

PASS means two real host processes used the same surviving central server
generation. A configured endpoint or a live process by itself is not proof
that either model called a tool.

### 2. Wake and agent-to-agent message

Claude sends envelope `env:e2e-pr231-claude-ping` to
`codex:e2e-pr231`. Codex is otherwise idle; its central MCP inbox notification
must wake it, after which it reads the envelope and sends
`env:e2e-pr231-codex-reply`. Claude reads that reply and checks
`body.inReplyTo`.

Measurement files:

- `.e2e-evidence/claude-sent.pass` — the ping tool call completed;
- `.e2e-evidence/codex-reply.pass` — Codex woke, read, and replied;
- `.e2e-evidence/claude-roundtrip.pass` — Claude observed the correlated reply.

PASS requires all three non-empty files before the timeout. Inbox files alone
are delivery evidence, not evidence that the receiving model woke and acted.

### 3. Live MCP injection / relaunch

Before injection, the harness records
`codex-state-before-injection.json`. It then runs:

```bash
h2a restart e2e-codex --relaunch-mcp h2a --json
```

The injected instruction requires Codex to call `h2a_discover_sessions` and
write `.e2e-evidence/codex-mcp-relaunch.pass`. The harness records
`codex-state-after-injection.json`.

PASS requires:

- `codex-mcp-injection.json` says `requested:"inject"`,
  `instructionSubmitted:true`, and `restarted:false`;
- the before/after native `incarnation` is identical;
- the agent's verification file exists after a real h2a MCP tool call.

`instructionSubmitted:true` alone is intentionally not called MCP health.

### 4. Restart with gateway posture change

Claude starts with `--gw`. The harness records its native PID/incarnation and
checks only whether `ANTHROPIC_BASE_URL` is present, never its value. It then
runs `restart --gw off`, repeats the measurement, and finally runs
`restart --gw on` and measures again.

PASS requires:

- each restart JSON row is `completed`, `restarted:true`, with respectively
  `gatewayMode:"direct"` and `gatewayMode:"gateway"`;
- each restart yields a new native `incarnation` and PID;
- `ANTHROPIC_BASE_URL` is present before, absent after `--gw off`, and present
  after `--gw on`;
- the central MCP generation remains unchanged.

A changed registry pin without a changed process incarnation and measured
environment posture is not sufficient.

## Evidence and cleanup

On PASS the script prints the evidence directory, by default
`/tmp/h2a-pr231-live-<UTC timestamp>`. It preserves JSON results, native state
snapshots, central generation pings, and the agent-written PASS files. Stderr
is split per operation for diagnosis. No file should contain a credential.

The EXIT trap stops only `e2e-claude`, `e2e-codex`, and the exact central PID
started by the harness. It never calls `restart --all`, kills by pattern, or
touches another checkout. If interrupted before the trap completes, clean up
with the same isolated configuration home:

```bash
REMOTE_CLI_CONFIG_HOME=/tmp/h2a-pr231-live-manual/config-home h2a stop e2e-claude --reason live-e2e-cleanup
REMOTE_CLI_CONFIG_HOME=/tmp/h2a-pr231-live-manual/config-home h2a stop e2e-codex  --reason live-e2e-cleanup
```

This plan was prepared only; it was not executed in the headless consolidation
environment.
