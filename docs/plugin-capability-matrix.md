# Plugin capability matrix — claude / codex / gemini / agy

> Output of **Spec session 1** (EVO-0/EVO-1/EVO-3 framing). Factual audit of the four agent CLIs installed on the dev machine (2026-05-26): claude 2.1.152, codex-cli 0.133.0, gemini 0.43.0, agy 1.0.2. Source: each CLI's `--help` / subcommand help + config inspection.
>
> **agy = Antigravity (Google)** — a Gemini-ecosystem agent CLI (`com.google.geminicoder.agentexecutor`), config under `~/.gemini/antigravity-cli/`, default model "Gemini 3.5 Flash (High)". It **embeds MCP** (Go `mcp.ServerSession`/`McpServerToolConfig`/jsonrpc2) and **Playwright natively** (Go bindings — it does not use a playwright-MCP server).
>
> **Hermes and OpenCode** are newer host adapters (added 2026-07-08). h2a ships their MCP-setup snippet, host scenario, native skill install, and Claude-format stop-hook (all rendered + automated-tested — see [`host-integration-matrix.md`](./host-integration-matrix.md)). This capability grid is **not yet updated for them**: it is a live probe of specific CLI versions, and their binaries were not audited on this machine. Do not infer a Hermes/OpenCode capability cell from silence here — the tracked, current status is in `host-integration-matrix.md`.

## Matrix

| Capability | claude | codex | gemini | agy |
|---|---|---|---|---|
| Non-interactive / headless | ✅ `-p/--print`, `--output-format json\|stream-json` | ✅ `exec` (+ `review`) | ✅ `-p/--prompt`, `--output-format json\|stream-json` | ✅ `-p/--print` (`--print-timeout` 5m) |
| Structured output (JSON) | ✅ `json`/`stream-json` | ~ (`exec`) | ✅ `json`/`stream-json` | ❓ none shown |
| **MCP — consume servers** | ✅ `--mcp-config` | ✅ `codex mcp` | ✅ `gemini mcp` | ✅ **yes** — binary-embedded (Antigravity/Gemini); config `~/.gemini/config/mcp_config.json` (currently empty) |
| MCP — be a server | (consumes) | ✅ `mcp-server` (stdio) | ~ | ❓ |
| Plugins / extensions | ✅ `--plugin-dir/-url` | ✅ `codex plugin` | ✅ `gemini extensions` | ✅ `agy plugin` — **imports claude/gemini plugins** |
| Skills / commands | ✅ `/skill` | ~ (via plugin) | ✅ `gemini skills` | ~ (via imported plugin) |
| **Resume / continue (bilateral)** | ✅ `-c`/`-r`/`--session-id`/`--fork-session` | ✅ `resume`/`fork` | ✅ `-r`/`--session-id`/`--list-sessions` | ✅ `-c`/`--conversation` |
| Agent↔user Q&A back-channel | ✅ `SendUserMessage` (`--brief`) | ~ `app-server`/`remote-control` | ~ `--acp` (Agent Comms Protocol) / interactive | ❓ interactive only |
| Background / daemon | internal wake/cron; `--remote-control` | ✅ `app-server` + `remote-control` daemon, `exec-server` | ~ `gemini hooks` (lifecycle) | ❓ none shown |
| Lifecycle hooks | (settings hooks) | ~ | ✅ `gemini hooks` | ❓ |

✅ supported · ~ partial/indirect · ❓ unknown (not in CLI help, needs deeper probe) · ❌ absent

## Key findings

1. **Bilateral discussion / relance (EVO-1) is feasible on all four** — every CLI has headless run + resume/continue, so an agent can be re-prompted/woken to follow up. This was the original question: **yes**, the relance substrate exists everywhere.
2. **agy DOES support MCP (corrected)** — `--help` shows no `mcp` subcommand, but the binary embeds an MCP runtime and there is a dedicated config slot `~/.gemini/config/mcp_config.json` (currently **empty** → no servers wired yet). So h2a's `mcp-serve` can be registered for agy the same way as for the other three, giving agy the **full MCP integration** (incl. live sessions + push notifications) — **no special agy gap**. `agy plugin import` (imports claude/gemini plugins) is a complementary path for the skill. agy also embeds **Playwright natively** (Go bindings), so it does not use a playwright-MCP server. Note: the h2a MCP tools are thin wrappers over the same `LocalStore` ops as the CLI verbs, so a CLI-only fallback remains available for any host.
3. **Background notification (EVO-3) varies** — claude (internal wake/remote-control), codex (`app-server`/`remote-control` daemon, `exec-server`), gemini (`hooks`) all offer a background/daemon/hook mechanism; **agy shows none** → agy is the compatibility gap for cross-agent blockage notification.
4. **Native Q&A back-channel (EVO-4) is uneven** — claude has a clean `SendUserMessage` (`--brief`); gemini has ACP; codex has `app-server`; **agy is interactive-only**. This confirms the need for a **plugin-provided or web-page Q&A** for hosts lacking a clean native back-channel (esp. agy, and codex headless).

## Implications per intention

- **EVO-0 (agy parity)**: agy supports MCP → register `h2a mcp-serve` in `~/.gemini/config/mcp_config.json` for **full parity** (live sessions + push included), same integration as the other three; the imported-plugin path carries the `/h2a` skill. No reduced-parity gap. `install-skills` would gain an `agy` target (config + plugin).
- **EVO-1 (relance)**: build on resume/continue + headless across all four; no blocker.
- **EVO-3 (blockage feedback loop)**: use codex daemon / gemini hooks / claude wake for background notification; **agy needs a fallback** (polling via the imported plugin) until/unless it gains a daemon.
- **EVO-4 (decision support)**: prefer the **web-page-via-MCP-API** and **plugin-provided Q&A** modes precisely because native Q&A is uneven; native back-channel only where it exists (claude `SendUserMessage`).

## To verify (deeper probe, deferred)

- codex `mcp` / `mcp-server` exact stdio contract; codex `app-server`/`remote-control` as a notification bus.
- gemini `--acp` (Agent Communication Protocol) — could it carry h2a envelopes/notifications natively?
- agy: ✅ resolved — MCP runtime is embedded; servers go in `~/.gemini/config/mcp_config.json` (empty today). Remaining: confirm the exact MCP config schema agy expects (probe live, or ask agy headless), and whether `agy plugin import` accepts the h2a skill as-is (claude/gemini plugin format).
- agy background/daemon (EVO-3): not exposed in `--help`; agy is a full agent (`brain/`, `conversations/`) but a scheduled-wake/daemon hook is unconfirmed.

## Related

- `docs/evolution-intentions.md` (EVO-0/1/3/4), DEC-054/055 (host skill + MCP integration), DEC-052 (notifications), `docs/drumbeat.md` (EVO-2).
