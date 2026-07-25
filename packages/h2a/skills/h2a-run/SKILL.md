---
name: h2a-run
description: Translate a friendly launch intent ("terra 5.6 xhigh", "codex sol high effort", "relance en max") into the exact `h2a run` CLI invocation or `h2a_run` MCP call — model, effort, gateway on/off, naming, resume. Use whenever the user wants to launch or relaunch an h2a session and only knows a nickname/effort word, not the exact --model id or MCP parameter shape. Does not decide model routing (see the SoT note below) — launch ergonomics only.
---

# h2a-run

## When to use this

- The user names a launch by nickname + effort ("terra 5.6 xhigh", "sol en max", "relance codex en xhigh") instead of a provider model id.
- The user wants a background or interactive Claude/Codex session with a specific reasoning effort, with or without the llm-mesh gateway, and needs the exact CLI flags or MCP parameters.
- **Not** for deciding *which* flavor is best for a task (that is a human/model-delegation call, not this skill's job), and **not** for resolving alias→upstream-provider routing — that table is owned by the llm-mesh gateway, not this skill (see Step 2).

## Hard rule: never call the raw `h2a` binary from Bash

This plugin's PreToolUse hook (`packages/h2a/hooks/deny-manual-h2a-cli.mjs`) blocks any Bash command that invokes `h2a` — it prints *"Blocked manual `h2a` CLI use..."* and exits non-zero. As a Claude agent, always launch through the **`h2a_run` MCP tool**, never `h2a run` in Bash. The `h2a run` CLI form below exists for reference (a human at a real terminal, or a host without this guard) and to explain what the MCP tool does under the hood — do not run it yourself from Bash.

## Step 1 — decode the intent into three independent axes

None of these require knowing a provider model id up front:

1. **Profile** — `claude` or `codex` (which CLI to launch). Default to whichever CLI the user is already in if unstated; ask if genuinely ambiguous.
2. **Model flavor** — a nickname like *terra*, *sol* (aka *fable*), *luna*, or unstated (→ the CLI's own default model). Resolves to a `--model` / `model` value (Step 2).
3. **Effort** — `low | medium | high | xhigh`. "max" said by the user means `xhigh` — there is no higher tier for `h2a run` / `h2a_run` today.

## Step 2 — resolve the model flavor (source-of-truth caveat)

**The canonical model catalog belongs to the llm-mesh gateway**, not this skill: today it lives at `packages/h2a-runtime/src/llm-gateway-runtime/model-catalog.ts` (moving under `@sentropic/llm-gateway`). This skill must never be treated as ground truth for routing, and the hint table below is a minimal, best-effort convenience — it can drift or be wrong. There is an **open track item** ("Terra xhigh launch preset" bug) about exactly this kind of drift: a `claude-*`-branded alias can silently resolve to a *different* catalog entry than its nickname implies. Before trusting a mapping below:

- if a gateway is already running for this session, query `GET <ANTHROPIC_BASE_URL>/v1/models` (the mesh's own live catalog) and match the flavor there;
- otherwise, read the catalog source file above fresh — do not copy it verbatim into a durable prompt/skill, it moves.

Known flavors as of this writing (verify before relying on them for anything consequential):

| User says | Catalog id — pass this to `--model`/`model` | Pool |
|---|---|---|
| "terra", "5.6 terra" | `gpt-5.6-terra` | codex |
| "sol", "fable", "fable 5" | `gpt-5.6-sol` | codex |
| "luna" | `gpt-5.6-luna` | codex |
| "5.5" (codex default) | `gpt-5.5` | codex |
| "gemini flash", "3.5 flash" | `gemini-3.5-flash` | google |
| "gemini pro", "3.1 pro" | `gemini-3.1-pro` | google |

Prefer the **catalog id** (right column) over a `claude-*`-branded alias — the aliases are exactly where the current drift/collision risk lives. If the user names a flavor not in this table, do not invent an id: query the live catalog (above) rather than guessing.

## Step 3 — gateway on/off

Any non-default flavor needs the llm-mesh gateway to translate the Anthropic-shaped request to the real upstream. Default to the gateway **on** for a named flavor, off for the CLI's native default model:

- CLI: `--gw` (alias `--llm-gateway`) forces it on, `--no-gw` (alias `--no-llm-gateway`) forces it off, omit for the CLI's own default.
- MCP `h2a_run`: `gateway: "required"` forces it on, `"off"` forces it off, `"auto"` (default) decides. **`"required"` is rejected when `profile` is `"codex"`** — codex already talks to llm-mesh over an Anthropic-compatible surface, use `"auto"` there.

## Step 4 — compose the call

### `h2a_run` MCP tool (what this agent must use)

Required: `profile` (`"claude"|"codex"`), `name` (`^[A-Za-z0-9_-]{1,64}$`), `workspace` (absolute path, must exist, must stay inside the MCP server's startup workspace root), `prompt` (1–65536 UTF-8 bytes, sent on stdin — never put it in argv), `background` (must be literal `true`). Optional: `model` (free-text, format-checked only — see Step 2 for the value), `effort` (`"low"|"medium"|"high"|"xhigh"`), `gateway` (`"auto"|"required"|"off"`, default `"auto"`), `headless` (default `false`), `h2aSidecar` (default `!headless`; cannot be `true` together with `headless: true`).

Example — "terra, xhigh, headless, on this repo":

```json
{
  "profile": "codex",
  "name": "terra-review",
  "workspace": "/abs/path/to/repo",
  "prompt": "<initial instructions>",
  "background": true,
  "model": "gpt-5.6-terra",
  "effort": "xhigh",
  "gateway": "auto",
  "headless": true
}
```

The tool returns an `h2a.run.result` contract with `session.tmuxSession`, `session.pane`, `session.gateway` (`"gateway"|"direct"`). Read those fields back to confirm what actually launched — do not assume the request was honored silently.

### `h2a run` CLI (reference only — non-Claude-Code hosts / humans at a terminal)

```
h2a run codex /abs/path/to/repo --model gpt-5.6-terra --effort xhigh --gw --name terra-review --no-attach --background --json --prompt-stdin
```

Interactive/attached form (drop the background-launch flags, add nothing else):

```
h2a run claude . --model gpt-5.6-terra --effort xhigh --gw --name terra-review
```

Other `h2a run` flags worth knowing:

- `-r, --resume <convId>` — continue a conversation; combine with `--model`/`--effort` to relaunch the same conversation at a different flavor/effort.
- `--headless` — run once, record output under `.h2a/runs/<name>`, then exit (cannot combine with `--h2a`).
- `--count <n>` — fan out N fresh sessions; incompatible with `--model`/`--effort`/`--resume`/any structured launch (each fanned session is a fresh conversation).
- `--h2a` / `--no-h2a` — start (or skip) the side-window h2a MCP server; defaults on unless `--headless`.
- `--name <label>` — tmux slug + tab label; defaults to the workspace dirname. Pick one deliberately when launching more than one session against the same repo.

## Related

- `h2a delegate <type> <task>` accepts the same `--model`/`--effort` flags for a queued/background job (plus `--account <id>` to pin a specific pooled account) — Step 2's resolution rule applies there too.
- For the actual routing/alias table, defer to the llm-mesh/gateway catalog — this skill never freezes a copy of it beyond the "known as of this writing" hint in Step 2.
