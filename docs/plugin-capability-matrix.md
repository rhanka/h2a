# Plugin capability matrix — claude / codex / gemini / agy

> Output of **Spec session 1** (EVO-0/EVO-1/EVO-3 framing). Factual audit of the four agent CLIs installed on the dev machine (2026-05-26): claude 2.1.152, codex-cli 0.133.0, gemini 0.43.0, agy 1.0.2. Source: each CLI's `--help` / subcommand help.

## Matrix

| Capability | claude | codex | gemini | agy |
|---|---|---|---|---|
| Non-interactive / headless | ✅ `-p/--print`, `--output-format json\|stream-json` | ✅ `exec` (+ `review`) | ✅ `-p/--prompt`, `--output-format json\|stream-json` | ✅ `-p/--print` (`--print-timeout` 5m) |
| Structured output (JSON) | ✅ `json`/`stream-json` | ~ (`exec`) | ✅ `json`/`stream-json` | ❓ none shown |
| **MCP — consume servers** | ✅ `--mcp-config` | ✅ `codex mcp` | ✅ `gemini mcp` | ❌ **none** |
| MCP — be a server | (consumes) | ✅ `mcp-server` (stdio) | ~ | ❌ |
| Plugins / extensions | ✅ `--plugin-dir/-url` | ✅ `codex plugin` | ✅ `gemini extensions` | ✅ `agy plugin` — **imports claude/gemini plugins** |
| Skills / commands | ✅ `/skill` | ~ (via plugin) | ✅ `gemini skills` | ~ (via imported plugin) |
| **Resume / continue (bilateral)** | ✅ `-c`/`-r`/`--session-id`/`--fork-session` | ✅ `resume`/`fork` | ✅ `-r`/`--session-id`/`--list-sessions` | ✅ `-c`/`--conversation` |
| Agent↔user Q&A back-channel | ✅ `SendUserMessage` (`--brief`) | ~ `app-server`/`remote-control` | ~ `--acp` (Agent Comms Protocol) / interactive | ❓ interactive only |
| Background / daemon | internal wake/cron; `--remote-control` | ✅ `app-server` + `remote-control` daemon, `exec-server` | ~ `gemini hooks` (lifecycle) | ❓ none shown |
| Lifecycle hooks | (settings hooks) | ~ | ✅ `gemini hooks` | ❓ |

✅ supported · ~ partial/indirect · ❓ unknown (not in CLI help, needs deeper probe) · ❌ absent

## Key findings

1. **Bilateral discussion / relance (EVO-1) is feasible on all four** — every CLI has headless run + resume/continue, so an agent can be re-prompted/woken to follow up. This was the original question: **yes**, the relance substrate exists everywhere.
2. **agy has no MCP (EVO-0 pivot)** — unlike the other three, agy exposes no MCP client/server. But `agy plugin import` **imports claude/gemini plugins**. So h2a parity on agy must go through the **plugin-import + direct `h2a` CLI** path, *not* MCP. Consequence: the MCP-only h2a features (`h2a_session_open`, push `notifications/h2a`, the in-session MCP tools) have **no agy equivalent today**; the CLI verbs (`register`/`discover`/`inbox`/`negotiate`/`sessions`/…) do work via shell-out. → agy parity is achievable but **not on the MCP integration path**.
3. **Background notification (EVO-3) varies** — claude (internal wake/remote-control), codex (`app-server`/`remote-control` daemon, `exec-server`), gemini (`hooks`) all offer a background/daemon/hook mechanism; **agy shows none** → agy is the compatibility gap for cross-agent blockage notification.
4. **Native Q&A back-channel (EVO-4) is uneven** — claude has a clean `SendUserMessage` (`--brief`); gemini has ACP; codex has `app-server`; **agy is interactive-only**. This confirms the need for a **plugin-provided or web-page Q&A** for hosts lacking a clean native back-channel (esp. agy, and codex headless).

## Implications per intention

- **EVO-0 (agy parity)**: target the **plugin-import path** (ship the h2a plugin so `agy plugin import` picks it up) + rely on the `h2a` CLI for store/negotiation ops. Flag the MCP-only feature gap (live sessions, push notifications) — either accept reduced parity on agy, or add a non-MCP transport for those (e.g. the CLI `sessions`/polling). **Open decision for Séance agy.**
- **EVO-1 (relance)**: build on resume/continue + headless across all four; no blocker.
- **EVO-3 (blockage feedback loop)**: use codex daemon / gemini hooks / claude wake for background notification; **agy needs a fallback** (polling via the imported plugin) until/unless it gains a daemon.
- **EVO-4 (decision support)**: prefer the **web-page-via-MCP-API** and **plugin-provided Q&A** modes precisely because native Q&A is uneven; native back-channel only where it exists (claude `SendUserMessage`).

## To verify (deeper probe, deferred)

- codex `mcp` / `mcp-server` exact stdio contract; codex `app-server`/`remote-control` as a notification bus.
- gemini `--acp` (Agent Communication Protocol) — could it carry h2a envelopes/notifications natively?
- agy: any hidden MCP/config support; whether an imported claude/gemini plugin can declare an MCP server that agy honors (likely not, given no MCP runtime).
- Whether `agy plugin import` accepts the h2a skill as-is (claude/gemini plugin format).

## Related

- `docs/evolution-intentions.md` (EVO-0/1/3/4), DEC-054/055 (host skill + MCP integration), DEC-052 (notifications), `docs/drumbeat.md` (EVO-2).
