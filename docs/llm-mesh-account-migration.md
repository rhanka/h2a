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

## Claude seat accounts (common seat model — DEC-118)

Claude subscription accounts are supported as owner-scoped `llm-mesh` seats.

### Enrollment and credential import

Enrollment is available through three modes (owner decision 2026-10-13, DEC-119): OAuth by default, `--cli` (official CLI store), `--token` (secret-manager credential). The canonical selector is `--from oauth|cli|token` (default `oauth`); `--cli` / `--token` booleans are the same modes and cannot be combined with `--from`.

1. **Browser OAuth flow (default):**
   ```sh
   h2a llm-mesh account enroll claude-code
   h2a llm-mesh account enroll claude-code --from oauth
   ```
   Opens the Claude authorization URL in the local browser. The returned `<code>#<state>` string is entered via a trusted masked local terminal prompt that disables echo. Set `H2A_NO_BROWSER=1` to skip the browser opener entirely (no authorization URL in process arguments) and complete the flow at the prompt.

2. **Official CLI-store import (`--from cli`):**
   ```sh
   h2a llm-mesh account enroll claude-code --from cli
   ```
   Reads the already-logged-in official CLI store (`~/.claude/.credentials.json`, which must hold a renewable grant with access + refresh tokens) once into the credential-import leg — no browser, no prompt. Fails closed with a static error when the store is absent or holds no renewable credential.
   Platform scope: only that Linux file path is read. Where the official CLI keeps credentials outside that file (for example the macOS keychain, unverified here), `--from cli` fails closed — re-authenticate the official CLI or enroll with OAuth instead. Linux first; macOS, then Windows (owner N×N rule) — live-provider proof remains owner-run, currently unverified on all OS.
   Lifecycle (differs from `enroll muse --cli`, mesh 0.25.0): muse lets the mesh re-read its CLI store at each refresh, so the official CLI stays the sole writer. The mesh ships no such store leg for Claude, so this import is a point-in-time COPY: the mesh never writes the official store file, but its copy refreshes independently through the token endpoint afterwards. If the provider rotates the refresh grant, the side that refreshes second loses it — re-run `--from cli` (re-authenticate the official CLI first when its own copy lapsed). A mesh-side Claude store leg is a recorded follow-up.

3. **Secret-manager token import (`--from token`):**
   ```sh
   h2a llm-mesh account enroll claude-code --from token
   secret-manager read ... | h2a llm-mesh account enroll claude-code --from token
   ```
   Accepts a renewable credential JSON document containing `claudeAiOauth` (or the inner grant). Interactive shells get the trusted masked multiline prompt; piped stdin (non-TTY) is read as the secret-manager output — the shape the future shared re-enrollment circuit will use. No secret value argument is accepted on argv, and nothing secret is ever logged.

All paths persist credentials exclusively through the existing mesh-managed encrypted file keyring. No tokens or secrets are stored in h2a configurations or process arguments. Muse keeps its own `--from cli` (mesh CLI-store leg, CLI-owned refresh); `--from token` is refused for every provider except `claude-code` (gap recorded — other seats are not changed here).

### Secret boundary and owner isolation

- Masked TTY prompts cover OAuth and interactive `--from token` entry; nothing secret travels in argv and nothing secret is logged. `--from token` with piped stdin (non-TTY) reads the secret-manager output; `--from cli` reads no input (official CLI store file only).
- The owner scope is bound to trusted host identity (`H2A_LLM_MESH_OWNER_SCOPE`, defaulting to `cli:<hostname>`). Foreign owners cannot inspect, acquire or remove the account.
- The running gateway loads accounts at boot time only. After enrollment or import, restart the local gateway:
  ```sh
  h2a llm-mesh restart
  ```

### Status and limitations

Current operational status: **same seat model as every other provider; serving needs the official `claude` CLI on `PATH`** (owner decision 2026-10-13, DEC-118: « je veux une connexion réelle au compte claude code exactement dans le meme modele que les autres sieges » — « tu fais comme pour les autres sieges, rien de spécifique a claude merci »). The Claude-only guards are gone: no egress/netns precondition, no managed-config or registry/MDM refusal, no org-proof gate, no h2a-side account lease, no serving halt, no per-seat environment configuration.

- **Gateway composition:** the host always composes mesh `ClaudeCodeRuntimeClient` on the h2a runner into the provider registry via `AnthropicAdapter` — like the other four seats, with no configuration. A seat with no enrolled account (or no `claude` on `PATH`) simply never serves a route: fail-closed per attempt, never at composition.
- **One-message capability scope:** The initial serving outcome covers one user text message and streamed response through the official CLI (`protocol: 'claude-code-stream-json-v1'`).
- **Zero child refresh:** the projected credential carries access material only (no refresh token); a child that fails with an inference error is never retried and never refreshed by the runner — rotation stays a mesh-side parent operation.
- **Seat spawn preconditions (fail closed):** the official `claude` CLI resolves from `PATH` (re-resolved at each attempt) and a real provider TTL window. No version pin, no digest fingerprint, no attestation — none verified, none claimed. The runner inherits no parent `PATH` (fixed minimal value scoped to the binary directory). Sandbox cleanup failure blocks the result; process identity is proven before any sweep signal (the sweep never signals on PID presence alone — the runner's abort/deadline path kills its own known child tree).
- **History and tools:** Multi-turn history and caller tools remain unproven and `not-covered`. Requests with tools are refused at spawn until client-side tool transport (local MCP qualification) and end-to-end proofs are delivered; caller-provided tool names are never passed to `--tools` and built-in CLI tool names are rejected. The runner passes `--permission-mode dontAsk` (never `--dangerously-skip-permissions`).
