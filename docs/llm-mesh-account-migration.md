# LLM account migration

H2A 0.94 removes its legacy local account pool. Provider credentials and
account selection now belong exclusively to Sentropic llm-mesh.

Enroll the two currently supported account types through the unified CLI:

```sh
h2a llm-mesh account enroll codex
h2a llm-mesh account enroll cloud-code
```

Inspect the public account inventory, or remove an enrollment, through the
same namespace:

```sh
h2a llm-mesh account list
h2a llm-mesh account list --json
h2a llm-mesh account remove <account-id>
```

`ls` aliases `list`; `rm` and `unenroll` alias `remove`. Inventory output is
limited to public metadata owned by the local llm-mesh scope. Removal never
prints or accepts a credential.

The former `h2a account ...` namespace, the flat
`h2a llm-mesh enroll ...` spelling, `h2a account push-cluster`, and the
`--account` job option no longer exist.

`h2a run codex --no-gw` and `h2a run claude --no-gw` use the native CLI
authentication path. H2A does not select a pooled account or synthesize
`OPENAI_API_KEY`/`CLAUDE_CONFIG_DIR`. A user-owned Claude API key remains
available to the native Claude process. With `--gw`, H2A uses only the opaque
llm-mesh gateway token and fails without starting an agent if that required
gateway is unavailable.

Existing files under `~/.sentropic/` from the removed pool are not read or
deleted. `h2a doctor` reports their paths by existence only. Back them up,
verify the new enrollments, then remove them manually if no rollback is needed.

## Migration to 0.98.1

The local gateway engine is composed through cluster-mesh 0.13.0, using
llm-gateway 0.19.1 and llm-mesh 0.22.3. H2A retains its local bearer registry
and session ledger until convergence with Sentropic workspace/session notions
(owner decision 2026-10-03). Enrollment, credentials, routing, provider
transports and affinity remain upstream. There is no general reenrollment.

1. Record the public account inventory (`h2a llm-mesh account list --json`),
   owner scope, routing preferences and active daemon version. Back up only
   the public `~/.sentropic/llm-mesh.json` configuration.
2. Install the qualified h2a/runtime tuple together. Verify that cluster-mesh,
   llm-mesh and llm-gateway each have one physical copy in the installed tree,
   and that cluster-mesh's topology check and public subpaths resolve from
   the runtime's actual location.
3. During an explicit transition, stop the identified h2a-managed daemon and
   await its process exit and port release. Start the new composition with
   `h2a llm-mesh start`, or use `h2a llm-mesh restart`. A live PID and `/health`
   alone do not qualify the new composition: the launcher waits on `/readyz`.
   `/health` is an explicitly labelled compatibility fallback only when an
   older daemon has no `/readyz` endpoint (404).
4. Keep native sessions running. Restart only sessions explicitly selected
   to acquire a new process-local bearer; restarting the daemon does not
   restart tmux or Claude sessions. Never persist or restore a bearer.
5. Compare the public inventory, owner scope, preferences and HTTP/status
   behavior before and after the transition. `/v1/sessions` also lists idle
   minted sessions without a selected account; detailed status remains absent
   until a route has been planned.

Public paths and variables stay compatible: `port` (default 3002), `logFile`
and `routing` in `llm-mesh.json`; `H2A_LLM_MESH_OWNER_SCOPE` (default
`cli:<hostname>`), `H2A_LLM_MESH_CONFIG_JSON`, `H2A_LLM_MESH_CONFIG_REF`
(default `default`), `H2A_LLM_MESH_ROUTING_JSON` and `PORT`. PID/log filenames
and `llm-mesh-token.json` discovery remain supported. New metadata contains
only the base URL and PID. H2A neither copies credentials nor changes keyrings.

New CLI/MCP launches are direct by default. Claude `--gw` / MCP
`gateway: "required"` require a ready gateway and fail before launching an
agent if unavailable. MCP `gateway: "auto"` and `"off"` resolve direct;
Codex, AGY and Muse reject `"required"`. Existing restore/delegate behavior
and explicitly pinned resume/restart choices are preserved.

Policy and explicit constraints are read from public config per request.
Profile definitions and the equivalence council are constructed at startup:
restart the daemon after changing them. Legacy `OPENAI_MODEL_MAP` does not
configure the current routing engine.

## Rollback to 0.98.0

Stop the identified 0.98.1 daemon and await exit before reinstalling h2a and
h2a-runtime 0.98.0 together with their previously qualified provider tuple.
Start the 0.98.0 daemon explicitly. Restore public preferences only if their
format changed; do not replace keyrings or restore an expired bearer. Relaunch
only the selected native sessions that need to acquire a fresh bearer, then
compare the same public inventory and configuration recorded before migration.

## Claude seat accounts (unreleased — enrollment only)

Claude subscription accounts are supported as owner-scoped `llm-mesh` seats.

### Enrollment and credential import

Enrollment is available through two canonical CLI paths:

1. **Browser OAuth flow (canonical default):**
   ```sh
   h2a llm-mesh account enroll claude-code
   ```
   Opens the Claude authorization URL in the local browser. The returned `<code>#<state>` string is entered via a trusted masked local terminal prompt that disables echo. Set `H2A_NO_BROWSER=1` to skip the browser opener entirely (no authorization URL in process arguments) and complete the flow at the prompt.

2. **Renewable credential import:**
   ```sh
   h2a llm-mesh account enroll claude-code --credential-import
   ```
   Accepts a renewable credential JSON document containing `claudeAiOauth` via a trusted masked multiline prompt. No secret value argument is accepted on argv.

Both paths persist credentials exclusively through the existing mesh-managed encrypted file keyring. No tokens or secrets are stored in h2a configurations or process arguments.

### Secret boundary and owner isolation

- Interactive terminal (TTY) is required for credential entry; non-interactive captures fail closed.
- The owner scope is bound to trusted host identity (`H2A_LLM_MESH_OWNER_SCOPE`, defaulting to `cli:<hostname>`). Foreign owners cannot inspect, acquire or remove the account.
- The running gateway loads accounts at boot time only. After enrollment or import, restart the local gateway:
  ```sh
  h2a llm-mesh restart
  ```

### Status and limitations

Current operational status: **enrollment only / execution not-covered** until independent qualification stages (M0–M7) are completed by the host owner.

- **Pre-acquire lease integration gate (Section 3A):** llm-mesh 0.25.0 constructs its account directory internally without an outer pre-acquire lease seam. Seat gateway serving remains halted until an additive seam is delivered in mesh.
- **One-message capability scope:** The initial qualified serving outcome covers one user text message and streamed response through the official pinned CLI (`protocol: 'claude-code-stream-json-v1'`).
- **Zero child refresh & network boundary:** the projected credential carries access material only (no refresh token); a child that fails with an inference error is never retried and never refreshed by the runner — rotation stays a mesh-side parent operation.
- **Seat spawn preconditions (fail closed):** no spawn unless the runner itself observes an isolated Linux network namespace (`/proc/self/ns/net` != `/proc/1/ns/net`, owner-established via `unshare -n` / `ip netns exec` before launching h2a) plus the out-of-band `H2A_CLAUDE_EGRESS_ENFORCED=1` switch; after spawn the child's namespace (`/proc/<pid>/ns/net`) must equal the runner-observed one or the child is killed before any streaming. Non-Linux refuses. No caller callback, path, proxy variable, or test mechanism is trusted (no such path exists in shipped code). The pinned CLI fingerprint and digest-pinned probe qualification (version string alone never qualifies) are mandatory; spawn is refused while admin managed-settings exist (managed files including conservative unverified macOS plist candidates; Windows `HKLM`+`HKCU\SOFTWARE\Policies\ClaudeCode` including WSL, fail-closed on unreadable source). Organization proof is `blocked_pending_mesh_seam` (mesh 0.25.0 projects only accessToken/expiresAt/scopes). The runner inherits no parent `PATH` (fixed minimal value scoped to the binary directory).
- **History and tools:** Multi-turn history and caller tools remain unproven and `not-covered`. Requests with tools are refused at spawn until client-side tool transport (local MCP qualification) and end-to-end proofs are delivered; caller-provided tool names are never passed to `--tools` and built-in CLI tool names are rejected. The runner passes `--permission-mode dontAsk` (never `--dangerously-skip-permissions`).
