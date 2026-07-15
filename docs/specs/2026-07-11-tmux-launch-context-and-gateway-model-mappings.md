# Spec — tmux launch context + gateway model mappings

Date: 2026-07-11
Status: specified / build-ready
Owner: Antoine
Scope: `packages/h2a-runtime` local tmux launcher + llm-gateway model catalog copies (`apps/llm-gateway`, embedded `packages/h2a-runtime/src/llm-gateway-runtime`)

> The Opus 4.8 alias choice in this historical spec is superseded by
> `2026-07-14-SPEC_EVOL_terra-xhigh-delegation.md`: Terra is now the alias
> default; Luna remains available by explicit id.

## Problem

When a local agent is started through `h2a run` / `remote run`, the tmux session currently records only a small amount of durable metadata (`@profile`, display name, agent pane/host/cwd). From inside tmux, it is not obvious which launch options were applied:

- whether the local LLM gateway / llm-mesh (`gw`) was injected;
- which Claude configuration/model mapping was used;
- which h2a side-window command was requested;
- which original argv/resume flags created the session.

This makes debugging gateway/model surprises harder, especially now that the gateway aliases are evolving from the historical `gpt-5.5` default to `5.6` family variants (`luna`, `sol`).

## Goals

1. Record a compact, inspectable launch-context on the tmux session whenever `startLocalSession` creates or reuses a managed session.
2. Expose that context in a human-friendly way without requiring users to remember raw tmux `show-options` commands.
3. Update the default gateway catalog to support the requested 5.6 aliases:
   - map Claude Opus 4.8 style requests to the 5.6 Luna upstream by default;
   - add a Fable 5 alias mapped to a 5.6 Sol upstream.
4. Keep all changes additive and reversible; no live network dependency; no server endpoint.

## Non-goals

- Do not implement a new gateway routing policy. Existing round-robin/account-pool semantics stay unchanged.
- Do not remove `OPENAI_MODEL_MAP`; explicit env overrides must keep precedence over catalog defaults.
- Do not persist secrets in tmux options. Tokens, API keys and authorization headers must never appear in the launch context.
- Do not change the h2a side-window contract beyond recording the command that was requested.

## Proposed behavior

### A. Durable tmux launch context

Add managed tmux session options with a stable prefix, for example:

- `@remote_launch_profile`: requested agent profile (`claude`, `codex`, ...).
- `@remote_launch_cwd`: working directory.
- `@remote_launch_label`: user label / session slug when provided.
- `@remote_launch_resume`: sanitized resume/conversation args (ids are okay; no secrets).
- `@remote_launch_gateway`: one of `on`, `off`, `unknown`.
- `@remote_launch_gateway_base_url`: gateway base URL if known and local/non-secret (e.g. `http://localhost:3002`), otherwise omitted/redacted.
- `@remote_launch_model_map`: compact summary of active model mapping source, e.g. `catalog:5.6-luna,5.6-sol` or `env:OPENAI_MODEL_MAP`.
- `@remote_launch_h2a`: whether an h2a side window was requested / started.
- `@remote_launch_h2a_command`: h2a command line with shell quoting preserved, but no secrets.

The source of truth remains the launcher inputs and environment. The tmux options are diagnostic metadata only.

### B. User-facing inspection

Add a small inspection surface. Preferred shape:

```sh
h2a ls --context        # or existing ls table gains an optional context column
h2a inspect <session>   # prints the stored launch context
```

If the current CLI namespace already has a session-inspection verb, extend that instead of adding a duplicate. The output must make the common case obvious, e.g.:

```text
remote-a2a-cli
  profile: claude
  cwd: /home/antoinefa/src/a2a-cli
  gateway: on (ANTHROPIC_BASE_URL=http://localhost:3002)
  model-map: claude-opus-4-8 -> gpt-5.6-luna-xhigh; fable-5 -> gpt-5.6-sol
  h2a: on (h2a mcp-serve --auto-open --auto-upgrade --wake local-tmux)
  relaunch: h2a run claude /home/antoinefa/src/a2a-cli --name a2a-cli -r ...
```

### C. Gateway catalog defaults

Current code still defaults `claude-opus-4-8` and related Claude aliases to catalog id/upstream `gpt-5.5`. Change the default catalog in both maintained copies:

- `apps/llm-gateway/src/model-catalog.ts`
- `packages/h2a-runtime/src/llm-gateway-runtime/model-catalog.ts`

Target catalog shape (exact upstream ids may follow the deployed provider naming, but must be explicit and tested):

- `gpt-5.6-luna-xhigh` (or the provider's exact Luna x-high id)
  - aliases include `claude-opus-4-8` and the existing Opus/Sonnet compatibility aliases that should follow the new default.
- `gpt-5.6-sol` (or the provider's exact Sol id)
  - aliases include `fable-5` and `claude-fable-5` if the gateway receives Claude-flavoured model names.
- Keep `gpt-5.3-codex-spark` unchanged unless separately requested.
- Preserve `OPENAI_MODEL_MAP` precedence over catalog entries.

## Acceptance criteria

1. A unit test proves `startLocalSession` / the metadata helper writes launch-context tmux options, with secrets redacted.
2. A unit test proves reused sessions refresh the diagnostic context instead of leaving stale options.
3. A unit test proves the inspection formatter renders gateway/model/h2a context without exposing `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, or bearer values.
4. Gateway model-catalog tests prove:
   - `claude-opus-4-8` resolves to the Luna 5.6 default;
   - `fable-5` resolves to the Sol 5.6 default;
   - `OPENAI_MODEL_MAP` still overrides both.
5. `npm run build:h2a` and the affected package tests pass.
6. `bash scripts/check-public-contract.sh` passes if any public CLI surface changes.

## Implementation notes

- Keep pure formatting/building logic separate from the tmux side effects, mirroring `buildTmuxGlobalOptions`.
- Prefer a small `LaunchContext` type and a pure `sanitizeLaunchContext` / `formatLaunchContext` helper.
- Do not store raw process env wholesale. Store only allow-listed keys and derived summaries.
- If exact deployed provider ids differ from the examples above, update the spec implementation note in the commit message and tests to match the real ids.
