# EVOL: canonical MCP `h2a_run` for Claude and Codex

Status: committed design for a minimal local V1.

## Intent

Claude and Codex already consume the same local `h2a mcp-serve` tool registry, but that registry cannot launch an agent. V1 adds one mutating local tool which launches a caller-selected Claude or Codex profile in an existing workspace. It does not create branches or worktrees and is never exposed by the hosted read-only MCP surface.

## Decisions

1. **One shared tool.** `h2a_run` is registered on the existing local MCP server, giving Claude and Codex identical behavior without host-specific plugin code.
2. **Exact input.** Required fields are `profile`, `name`, `workspace`, and `prompt`. `profile` is `claude|codex`; `background` must be `true`; `gateway` is `auto|required|off`; optional `model`, `effort`, `headless`, and `h2aSidecar` are validated and never silently ignored. Unknown properties fail.
3. **Caller owns workspace preparation.** `workspace` must be an absolute existing directory outside system `/tmp`. V1 never creates or switches a branch/worktree.
4. **Canonical execution.** The MCP handler invokes the currently installed `h2a` binary as `h2a run ... --json --background --no-attach`, using an argv array with `shell:false`. It does not call a legacy `remote` binary or hide a `delegate` call.
5. **Prompt never enters argv.** The MCP bridge feeds `h2a run --prompt-stdin` through stdin. Interactive sessions capture the exact agent pane (`%id`) from tmux, load a private tmux buffer through stdin, and paste it only into that pane; headless sessions use Claude `-p --input-format text` or Codex `exec -` with a transient `0600` input file opened and unlinked before CLI execution. Prompt files are also removed on launch/PID verification failure. Flag-like text and shell metacharacters are never interpreted.
6. **No ignored tuning.** Claude receives `--model`/`--effort`; Codex receives `-m` and `-c model_reasoning_effort=...`. Unsupported profiles, models, effort values, or combinations fail before tmux creation.
7. **Real result or failure.** `h2a run --json` returns `apiVersion: "h2a.run/v1"`, the runtime package version, actual session/tmux id, exact pane id and pane pid, workspace, mode, gateway posture, sidecar state, and attach argv. Prompt delivery and PID lookup always target the captured pane, never whichever session window is current. A required sidecar uses a terminate-on-exit wrapper and receives a unique internal ready-file path plus nonce. `mcp-serve` atomically writes the `0600` correlated ACK only after auto-open succeeds and before entering the stdio loop; structured auto-open or ACK publication failure is fatal, while the historical non-structured auto-open remains best-effort. The launcher requires the nonce and ACK PID to match the exact stable sidecar pane PID. It treats this ACK as primary readiness evidence and pane/PID stability as a secondary guard, so a live shell, forged PID, or fake `mcp-serve` argv cannot pass. Auto-upgrade/re-exec preserves the challenge but cannot ACK before the upgraded process reaches auto-open readiness. Challenge directories are removed on success, failure, and timeout. The MCP layer rejects non-zero, malformed, duplicate-name, or contract-incompatible output as runtime skew; it never invents a job id.
8. **Background semantics.** MCP launches are explicitly classified `background` in the runtime registry and excluded from registry-first human restore. Existing interactive `h2a run` behavior stays human-facing.
9. **Headless semantics.** Headless starts a run-once agent session with durable output/result files. An h2a sidecar is optional for interactive background sessions and rejected for headless sessions because it would keep an otherwise terminal run alive.
10. **Hosted boundary.** `h2a_run` is local-only and remains absent from the hosted HTTP read-only allowlist.
11. **Plugin parity.** The npm package ships both `.claude-plugin/plugin.json` and a validated `.codex-plugin/plugin.json`. Codex uses the companion `.mcp.json` to start the canonical h2a and track MCP servers; the package-level h2a/harness skills are discoverable without mutating a personal marketplace during build.
12. **Direct environment is explicit.** Both interactive and headless direct launches scrub stale `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, and `ANTHROPIC_API_KEY` inherited from a pre-existing tmux server.

## Adversarial review reconciliation

- The plugin audit favored a small shared MCP tool and a neutral argv builder, while warning that Codex effort must not be dropped and runtime skew must fail closed.
- An independent security review rejected forwarding the previous `h2a run`: it lacked prompt/model/effort/headless/JSON and treated unknown profiles as executables. A follow-up rejected even safely terminated prompt argv because process listings can disclose it.
- The reconciled design extends only the existing canonical `h2a run` path, adds strict allowlists at both MCP and runtime boundaries, transports prompts only through stdin/private tmux buffers, and keeps heavy runtime imports outside `@sentropic/h2a`.
