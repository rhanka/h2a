# h2a host CLI functional test matrix

Measured 2026-08-30 for Track item `01M06N825`. This is a matrix of exercises, not a compatibility declaration. Every cell names one command that was actually run and links to its captured command, exit code, stdout/stderr, and—when a host process ran—the before/after fingerprints of the owner's stable host configuration files.

The four states have deliberately narrow meanings:

- `measured-OK`: the linked exercise achieved the behavior stated in that cell.
- `measured-KO`: the linked exercise reached the host and produced a reproducible negative result.
- `not-applicable`: no official publisher agent CLI exists to exercise.
- `NOT-TESTED (reason)`: the exercise stopped short of the behavior, or the required coordination/credential was unavailable. It is not a negative capability claim.

## Executive result

| Host actually exercised | 1. Enrollment | 2. Gateway | 3. Model mapping | 4. Harness | 5. Sub-agent | 6. A2A/h2a | 7. llm-mesh login | 8. Loops |
|---|---|---|---|---|---|---|---|---|
| Claude Code 2.1.251 | `measured-OK` [C-E] | `measured-OK` [C-G] | `measured-OK` [C-M] | `measured-OK` [C-H] | `NOT-TESTED (no child dispatched)` [C-D] | `measured-KO` [C-A] | `NOT-TESTED (lane unavailable)` [C-L] | `NOT-TESTED (MCP pending approval)` [C-O] |
| Codex 0.150.1 | `measured-OK` [X-E] | `measured-KO` [X-G] | `measured-OK` [X-M] | `measured-OK` [X-H] | `NOT-TESTED (no child dispatched)` [X-D] | `NOT-TESTED (configuration only)` [X-A] | `NOT-TESTED (lane unavailable)` [X-L] | `NOT-TESTED (tool not called)` [X-O] |
| AGY 1.1.22 | `measured-KO` [A-E] | `NOT-TESTED (route not observable)` [A-G] | `measured-OK` [A-M] | `measured-KO` [A-H] | `NOT-TESTED (no child dispatched)` [A-D] | `NOT-TESTED (configuration only)` [A-A] | `NOT-TESTED (lane unavailable)` [A-L] | `NOT-TESTED (tool not called)` [A-O] |
| OpenCode 1.17.15 | `measured-KO` [O-E] | `measured-KO` [O-G] | `measured-OK` [O-M] | `measured-KO` [O-H] | `measured-OK` [O-D] | `measured-OK` [O-A] | `NOT-TESTED (lane unavailable)` [O-L] | `NOT-TESTED (tool not called)` [O-O] |
| Hermes 0.18.2 | `measured-OK` [H-E] | `NOT-TESTED (provider dependency absent)` [H-G] | `NOT-TESTED (provider dependency absent)` [H-M] | `measured-OK` [H-H] | `NOT-TESTED (no MoA run)` [H-D] | `measured-OK` [H-A] | `NOT-TESTED (lane unavailable)` [H-L] | `NOT-TESTED (tools discovered only)` [H-O] |
| Gemini CLI 0.56.0 | `measured-OK` [G-E] | `measured-KO` [G-G] | `NOT-TESTED (authentication stopped request)` [G-M] | `measured-KO` [G-H] | `NOT-TESTED (no child launch surface exercised)` [G-D] | `measured-KO` [G-A] | `NOT-TESTED (lane unavailable)` [G-L] | `NOT-TESTED (MCP disabled)` [G-O] |
| Mistral Vibe 2.17.1 | `NOT-TESTED (API key gate)` [V-E] | `measured-KO` [V-G] | `NOT-TESTED (API key gate)` [V-M] | `NOT-TESTED (API key gate)` [V-H] | `NOT-TESTED (API key gate)` [V-D] | `NOT-TESTED (no h2a transport exercised)` [V-A] | `NOT-TESTED (lane unavailable)` [V-L] | `NOT-TESTED (API key gate)` [V-O] |
| Meta Muse Code 0.1.0 | `measured-OK` [M-E] | `NOT-TESTED (echo provider bypassed routing)` [M-G] | `NOT-TESTED (Meta provider not authenticated)` [M-M] | `measured-OK` [M-H] | `NOT-TESTED (echo provider did not launch child)` [M-D] | `measured-KO` [M-A] | `NOT-TESTED (lane unavailable)` [M-L] | `NOT-TESTED (echo provider only echoed)` [M-O] |
| Z.AI | `not-applicable` [Z-E] | `not-applicable` [Z-G] | `not-applicable` [Z-M] | `not-applicable` [Z-H] | `not-applicable` [Z-D] | `not-applicable` [Z-A] | `not-applicable` [Z-L] | `not-applicable` [Z-O] |

The bracketed labels resolve to the cell register below. A green cell means only that its stated exercise passed; for example, OpenCode A2A is green for a real MCP connection, not for delivery of an inbox envelope.

## Versions and official-source gate

The owner's six version observations were retained as the comparison baseline. The binaries available on the measurement date had drifted for four hosts:

| Host | Owner observation | Exercised binary | Version artifact |
|---|---:|---:|---|
| Claude Code | 2.1.234 | 2.1.251 | [version](artifacts/host-cli-feature-matrix/B00-claude-version.txt) |
| Codex | 0.147.0 | 0.150.1 | [version](artifacts/host-cli-feature-matrix/B01-codex-version.txt) |
| AGY | 1.1.13 | 1.1.22 | [version](artifacts/host-cli-feature-matrix/B02-agy-version.txt) |
| OpenCode | 1.17.15 | 1.17.15 | [version](artifacts/host-cli-feature-matrix/B03-opencode-version.txt) |
| Hermes | 0.18.2 | 0.18.2, upstream `46c0c6ec`, one carried local commit | [version](artifacts/host-cli-feature-matrix/B04-hermes-version.txt) |
| Gemini CLI | 0.47.0 | 0.56.0 | [version](artifacts/host-cli-feature-matrix/B05-gemini-version.txt) |
| Mistral | not supplied | official Mistral Vibe 2.17.1 | [version](artifacts/host-cli-feature-matrix/B07-vibe-version.txt) |
| Meta Muse | not supplied | Muse Code 0.1.0 (`0.1.0-R708.1`) | [version](artifacts/host-cli-feature-matrix/B06-muse-version.txt) |
| Z.AI | not supplied | no official agent CLI identified | [official-source evidence](artifacts/host-cli-feature-matrix/S03-zai-zcode.txt) |

The additional publishers were gated before any installation:

- Mistral's official source is `mistralai/mistral-vibe`, whose publisher-owned repository describes it as a “Minimal CLI coding agent by Mistral” ([source exercise](artifacts/host-cli-feature-matrix/S00-mistral-official-source.txt)). The binary is `vibe`, not the unrelated npm `mistral-cli` package.
- Meta's installed `muse` launcher targets `api.meta.ai`; the official stable channel returned `1.0.1-R1848.1` on the measurement date ([channel exercise](artifacts/host-cli-feature-matrix/S01-muse-official-channel.txt)). Auto-update and login were disabled for every Muse exercise, so the exercised binary remained 0.1.0.
- Z.AI's official material calls ZCode an Agentic Development Environment installed from a download page, and lists Claude Code, Codex and OpenCode as tools it configures ([ZCode](artifacts/host-cli-feature-matrix/S03-zai-zcode.txt), [supported tools](artifacts/host-cli-feature-matrix/S02-zai-supported-tools.txt)). Its official `@z_ai/coding-helper` is a command-line assistant for configuring those other tools, not a host agent CLI ([helper](artifacts/host-cli-feature-matrix/S04-zai-coding-helper.txt)). No `zcode`, `zai`, or `z-ai` binary was present in the clean baseline. Therefore all eight Z.AI host-CLI axes are `not-applicable`. The unrelated npm `zai-cli` was not installed. The unrelated npm `muse-cli` and `mistral-cli` packages were likewise not installed.

## Measurement method

1. A clean clone of `origin/main` at `d79991ce` was made under the repository's ignored `tmp/worktrees/` area and branch `docs/01m06n825-host-cli-feature-matrix` was created there. The owner's dirty checkout and `.track/` were not changed.
2. Baseline version/help/source exercises ran before plugin installation or cache-populating exercises. Installation results are never used to describe the pre-install baseline.
3. Every host exercise ran with a fresh `/tmp/h2a-cli-matrix.XXXXXXXX` root, a fresh `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME`, `TMPDIR`, and `CLAUDE_CONFIG_DIR`, under `env -i`. Muse additionally received `MUSE_NO_AUTO_UPDATE=1` and `MUSE_LOGIN=0`.
4. Before and after each invocation, the runner hashed stable owner control files for Claude, Codex, AGY, OpenCode, Hermes, Gemini, Mistral/Vibe, Z.AI and Muse. Every artifact cited by the matrix records `owner_roots_unchanged=yes`. Temporary roots record `temporary_root_removed=yes`.
5. Mutable runtime caches were not used as the fingerprint set because the owner's concurrently running tools legitimately update them. Stable settings, credentials/config files, plugin registries, hook/skill roots, and the Muse launcher/update markers were included. This makes the check sensitive to configuration rewrites without treating unrelated cache activity as the host under test.
6. Gateway/model tests used a local loopback HTTP server where possible. It captured the request path, redacted authorization headers, and request body. Claude's `sonnet` resolution and OpenCode's Anthropic request therefore come from requests made by the binaries, not from documentation or source grep.
7. h2a surface tests launched the installed h2a MCP server as a child of the host CLI inside the disposable workspace. “Configured,” “connected,” “tools discovered,” and “tool invoked” are reported separately.
8. A pair of AGY help queries was accidentally issued outside the wrapper and excluded. The fingerprint after the preceding wrapped exercise was byte-for-byte equal to the immediate recovery snapshot ([recovery artifact](artifacts/host-cli-feature-matrix/X00-owner-root-recovery-check.txt)); the relevant AGY exercises were then rerun through the wrapper.
9. No repository build was needed, so no `dist` or `*.tsbuildinfo` output was created. No test populated the owner's host roots.

## Cell exercise register

`<repo>` below means the clean measurement clone. Full paths, environment variables, outputs, exit codes, timestamps and fingerprints are in the linked artifacts.

### Claude Code

| Cell | State | Exercise and observed artifact |
|---|---|---|
| C-E Enrollment | `measured-OK` | `claude plugin validate <repo>/packages/h2a` exited 0 with “Validation passed”; the disposable Claude root was initialized and captured. [Artifact](artifacts/host-cli-feature-matrix/E00-claude-plugin-validate.txt) |
| C-G Gateway | `measured-OK` | With `ANTHROPIC_BASE_URL=<loopback>` and `ANTHROPIC_AUTH_TOKEN`, `claude --bare --print --model sonnet ...` exited 0 and POSTed to `/v1/messages?beta=true` with an authorization header. [Artifact](artifacts/host-cli-feature-matrix/M00-claude-model-gateway-mock.txt) |
| C-M Model mapping | `measured-OK` | A separate `--model sonnet` loopback exercise exited 0; the captured title and main requests both carried resolved model `claude-sonnet-5`. [Artifact](artifacts/host-cli-feature-matrix/M08-claude-model-alias.txt) |
| C-H Harness | `measured-OK` | Local marketplace add, `claude plugin install h2a@sentropic`, then `plugin list --json` all exited 0; `h2a@sentropic` 0.96.1 was enabled and exposed its h2a MCP declaration in the disposable root. [Artifact](artifacts/host-cli-feature-matrix/H00-claude-h2a-plugin-load.txt) |
| C-D Sub-agent | `NOT-TESTED (no child dispatched)` | `claude agents --help` exited 0 and exposed background-session dispatch flags, but this exercise did not dispatch or observe a child. [Artifact](artifacts/host-cli-feature-matrix/D00-claude-subagent-surface.txt) |
| C-A A2A/h2a | `measured-KO` | A workspace `.mcp.json` was recognized by `claude mcp list`, but h2a remained “Pending approval (run claude to approve)” in the fresh root; no h2a surface became callable. [Artifact](artifacts/host-cli-feature-matrix/A20-claude-h2a-mcp-list.txt) |
| C-L llm-mesh login | `NOT-TESTED (lane unavailable)` | Delegated `h2a_discover_sessions({scope:"scope:llm-mesh:claude"})` was denied by the environment's never-approval policy; no contract was guessed. [Artifact](artifacts/host-cli-feature-matrix/L00-claude-llm-mesh-delegation.txt) |
| C-O Loops | `NOT-TESTED (MCP pending approval)` | A separate `claude mcp list` again left h2a pending approval, so no loop/list/create objective-loop tool ran. [Artifact](artifacts/host-cli-feature-matrix/O00-claude-loop-surface.txt) |

### Codex

| Cell | State | Exercise and observed artifact |
|---|---|---|
| X-E Enrollment | `measured-OK` | `codex plugin marketplace add <repo> --json` exited 0, named marketplace `sentropic`, and wrote the native `[marketplaces.sentropic]` entry in the disposable `.codex/config.toml`. [Artifact](artifacts/host-cli-feature-matrix/E01-codex-marketplace-add.txt) |
| X-G Gateway | `measured-KO` | With only the llm-mesh Anthropic variables set, `codex exec --model gpt-5.4` selected provider `openai` and attempted `api.openai.com/v1/responses`, ending 401. [Artifact](artifacts/host-cli-feature-matrix/G01-codex-anthropic-base-url.txt) |
| X-M Model mapping | `measured-OK` | `codex exec --model gpt-5.4` printed `model: gpt-5.4` and `provider: openai` before the expected no-credential 401. Identifier acceptance and provider resolution occurred before transport failure. [Artifact](artifacts/host-cli-feature-matrix/M01-codex-model-selection.txt) |
| X-H Harness | `measured-OK` | Marketplace add, `codex plugin add h2a@sentropic --json`, and `plugin list --json` all exited 0; the plugin was installed and enabled from the local source in the disposable Codex root. [Artifact](artifacts/host-cli-feature-matrix/H01-codex-h2a-plugin-load.txt) |
| X-D Sub-agent | `NOT-TESTED (no child dispatched)` | `codex agents --help` exercised the shared app-server session browser only; it did not cause a model to spawn a task child. [Artifact](artifacts/host-cli-feature-matrix/D01-codex-subagent-surface.txt) |
| X-A A2A/h2a | `NOT-TESTED (configuration only)` | `codex mcp list` recognized h2a as enabled and reported auth `Unsupported`; no tool-list handshake or inbox action was observed. [Artifact](artifacts/host-cli-feature-matrix/A21-codex-h2a-mcp-list.txt) |
| X-L llm-mesh login | `NOT-TESTED (lane unavailable)` | The host-scoped h2a lane discovery was denied by the environment; no login contract was inferred. [Artifact](artifacts/host-cli-feature-matrix/L01-codex-llm-mesh-delegation.txt) |
| X-O Loops | `NOT-TESTED (tool not called)` | A separate native `codex mcp list` showed h2a enabled, but no `h2a_loop_*` call occurred. [Artifact](artifacts/host-cli-feature-matrix/O01-codex-loop-surface.txt) |

### AGY

| Cell | State | Exercise and observed artifact |
|---|---|---|
| A-E Enrollment | `measured-KO` | `agy plugin validate <repo>/packages/h2a` exited 1: AGY required `<package>/plugin.json`; h2a ships `.claude-plugin/plugin.json`. [Artifact](artifacts/host-cli-feature-matrix/E02-agy-plugin-validate.txt) |
| A-G Gateway | `NOT-TESTED (route not observable)` | With Anthropic llm-mesh variables, `agy --model gemini-3.7-flash --effort high --print ...` exited 0 and returned a response, but emitted no endpoint/provider trace. The run cannot prove whether the gateway variables were consumed. [Artifact](artifacts/host-cli-feature-matrix/G02-agy-anthropic-base-url.txt) |
| A-M Model mapping | `measured-OK` | `agy models` exited 0 and returned accepted concrete IDs, including `gemini-3.7-flash-{high,medium,low}`, `claude-sonnet-4-6`, and `gpt-oss-120b-medium`. [Artifact](artifacts/host-cli-feature-matrix/M02-agy-models.txt) |
| A-H Harness | `measured-KO` | A separate direct h2a package validation again exited 1 on the missing root `plugin.json`; no h2a plugin skills/hooks/commands loaded. [Artifact](artifacts/host-cli-feature-matrix/H08-agy-h2a-plugin-validation.txt) |
| A-D Sub-agent | `NOT-TESTED (no child dispatched)` | `agy agents` exited 0 with no listed agent and launched no child. [Artifact](artifacts/host-cli-feature-matrix/D02-agy-subagent-surface.txt) |
| A-A A2A/h2a | `NOT-TESTED (configuration only)` | `agy mcp list` recognized the seeded h2a stdio command as enabled, but did not connect or invoke a tool. [Artifact](artifacts/host-cli-feature-matrix/A22-agy-h2a-mcp-list.txt) |
| A-L llm-mesh login | `NOT-TESTED (lane unavailable)` | The delegated AGY lane query was denied; the login contract was not guessed. [Artifact](artifacts/host-cli-feature-matrix/L02-agy-llm-mesh-delegation.txt) |
| A-O Loops | `NOT-TESTED (tool not called)` | A separate `agy mcp list` showed h2a enabled, but no objective-loop operation ran. [Artifact](artifacts/host-cli-feature-matrix/O02-agy-loop-surface.txt) |

### OpenCode

| Cell | State | Exercise and observed artifact |
|---|---|---|
| O-E Enrollment | `measured-KO` | `opencode mcp list` against the h2a-rendered `{"mcpServers":...}` workspace config exited 1: `Unrecognized key: mcpServers`. [Artifact](artifacts/host-cli-feature-matrix/A24-opencode-rendered-mcp-list.txt) |
| O-G Gateway | `measured-KO` | With exactly `ANTHROPIC_BASE_URL` plus `ANTHROPIC_AUTH_TOKEN`, OpenCode did not activate a usable Anthropic model/provider and failed `ProviderModelNotFoundError`. The separate API-key exercise below proves the base URL itself works, isolating the llm-mesh auth-variable mismatch. [Artifact](artifacts/host-cli-feature-matrix/G03-opencode-anthropic-base-url.txt) |
| O-M Model mapping | `measured-OK` | With loopback `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY`, `opencode run --model anthropic/claude-sonnet-4-5` exited 0; the captured main request carried `claude-sonnet-4-5` (and title request `claude-haiku-4-5-20251001`). [Artifact](artifacts/host-cli-feature-matrix/M03-opencode-model-gateway-mock.txt) |
| O-H Harness | `measured-KO` | A separate load of the currently rendered h2a config failed before MCP startup on the same unrecognized `mcpServers` key. [Artifact](artifacts/host-cli-feature-matrix/H03-opencode-h2a-rendered-load.txt) |
| O-D Sub-agent | `measured-OK` | The loopback model returned a real `task` tool call with `subagent_type=explore`; OpenCode issued the child request, received `DELEGATION_OK`, resumed the parent, printed `parent-finished`, and exited 0. [Artifact](artifacts/host-cli-feature-matrix/D03-opencode-subagent.txt) |
| O-A A2A/h2a | `measured-OK` | Using OpenCode's native `{"mcp":{"h2a":{"type":"local","command":[...]}}}` shape, `opencode mcp list` launched the h2a child and reported `h2a connected`. No inbox envelope was sent in this cell. [Artifact](artifacts/host-cli-feature-matrix/A25-opencode-native-mcp-list.txt) |
| O-L llm-mesh login | `NOT-TESTED (lane unavailable)` | The delegated OpenCode lane query was denied; no login contract was inferred. [Artifact](artifacts/host-cli-feature-matrix/L03-opencode-llm-mesh-delegation.txt) |
| O-O Loops | `NOT-TESTED (tool not called)` | A separate native-shape exercise connected h2a, but did not invoke `h2a_loop_list/create/run`. [Artifact](artifacts/host-cli-feature-matrix/O03-opencode-loop-surface.txt) |

### Hermes

| Cell | State | Exercise and observed artifact |
|---|---|---|
| H-E Enrollment | `measured-OK` | `hermes mcp add h2a --command ... --args hermes` connected, found 52 tools, enabled all, and wrote the disposable `~/.hermes/config.yaml`. [Artifact](artifacts/host-cli-feature-matrix/E08-hermes-h2a-enrollment.txt) |
| H-G Gateway | `NOT-TESTED (provider dependency absent)` | An Anthropic-provider exercise with the llm-mesh variables exited 1 before routing because this Hermes install lacks the Python `anthropic` package. [Artifact](artifacts/host-cli-feature-matrix/G04-hermes-anthropic-base-url.txt) |
| H-M Model mapping | `NOT-TESTED (provider dependency absent)` | `--provider anthropic --model anthropic/claude-sonnet-4.6` reached the same missing-package gate; no request proved resolution. [Artifact](artifacts/host-cli-feature-matrix/M04-hermes-model-resolution.txt) |
| H-H Harness | `measured-OK` | After seeding h2a under the disposable native `~/.hermes/skills/h2a`, `hermes skills list` exited 0 and listed `h2a`, source `local`, state `enabled`. [Artifact](artifacts/host-cli-feature-matrix/H04-hermes-h2a-skill-load.txt) |
| H-D Sub-agent | `NOT-TESTED (no MoA run)` | `hermes moa --help` exposed model-slot configuration for `/moa`, but no provider-backed MoA/sub-agent run occurred. [Artifact](artifacts/host-cli-feature-matrix/D04-hermes-subagent-surface.txt) |
| H-A A2A/h2a | `measured-OK` | Native MCP add actually connected and discovered 52 tools, including `h2a_inbox`, session/discovery, conductor, run, and loop tools; all were enabled. No envelope delivery was attempted. [Artifact](artifacts/host-cli-feature-matrix/A26-hermes-h2a-mcp-add.txt) |
| H-L llm-mesh login | `NOT-TESTED (lane unavailable)` | The delegated Hermes lane query was denied; no login contract was inferred. [Artifact](artifacts/host-cli-feature-matrix/L04-hermes-llm-mesh-delegation.txt) |
| H-O Loops | `NOT-TESTED (tools discovered only)` | A separate MCP add found and enabled `h2a_loop_create/join/report/done/stop/list/status`, but did not call one. [Artifact](artifacts/host-cli-feature-matrix/O04-hermes-loop-surface.txt) |

### Gemini CLI

| Cell | State | Exercise and observed artifact |
|---|---|---|
| G-E Enrollment | `measured-OK` | `gemini skills install <repo>/packages/h2a/skills/h2a --scope workspace` exited 0 and wrote `.gemini/skills/h2a/SKILL.md` in the disposable workspace. [Artifact](artifacts/host-cli-feature-matrix/E03-gemini-skill-install.txt) |
| G-G Gateway | `measured-KO` | With the llm-mesh Anthropic variables, Gemini exited 41 asking for Gemini/Google authentication; the exact llm-mesh variables did not make a request routable. [Artifact](artifacts/host-cli-feature-matrix/G05-gemini-anthropic-base-url.txt) |
| G-M Model mapping | `NOT-TESTED (authentication stopped request)` | `gemini --model gemini-3-flash-preview` was parsed, then exited 41 before a request; no resolved model request was captured. [Artifact](artifacts/host-cli-feature-matrix/M05-gemini-model-selection.txt) |
| G-H Harness | `measured-KO` | Install succeeded, but the immediate native `gemini skills list --all` omitted h2a and stderr said project agents and hooks were skipped because the disposable folder was untrusted. [Artifact](artifacts/host-cli-feature-matrix/H05-gemini-h2a-skill-load.txt) |
| G-D Sub-agent | `NOT-TESTED (no child launch surface exercised)` | A separate complete binary help exercise exposed no child launch that could be run without a model turn; no child was observed. [Artifact](artifacts/host-cli-feature-matrix/D05-gemini-subagent-surface.txt) |
| G-A A2A/h2a | `measured-KO` | `gemini mcp list` recognized h2a but explicitly disabled it because the folder was untrusted. [Artifact](artifacts/host-cli-feature-matrix/A23-gemini-h2a-mcp-list.txt) |
| G-L llm-mesh login | `NOT-TESTED (lane unavailable)` | The delegated Gemini lane query was denied; no login contract was inferred. [Artifact](artifacts/host-cli-feature-matrix/L05-gemini-llm-mesh-delegation.txt) |
| G-O Loops | `NOT-TESTED (MCP disabled)` | A separate MCP listing again reported h2a disabled; no loop operation ran. [Artifact](artifacts/host-cli-feature-matrix/O05-gemini-loop-surface.txt) |

### Mistral Vibe

| Cell | State | Exercise and observed artifact |
|---|---|---|
| V-E Enrollment | `NOT-TESTED (API key gate)` | `vibe --agent h2a --prompt ...` reached the missing `MISTRAL_API_KEY` gate before proving that an h2a custom-agent artifact was recognized. [Artifact](artifacts/host-cli-feature-matrix/E07-vibe-h2a-agent.txt) |
| V-G Gateway | `measured-KO` | With only `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`, Vibe exited 1 requesting `MISTRAL_API_KEY`; the llm-mesh variables did not satisfy its default Mistral route. [Artifact](artifacts/host-cli-feature-matrix/G06-vibe-anthropic-base-url.txt) |
| V-M Model mapping | `NOT-TESTED (API key gate)` | `VIBE_ACTIVE_MODEL=matrix-model vibe --prompt ...` exited at missing Mistral API key before emitting a resolved request. [Artifact](artifacts/host-cli-feature-matrix/M06-vibe-model-selection.txt) |
| V-H Harness | `NOT-TESTED (API key gate)` | h2a was seeded in the native Agent Skills-standard `.agents/skills/h2a` path, but the Vibe turn stopped at missing API key before a skill load could be observed. [Artifact](artifacts/host-cli-feature-matrix/H06-vibe-h2a-skill-load.txt) |
| V-D Sub-agent | `NOT-TESTED (API key gate)` | A custom-agent selection exercise stopped at missing API key and launched no child. [Artifact](artifacts/host-cli-feature-matrix/D06-vibe-subagent-surface.txt) |
| V-A A2A/h2a | `NOT-TESTED (no h2a transport exercised)` | Full `vibe --help` showed programmatic/custom-agent and tool controls but no native MCP/h2a command; without an authenticated skill turn, that absence is not promoted to a capability failure. [Artifact](artifacts/host-cli-feature-matrix/A28-vibe-h2a-surface.txt) |
| V-L llm-mesh login | `NOT-TESTED (lane unavailable)` | The delegated Vibe lane query was denied; no login contract was inferred. [Artifact](artifacts/host-cli-feature-matrix/L06-mistral-vibe-llm-mesh-delegation.txt) |
| V-O Loops | `NOT-TESTED (API key gate)` | `vibe --prompt 'h2a loop list'` stopped at missing Mistral API key; no objective-loop action ran. [Artifact](artifacts/host-cli-feature-matrix/O06-vibe-loop-surface.txt) |

### Meta Muse Code

| Cell | State | Exercise and observed artifact |
|---|---|---|
| M-E Enrollment | `measured-OK` | `muse init` exited 0 and wrote a disposable workspace `AGENTS.md`, the project-rules artifact Muse says it reads. [Artifact](artifacts/host-cli-feature-matrix/E05-muse-init.txt) |
| M-G Gateway | `NOT-TESTED (echo provider bypassed routing)` | With llm-mesh variables present, `muse exec --provider echo` returned `echo: gateway probe`; echo deliberately performs no Meta/Anthropic routing. [Artifact](artifacts/host-cli-feature-matrix/G07-muse-anthropic-base-url.txt) |
| M-M Model mapping | `NOT-TESTED (Meta provider not authenticated)` | `muse exec --provider echo --model matrix-model` exited 2 because `--model` requires provider `meta`; no authenticated Meta request was made. [Artifact](artifacts/host-cli-feature-matrix/M07-muse-model-selection.txt) |
| M-H Harness | `measured-OK` | Native `muse skills install ... --scope user --json`, followed immediately by `skills list --source user --enabled-only --json`, exited 0 and listed enabled skill `h2a` at `$CONFIG_DIR/skills/h2a/SKILL.md`. [Artifact](artifacts/host-cli-feature-matrix/H07-muse-h2a-skill-load.txt) |
| M-D Sub-agent | `NOT-TESTED (echo provider did not launch child)` | An ephemeral `--agents` overlay was accepted, but the echo provider returned the prompt literally; no child request occurred. [Artifact](artifacts/host-cli-feature-matrix/D07-muse-subagent-surface.txt) |
| M-A A2A/h2a | `measured-KO` | A real `muse session-message serve` plus socket-send exercise could not create its socket: `local session messaging is unavailable for this session: the local_session_messaging gate is closed`. The exercised Muse CLI also has no h2a MCP command. [Artifact](artifacts/host-cli-feature-matrix/A27-muse-session-message.txt) |
| M-L llm-mesh login | `NOT-TESTED (lane unavailable)` | The delegated Muse lane query was denied; no login contract was inferred. [Artifact](artifacts/host-cli-feature-matrix/L07-muse-llm-mesh-delegation.txt) |
| M-O Loops | `NOT-TESTED (echo provider only echoed)` | `muse exec --provider echo 'h2a loop list'` returned that text and performed no loop action. [Artifact](artifacts/host-cli-feature-matrix/O07-muse-loop-surface.txt) |

### Z.AI

The same official-source conclusion applies to each cell: no official Z.AI agent CLI was identified, and the baseline command found no `zcode`, `zai`, or `z-ai` binary. Each cell still has its own absence exercise, as required.

| Cell | State | Exercise and observed artifact |
|---|---|---|
| Z-E Enrollment | `not-applicable` | Official ZCode is an ADE, not a measured host CLI; binary absence exited 127. [Artifact](artifacts/host-cli-feature-matrix/Z00-zai-axis-1.txt) |
| Z-G Gateway | `not-applicable` | No official host CLI exists to consume a gateway variable; binary absence exited 127. [Artifact](artifacts/host-cli-feature-matrix/Z01-zai-axis-2.txt) |
| Z-M Model mapping | `not-applicable` | No official host CLI model parser exists to exercise; binary absence exited 127. [Artifact](artifacts/host-cli-feature-matrix/Z02-zai-axis-3.txt) |
| Z-H Harness | `not-applicable` | No official host CLI harness surface exists to exercise; binary absence exited 127. [Artifact](artifacts/host-cli-feature-matrix/Z03-zai-axis-4.txt) |
| Z-D Sub-agent | `not-applicable` | No official host CLI child-launch surface exists to exercise; binary absence exited 127. [Artifact](artifacts/host-cli-feature-matrix/Z04-zai-axis-5.txt) |
| Z-A A2A/h2a | `not-applicable` | No official host CLI h2a surface exists to exercise; binary absence exited 127. [Artifact](artifacts/host-cli-feature-matrix/Z05-zai-axis-6.txt) |
| Z-L llm-mesh login | `not-applicable` | No official host CLI login exists. The delegated lane query was also denied, but no CLI contract is needed for this classification. [Absence artifact](artifacts/host-cli-feature-matrix/Z06-zai-axis-7.txt), [delegation artifact](artifacts/host-cli-feature-matrix/L08-z-ai-llm-mesh-delegation.txt) |
| Z-O Loops | `not-applicable` | No official host CLI loop surface exists to exercise; binary absence exited 127. [Artifact](artifacts/host-cli-feature-matrix/Z07-zai-axis-8.txt) |

## Register of NOT-TESTED cells

This register is intentionally explicit; these are the next exercises, not inferred gaps.

| Cells | Why they remain NOT-TESTED | What would close them |
|---|---|---|
| C-D, X-D, A-D, H-D, G-D, V-D, M-D | Help/surface or echo exercises did not launch and observe a child. | A provider-backed deterministic model response that requests the host's child tool, plus captured child output and exit. |
| X-A, A-A | Native configuration was listed, but no MCP handshake/tool invocation was recorded. | Force a harmless `h2a_discover_sessions` or disposable inbox action through the host. |
| A-G | AGY returned a model response without an endpoint/provider trace. | A supported loopback base URL or host trace proving the destination and auth variable. |
| H-G, H-M | Hermes failed before routing/model resolution because its Anthropic provider dependency is absent. | Repeat in an official Hermes install containing the Anthropic extra, still under a disposable root. |
| G-M | Gemini authentication stopped before any resolved request. | A loopback/provider credential accepted by Gemini, with captured request model. |
| V-E, V-M, V-H, V-D, V-O | Vibe stopped at `MISTRAL_API_KEY`; the seeded skill/custom-agent paths were not observed in a model turn. | A disposable Mistral credential or supported loopback provider and captured prompt/tool trace. |
| V-A | Full binary help exposed no MCP command, but an authenticated h2a skill turn was not run. | An authenticated turn proving or disproving h2a coordination through Vibe's skill/tool system. |
| M-G, M-M, M-D, M-O | The deterministic echo provider bypasses routing and tool/sub-agent execution; Meta was not authenticated. | A disposable Meta credential plus loopback/captured tool-call exercises. |
| C-O, X-O, A-O, O-O, H-O, G-O | MCP was pending, merely listed, connected, tool-discovered, or disabled; no objective-loop tool was actually called. | A host-driven `h2a_loop_create` followed by `list/status` in a disposable h2a root. |
| C-L, X-L, A-L, O-L, H-L, G-L, V-L, M-L | Coordination was correctly delegated, but all eight h2a lane discoveries returned `MCP tool call requires approval, but approval policy is never`. | A response from the llm-mesh lane defining its login contract, followed by host-specific exercises. |

## What this matrix does not cover

- It does not validate overall host support, production readiness, or end-to-end multi-host delivery. It records narrow exercises at the versions above.
- It does not cover Windows/macOS, interactive TTY approval flows, cloud/CI hosts, older owner-observed versions, upgrades/migrations, performance, cost, token use, quality, reliability, or security posture.
- It does not test production llm-mesh login because the delegated lane was unavailable. No contract was reverse-engineered.
- It does not claim inbox delivery where only an MCP connection or tool list was observed, nor loop execution where only loop tools were discovered.
- It does not exercise long-running drumbeats, relaunch, stop hooks, wake transport, objective-loop ticks, or conductor behavior. Those cells stay NOT-TESTED.
- It does not use or mutate the owner's real host configuration roots. It also does not validate host package installation channels beyond the official-source gate for Mistral, Muse and Z.AI.
- It does not cover ZCode as a desktop ADE or `@z_ai/coding-helper` as a configurator for other CLIs; neither is an official Z.AI host agent CLI for this matrix.

## Work performed versus simple observations

The material work was the disposable-root/fingerprint runner; publisher-source gate; Claude and OpenCode loopback request capture; OpenCode's forced, observed sub-agent round trip; native h2a MCP handshakes; plugin/skill install-and-list exercises; and the rendered-versus-native OpenCode configuration comparison. Simple observations were version/help output and the Z.AI binary-absence checks. Neither class is promoted beyond what its artifact proves.

This document is a measured matrix, not a validation or a declaration that the host integrations are complete.

[C-E]: artifacts/host-cli-feature-matrix/E00-claude-plugin-validate.txt
[C-G]: artifacts/host-cli-feature-matrix/M00-claude-model-gateway-mock.txt
[C-M]: artifacts/host-cli-feature-matrix/M08-claude-model-alias.txt
[C-H]: artifacts/host-cli-feature-matrix/H00-claude-h2a-plugin-load.txt
[C-D]: artifacts/host-cli-feature-matrix/D00-claude-subagent-surface.txt
[C-A]: artifacts/host-cli-feature-matrix/A20-claude-h2a-mcp-list.txt
[C-L]: artifacts/host-cli-feature-matrix/L00-claude-llm-mesh-delegation.txt
[C-O]: artifacts/host-cli-feature-matrix/O00-claude-loop-surface.txt
[X-E]: artifacts/host-cli-feature-matrix/E01-codex-marketplace-add.txt
[X-G]: artifacts/host-cli-feature-matrix/G01-codex-anthropic-base-url.txt
[X-M]: artifacts/host-cli-feature-matrix/M01-codex-model-selection.txt
[X-H]: artifacts/host-cli-feature-matrix/H01-codex-h2a-plugin-load.txt
[X-D]: artifacts/host-cli-feature-matrix/D01-codex-subagent-surface.txt
[X-A]: artifacts/host-cli-feature-matrix/A21-codex-h2a-mcp-list.txt
[X-L]: artifacts/host-cli-feature-matrix/L01-codex-llm-mesh-delegation.txt
[X-O]: artifacts/host-cli-feature-matrix/O01-codex-loop-surface.txt
[A-E]: artifacts/host-cli-feature-matrix/E02-agy-plugin-validate.txt
[A-G]: artifacts/host-cli-feature-matrix/G02-agy-anthropic-base-url.txt
[A-M]: artifacts/host-cli-feature-matrix/M02-agy-models.txt
[A-H]: artifacts/host-cli-feature-matrix/H08-agy-h2a-plugin-validation.txt
[A-D]: artifacts/host-cli-feature-matrix/D02-agy-subagent-surface.txt
[A-A]: artifacts/host-cli-feature-matrix/A22-agy-h2a-mcp-list.txt
[A-L]: artifacts/host-cli-feature-matrix/L02-agy-llm-mesh-delegation.txt
[A-O]: artifacts/host-cli-feature-matrix/O02-agy-loop-surface.txt
[O-E]: artifacts/host-cli-feature-matrix/A24-opencode-rendered-mcp-list.txt
[O-G]: artifacts/host-cli-feature-matrix/G03-opencode-anthropic-base-url.txt
[O-M]: artifacts/host-cli-feature-matrix/M03-opencode-model-gateway-mock.txt
[O-H]: artifacts/host-cli-feature-matrix/H03-opencode-h2a-rendered-load.txt
[O-D]: artifacts/host-cli-feature-matrix/D03-opencode-subagent.txt
[O-A]: artifacts/host-cli-feature-matrix/A25-opencode-native-mcp-list.txt
[O-L]: artifacts/host-cli-feature-matrix/L03-opencode-llm-mesh-delegation.txt
[O-O]: artifacts/host-cli-feature-matrix/O03-opencode-loop-surface.txt
[H-E]: artifacts/host-cli-feature-matrix/E08-hermes-h2a-enrollment.txt
[H-G]: artifacts/host-cli-feature-matrix/G04-hermes-anthropic-base-url.txt
[H-M]: artifacts/host-cli-feature-matrix/M04-hermes-model-resolution.txt
[H-H]: artifacts/host-cli-feature-matrix/H04-hermes-h2a-skill-load.txt
[H-D]: artifacts/host-cli-feature-matrix/D04-hermes-subagent-surface.txt
[H-A]: artifacts/host-cli-feature-matrix/A26-hermes-h2a-mcp-add.txt
[H-L]: artifacts/host-cli-feature-matrix/L04-hermes-llm-mesh-delegation.txt
[H-O]: artifacts/host-cli-feature-matrix/O04-hermes-loop-surface.txt
[G-E]: artifacts/host-cli-feature-matrix/E03-gemini-skill-install.txt
[G-G]: artifacts/host-cli-feature-matrix/G05-gemini-anthropic-base-url.txt
[G-M]: artifacts/host-cli-feature-matrix/M05-gemini-model-selection.txt
[G-H]: artifacts/host-cli-feature-matrix/H05-gemini-h2a-skill-load.txt
[G-D]: artifacts/host-cli-feature-matrix/D05-gemini-subagent-surface.txt
[G-A]: artifacts/host-cli-feature-matrix/A23-gemini-h2a-mcp-list.txt
[G-L]: artifacts/host-cli-feature-matrix/L05-gemini-llm-mesh-delegation.txt
[G-O]: artifacts/host-cli-feature-matrix/O05-gemini-loop-surface.txt
[V-E]: artifacts/host-cli-feature-matrix/E07-vibe-h2a-agent.txt
[V-G]: artifacts/host-cli-feature-matrix/G06-vibe-anthropic-base-url.txt
[V-M]: artifacts/host-cli-feature-matrix/M06-vibe-model-selection.txt
[V-H]: artifacts/host-cli-feature-matrix/H06-vibe-h2a-skill-load.txt
[V-D]: artifacts/host-cli-feature-matrix/D06-vibe-subagent-surface.txt
[V-A]: artifacts/host-cli-feature-matrix/A28-vibe-h2a-surface.txt
[V-L]: artifacts/host-cli-feature-matrix/L06-mistral-vibe-llm-mesh-delegation.txt
[V-O]: artifacts/host-cli-feature-matrix/O06-vibe-loop-surface.txt
[M-E]: artifacts/host-cli-feature-matrix/E05-muse-init.txt
[M-G]: artifacts/host-cli-feature-matrix/G07-muse-anthropic-base-url.txt
[M-M]: artifacts/host-cli-feature-matrix/M07-muse-model-selection.txt
[M-H]: artifacts/host-cli-feature-matrix/H07-muse-h2a-skill-load.txt
[M-D]: artifacts/host-cli-feature-matrix/D07-muse-subagent-surface.txt
[M-A]: artifacts/host-cli-feature-matrix/A27-muse-session-message.txt
[M-L]: artifacts/host-cli-feature-matrix/L07-muse-llm-mesh-delegation.txt
[M-O]: artifacts/host-cli-feature-matrix/O07-muse-loop-surface.txt
[Z-E]: artifacts/host-cli-feature-matrix/Z00-zai-axis-1.txt
[Z-G]: artifacts/host-cli-feature-matrix/Z01-zai-axis-2.txt
[Z-M]: artifacts/host-cli-feature-matrix/Z02-zai-axis-3.txt
[Z-H]: artifacts/host-cli-feature-matrix/Z03-zai-axis-4.txt
[Z-D]: artifacts/host-cli-feature-matrix/Z04-zai-axis-5.txt
[Z-A]: artifacts/host-cli-feature-matrix/Z05-zai-axis-6.txt
[Z-L]: artifacts/host-cli-feature-matrix/Z06-zai-axis-7.txt
[Z-O]: artifacts/host-cli-feature-matrix/Z07-zai-axis-8.txt
