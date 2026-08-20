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

**The canonical model catalog and equivalence council belong to `@sentropic/llm-mesh`**, never to h2a or this skill. This skill must not freeze a provider/model table. Before translating a nickname:

- if a gateway is already running for this session, query `GET <ANTHROPIC_BASE_URL>/v1/models` (the mesh's own live catalog) and match the flavor there;
- otherwise, ask the caller for an exact model id or start the gateway and query it; never inspect or recreate a h2a-local table.

The owner-ratified xhigh aliases are intentionally narrow: Opus 5 and Opus 4.8 resolve to Terra xhigh, Fable 5 to Sol xhigh, and Sonnet 5 to Luna xhigh. Any additional effort variant must come from the live Sentropic council. Bare vendor ids remain provider-faithful. Always prefer the exact live catalog id returned by the gateway; if the requested nickname is absent, do not invent one.

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

- `h2a delegate <type> <task>` accepts the same `--model`/`--effort` flags for a queued/background job — Step 2's resolution rule applies there too.
- For the actual routing/alias table, defer to the live llm-mesh/gateway catalog; this skill never freezes a copy.
