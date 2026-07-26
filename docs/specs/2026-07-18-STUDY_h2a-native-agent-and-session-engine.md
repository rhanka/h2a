# STUDY — The h2a native agent and the sentropic session engine

Date: 2026-07-18
Rung: **STUDY** — records an owner-settled design target, requirements, options and
recommendations; no runtime implementation is made here.
Compatibility status: **owner-approved breaking CLI change.** This study does not claim
conformance with the frozen no-argv behavior in DEC-034 or the current required-profile
`h2a run <profile>` grammar. It specifies their coordinated successor contract and the
migration needed to reach it.
Backbone: `docs/specs/2026-07-13-SPEC_STUDY_native-agent-via-sentropic.md` (WP13).

## 0. What this study is about

The h2a CLI lane is not "a nicer command map". Its real object is:

> **Build the equivalent of Claude Code / Codex / Hermes / agy: a native h2a agent.**
> Bare `h2a` and exact, no-profile `h2a run` both start the native interactive agent —
> the complete LLM↔tool session loop. `h2a run native` is the explicit equivalent, at
> the same level of loop quality and option surface as `claude`, `codex` or `hermes`,
> able to use **every llm-mesh model** through the gateway.

Two hard constraints frame everything below:

1. **The session engine is sentropic's.** h2a does not build its own loop runtime; it
   coordinates sentropic for session creation, attachment, resume and observation
   (2026-07-13 STUDY, owner-settled D3 = "own the loop", option B: a *sentropic-owned
   agent-loop runtime over the existing gateway*).
2. **The engine must exceed sentropic's current code engine** (owner requirement,
   2026-07-18). "Reuse what exists" is not the bar; the bar is the best-in-class state of
   the art (§3). The h2a↔sentropic contract therefore carries a **capability requirements
   list** (§4), not just an integration surface. Sentropic stays the owner of *how*; h2a
   states the *what* — every such requirement is marked **to co-validate with sentropic**.

The v1 STUDY (`2026-07-17-STUDY_h2a-cli-coconception.md`) remains useful as source
material for unaffected verbs and information architecture. It is **not** the governing
contract for the two empty-dispatch forms below. A successor DEC must explicitly replace
DEC-034 for those forms and replace the structured-runtime required-profile rule; both
changes ship atomically in a coordinated major, not as two preservation-compatible
exceptions.

## Owner decision (2026-07-18)

The owner approves these breaking target semantics:

- bare, no-argv `h2a` starts the native interactive agent;
- exact, zero-operand `h2a run` starts that same native interactive agent;
- `h2a run native` is the explicit equivalent and owns option-bearing/headless native
  forms;
- help is explicit: `h2a help` and `h2a --help`; `h2a run --help` is preserved; and
- every vendor profile remains explicit (`h2a run claude`, `h2a run codex`, etc.).

This is deliberately incompatible with two public behaviors today: bare `h2a` prints
help and exits 0, while exact `h2a run` is rejected because `<profile>` is required. It
also removes implicit vendor selection. It must never be described as preserving the
frozen CLI contract.

**Runtime selection invariant: `native` is the sole implicit runtime.** Every vendor or
host-adapter profile remains explicit — for example `h2a run claude`, `h2a run codex`,
`h2a run gemini` or `h2a run agy`. h2a never infers or defaults a vendor from
configuration, workspace contents, installed executables/PATH, prior use, a model or
provider identifier, or an interactive profile picker.

Model/provider identifiers are mesh intent *inside* a selected native session, never
host-adapter selectors. Selector-less option forms such as `h2a run --model …`,
`h2a run --headless`, `h2a run --json` and `h2a run --` are usage errors; only exact
`argv = ["run"]` is an implicit native selection. Changing that grammar later requires a
new explicit decision.

### Deterministic dispatch precedence and safety

The classifier is ordered and evaluated before any generic fallback. “None” in the last
column means no optional runtime import, config migration, PATH/profile probing, network
call, engine probe or session creation. `stdin` and `stdout` must both be TTYs for an
interactive native form; redirected `stderr` alone does not make it noninteractive.

| Priority | Invocation / condition | Outcome | Exit | Pre-session side effects |
|---:|---|---|---:|---|
| 1 | `h2a help`, `h2a --help`; compatibility `h2a -h` | Top-level help | 0 | None |
| 2 | `h2a run --help`; compatibility `h2a run -h` | Run help, intercepted by the core front before the lazy runtime boundary | 0 | None |
| 3 | Existing non-run core/meta verb, including version | Existing core behavior | Existing contract | Existing contract |
| 4 | Recognized existing non-run heavy-runtime verb (`ls`, `attach`, `stop`, `resume`, `delegate`, `jobs`, `workspace`, `install`, etc.) | Existing lazy-runtime dispatch and command contract | Existing contract | Existing runtime behavior |
| 5 | `h2a run <known-vendor-or-retained-explicit-alias> …` or a retained direct vendor alias | Existing named PTY/vendor adapter; never native | Adapter/child result | Existing vendor behavior only |
| 6 | `h2a run native …` | Native grammar; interactive when no machine/headless form is explicit | See below | Readiness before creation |
| 7 | exact bare `h2a` or exact `h2a run` | Same implicit native interactive flow, subject to the compatibility and automation guards below | See below | Readiness before creation |
| 8 | `h2a run --<non-help-option>` or `h2a run --` without a selector | Usage error; diagnostic on stderr, no stdout | 1 | None |
| 9 | Unknown `run` selector | Usage error; never executable, native, vendor or help fallback | 1 after a compatible lazy boundary; otherwise 64/127 | Runtime parser resolution only; no config/launch |
| 10 | Unknown top-level verb | Runtime parser usage error; never an executable/native/vendor fallback | 1 after a compatible lazy boundary; otherwise 64/127 | Runtime parser resolution only; no config/launch |

Priority 4 preserves `bin-routing.ts::shouldDispatchRuntime`'s deliberate non-core
fallback rather than introducing a drifting core allowlist. The optional runtime remains
the authority that recognizes its existing non-run verbs or rejects an unknown verb, but
the successor parser must classify argv **before** runtime `main` migrates config. Module
resolution/API checks may therefore occur for rows 4, 9 and 10; unknown grammar cannot
migrate config or start anything. Help, selector-less options and implicit automation
guards remain core-owned and do not cross that boundary.

Current canonical vendor profiles (`claude`, `codex`, `agy`, `gemini`, `mistral`,
`opencode`, `shell`), current profile aliases (`claude-code`, `antigravity`, `gemini-cli`,
`mistralcli`) and current direct vendor commands remain explicit compatibility routes in
the successor major unless separately deprecated. The current ordinary-run fallback
`LOCAL_CLI[profile] ?? profile` can execute an arbitrary unknown token
(`packages/h2a-runtime/src/index.ts`, `localCliCommand`); target row 9 deliberately removes
that unsafe fallback. That is an additional structured-runtime breaking safety change and
must be itemized and ratified in the successor DEC. If custom adapters remain supported,
the EVOL must give them an unambiguous configured/custom selector rather than treating a
typo as an executable.

For exact bare `h2a` and exact `h2a run`, the following sub-precedence is mandatory:

1. During the first successor major only, `H2A_LEGACY_EMPTY_DISPATCH=1` restores the
   previous per-invocation result before any import: bare `h2a` prints help and exits 0;
   exact `h2a run` emits the former missing-profile diagnostic and exits 1. It never
   launches an agent. Remove this migration escape hatch in the next major.
2. A nonempty standard automation marker (`CI`) refuses implicit native even under a
   pseudo-TTY. Without `CI`, both `stdin.isTTY` and `stdout.isTTY` must be true. Refusal
   writes one actionable diagnostic to stderr, writes nothing to stdout, exits 1, and
   points to `h2a help`, `h2a run --help`, or an explicit native headless form. It does
   not fall back to help because silently changing an automation failure into success is
   unsafe.
3. Only after those guards may the front validate the optional runtime and perform a
   side-effect-free native capability/readiness probe. A missing optional
   `@sentropic/h2a-runtime` retains exit 127; an incompatible runtime CLI API retains exit
   64 (`packages/h2a/src/bin.ts`, `dispatchRuntime`). A compatible runtime with no usable
   native engine/capability, failed authentication/placement, or rejected admission
   emits an actionable diagnostic, exits 2, creates no session, and never falls back to
   help, a vendor, an arbitrary executable or the historical profile picker.
4. A successful probe feeds all three forms the same normalized native launch intent and
   only then creates or attaches the session.

`h2a run native` uses the same readiness and no-fallback rules. Its interactive form also
requires both TTYs and exits 1 before readiness when that guard fails; non-TTY execution
is allowed only by an explicit machine/headless grammar (for example the target
`h2a run native -p "<prompt>"`), never merely because input was piped. `CI` blocks the two
implicit forms only: an explicit `h2a run native` is deliberate and remains allowed in CI
when its interactive TTY or headless grammar is satisfied.

### Exit semantics

The successor keeps DEC-034's small public taxonomy where it applies and preserves
already-observable loader codes:

| Exit | Target meaning |
|---:|---|
| 0 | Help/version, clean native completion, or an explicit in-session quit |
| 1 | Usage/selector error or interactive safety refusal (non-TTY/`CI`) |
| 2 | Native readiness, authentication/admission, engine state/protocol, policy, budget or other runtime failure; structured output carries the exact reason |
| 3 | Local I/O or OS failure |
| 64 | Core/runtime CLI API incompatibility at the existing lazy boundary |
| 127 | Missing optional runtime package at the existing lazy boundary |
| `128 + signal` | Signal termination; for example SIGINT = 130 |

Explicit vendor adapters continue to return their current adapter/child result rather
than being normalized into the native table (`packages/h2a-runtime/src/index.ts`,
`runProfile`, assigns `result.exit.exitCode` to `process.exitCode`). The EVOL must freeze the sentropic
stop-reason-to-exit mapping before implicit cutover; until §5 supplies that taxonomy,
“runtime failure = 2 plus a structured reason” is the compatibility floor.

### Grounding (verified in this checkout, 2026-07-18)

- `packages/h2a/src/cli.ts`, `runCli`, currently maps empty argv, `--help`, `-h` and
  `help` to top-level help and exit 0. `packages/h2a/src/cli-contract.ts` (DEC-034) names
  no argv as help, publishes exits 0–3, and requires a new DEC plus a major version for a
  breaking change. This study invokes that gate; it does not waive it.
- `packages/h2a/src/bin-routing.ts`, `shouldDispatchRuntime`, currently leaves empty argv
  in the core but sends first-word `run` through the optional-runtime boundary.
  `resolveH2aRuntimeDispatch` checks `H2A_RUNTIME_CLI_API_VERSION = 1` before runtime
  state operations. `packages/h2a/src/bin.ts`, `dispatchRuntime`, returns 127 when the
  optional runtime package is absent and 64 when its CLI API is incompatible.
- Today `h2a run <profile>` spawns a vendor CLI in tmux through a host adapter, with
  `--headless`, `--resume <convId>`, `--model`, `--effort`, `--count`, `--json` and
  `--llm-gateway|--no-llm-gateway`. The parser declares
  `.command("run <profile> [path]")` (`packages/h2a-runtime/src/index.ts`); exact
  `h2a run` exits 1 with `missing required argument 'profile'`. There is **no native
  loop**. Because `run` crosses the lazy boundary today, `h2a run --help` loads runtime
  parsing, and runtime `main(argv)` performs config migration before Commander parses
  help. The target's core-owned help precedence intentionally removes those side effects.
- The exported runtime dispatcher `main(argv)` / `dispatchH2a` also has a historical
  direct-entry no-argv TTY path that opens an interactive vendor-profile menu
  (`packages/h2a-runtime/src/index.ts`, `profile-menu.ts`, `shouldShowProfileMenu`). It is
  not a separately packaged h2a-runtime binary, and it is not the current exact
  `h2a run` path. The target retires it separately as an implicit selector: no empty form
  may choose a vendor through a prompt.
- `packages/h2a-runtime/src/run.ts`: the structured run contract is a **PTY spawner** —
  `RunOptions {profile, resume, cwd, env, startupArgs…}` → `RunResult {sessionId, port,
  exit, stop}`, with `terminal.output` event envelopes broadcast over an in-process
  Hono/SSE/WS control plane. This is transport, not an agent loop.
- The owner has settled two breaking implicit-dispatch changes: bare `h2a` and exact
  `h2a run` enter one native flow, with `h2a run native` as its explicit spelling. Both
  require the successor DEC, coordinated `@sentropic/h2a` and
  `@sentropic/h2a-runtime` major releases, and a runtime CLI capability bump so mixed
  package versions fail before launch rather than disagree about argv. Other named core
  verbs and recognized explicit vendor routes remain out of scope for semantic change;
  the arbitrary unknown-executable fallback is the separately disclosed safety break
  above.
- The 2026-07-13 STUDY (quoted above) settled: the loop in scope is the **agent LLM/tool
  loop inside a session** (loop #2), not the conductor loop (#1 = WP3) nor process
  supervision (#3); "native agent" = a sentropic-owned runtime calling the existing
  gateway; a session = *runtime + checkpointed context*, so placement/move =
  re-instantiate from context, never PTY migration.
- `remote/docs/specs/2026-06-26-llm-gateway-capitalization-model-routing.md` (present in
  the sibling `remote` checkout, not in this repo): gateway/mesh own provider transports,
  account pools, sticky policy, the **model catalog** (`/v1/models`) and the audit ledger;
  `claude --bare --model gpt-5.5` through the gateway is verified there. h2a never owns
  routing.
- Gateway 0.9 / mesh 0.8 are integrated on this branch (`feat/llm-gateway-0.9-integration`,
  commit e891c32 "consume llm-gateway 0.9.0 and onboard the Gemini provider").

## 1. The target in one picture

```
 ┌──────────────────────────── h2a (this repo) ─────────────────────────────┐
 │  h2a (bare → native) / h2a run (no profile → native), eligible TTY      │
 │  h2a run native (explicit) · ls · attach · resume · logs · stop         │
 │  · delegate                                                             │
 │  vendors (explicit): h2a run claude · h2a run codex · …                 │
 │  help (explicit): h2a help · h2a --help · h2a run --help                │
 │  session descriptor (client rep) · h2a protocol/inbox · governance      │
 └───────────────┬──────────────────────────────────────────────────────────┘
                 │  Session-creation seam (§5): SessionLaunchIntent →
                 │  SessionProjection + lifecycle ops (idempotent, fenced)
 ┌───────────────▼──────────────── sentropic ───────────────────────────────┐
 │  SESSION ENGINE (owned by sentropic, required capabilities §4):         │
 │   event-sourced session log · LLM↔tool loop · checkpoints/fork ·        │
 │   compaction · subagents · permission gate · hooks · budgets ·          │
 │   stop-reason taxonomy · replayable streams · sandboxed tool exec       │
 └───────────────┬──────────────────────────────────────────────────────────┘
                 │  Messages/stream calls (existing product boundary)
 ┌───────────────▼──────────────── llm-gateway / llm-mesh ──────────────────┐
 │  provider transports · account pools · model catalog (/v1/models) ·     │
 │  routing/sticky/failover · session ledger · audit                       │
 └──────────────────────────────────────────────────────────────────────────┘
```

Three layers, three owners, no duplication: h2a fronts and coordinates; sentropic runs
the loop; the gateway routes models. `h2a run native --model <any-mesh-model>` works
because the engine calls the gateway and the gateway resolves the catalog — h2a passes
intent through (§6). Explicit `h2a run <vendor-profile> …` exits this picture through the
existing PTY/vendor adapter; it never enters the sentropic native-session seam.

## 2. What exists today (honest baseline)

| Layer | Today | Consequence |
|---|---|---|
| h2a front | Explicit `h2a run <profile>` = tmux/PTY launcher for vendor CLIs; exact `h2a run` = missing-profile error; exported runtime `main` has a separate historical no-argv TTY vendor picker; top-level help is core-owned but run help currently crosses the lazy runtime/config-migration path; `--headless`; structured result; gateway env injection | Good front-door bones; preserve named vendor adapters, make all help side-effect-free, retire the picker independently, and do not reuse the PTY path *as a native engine* |
| Session runtime | `h2a-runtime` PTY spawner + terminal.output envelopes | Transport only; the "session" is an opaque vendor process |
| Native loop (h2a side) | **None** (no `@sentropic/agent`); the only LLM code in this lane is the gateway | The engine is not built here — and must not be |
| Sentropic engine | **Exists**: `@sentropic/chat-core` + `api/src/services/chat-service.ts` (`runAssistantGeneration`) — see §3.7 inventory | The baseline the owner requires the target to exceed; real, but a *knowledge-work chat* engine, not yet a coding-agent engine |
| Gateway | llm-gateway 0.9 / mesh 0.8: transports, catalog, accounts, audit — but **not on sentropic's chat path today** (in-process mesh instead, §3.7) | Reused as the engine's LLM egress; wiring it in is itself a requirement (R11) |

## 3. State of the art — best-in-class session engines (cited)

*This section states verifiable facts with sources (official docs, GitHub source,
changelogs, engineering blogs, papers — compiled 2026-07-18 in three research passes);
hypotheses are marked. It feeds the capability requirements (§4).*

### 3.1 The loop itself

The dominant shape is a **single-threaded loop** — model call → tool calls → results →
loop — with reliability coming from what surrounds it, not from exotic loop topology.
Claude Code runs one blended gather/act/verify loop with parallel tool calls
auto-approved only for read-only tools (code.claude.com/docs/en/how-claude-code-works.md;
platform.claude.com/docs/en/build-with-claude/tool-use.md). OpenHands formalizes it as
`step(state) → Action → Observation`, both appended to an event stream
(arXiv:2407.16741). Aider's loop re-enters on *reflection* — malformed edits, lint or
test failures re-prompt, capped at 3 (aider/coders/base_coder.py;
aider.chat/docs/usage/lint-test.html). Cognition's essay is the sharpest statement of the
philosophy: single-threaded linear agents, "share full agent traces, not just individual
messages", with a dedicated compressor-LLM for long histories
(cognition.com/blog/dont-build-multi-agents). Amp states it plainly: the engine is "an
LLM, a loop, and enough tokens" (ampcode.com/how-to-build-an-agent). Parallelism inside a
turn is now model-trained, not just permitted: Codex gates `parallel_tool_calls` per
model/tool handler (codex-rs/core/src/tools/registry.rs), and Cursor's Composer family is
RL-trained in sandboxed environments explicitly "to maximize parallelism" in tool calls
(cursor.com/blog/composer). Loop *bounds* are policy, not constants: OpenHands defaults
`max_iterations` to 500 with a $-budget breaker (config.template.toml); the OpenAI Agents
SDK raises `MaxTurnsExceeded` on a configurable `max_turns`
(openai.github.io/openai-agents-python/running_agents) — against sentropic's hard-coded
10/60.

### 3.2 Event-sourced state — the strongest convergence

The clearest cross-system lesson: **the append-only event log is the session's source of
truth**. OpenHands moved from V0's pub/sub EventStream to V1 where "events form an
append-only log that serves as both the agent's memory and the integration point"; the
SDK paper reports V1 "substantially reduces system-attributable failures over V0 with
negligible event-sourcing overhead" (docs.openhands.dev/sdk/arch/events;
arXiv:2511.03690). ACP defines session restore as **replay** (`session/load` re-streams
history as `session/update` notifications — agentclientprotocol.com/protocol/
session-setup). Temporal's durable execution is history-replay ("executes effectively
once and to completion", docs.temporal.io/temporal), with the honest caveat that LLM
calls must be recorded activities and history is capped (51,200 events → Continue-As-New
with summarized carry-over). Claude Code's session store is an append-only JSONL flushed
per turn (code.claude.com/docs/en/sessions.md); Codex records every session as a JSONL
"rollout" under `$CODEX_HOME/sessions` — the crash-durability unit — resumable
(`codex resume`, `codex exec resume`) and **forkable at a specific `turn_id`** via the
app-server API (codex-rs/rollout/src/lib.rs; developers.openai.com/codex/changelog).
Amp goes server-side: threads (messages, context, tool calls) sync to ampcode.com,
addressable, forkable (`amp threads fork`), and remote-controllable while running
(ampcode.com/manual; /news/neo). The OpenAI platform adds two primitives worth copying:
background mode with stream resume via `sequence_number`/`starting_after` after a
connection drop, and a serializable `RunState` that crosses process boundaries for
human-in-the-loop approvals (developers.openai.com/api/docs/guides/background;
openai.github.io/openai-agents-python/human_in_the_loop). LangGraph is the most complete open
implementation of *resumable* agent state: a checkpoint at every super-step, `thread_id`
identity, `get_state_history`, time-travel replay, and **forks** that never mutate
history (`update_state` on a past checkpoint) plus `interrupt()` pauses that survive
process restarts (docs.langchain.com/oss/python/langgraph/persistence, /use-time-travel,
/interrupts).

### 3.3 Checkpoints come in three substrates

Production systems checkpoint at three different layers, and the best ones combine two:
**git commits** (Aider: every applied edit is a commit, `/undo` reverts —
aider.chat/docs/git.html), **state checkpoints** (LangGraph per-super-step; Claude Code
`/rewind` restores code and/or conversation, `--fork-session`/`/branch` branches a
session — code.claude.com/docs/en/checkpointing.md), and **machine snapshots** (Devin:
"every session boots from a snapshot, a frozen bootable image"; sessions sleep and wake
rather than die — docs.devin.ai/onboard-devin/environment). The placement substrates
commoditize the third layer: E2B pauses filesystem *and* memory and resumes by sandbox id
in ~1s (e2b.dev/docs/sandbox/persistence); Modal's experimental memory snapshots restore
a duplicate with processes "still running, in the same state"
(modal.com/docs/guide/sandbox-snapshots); Daytona parks idle sandboxes through
running/stopped/paused/archived tiers (daytona.io/docs). This is exactly the 2026-07-13
move-semantics answer: "move" = re-instantiate from checkpoint, and the substrate
primitives now make that cheap.

### 3.4 Context management

Auto-compaction is table stakes; the differentiators are *where the compaction is
recorded* and *cache awareness*. Claude Code compacts as the 200k limit approaches
(oldest tool outputs first, then summarization) and is deliberately prompt-cache-aware
(layered prefix; cache survives compaction — code.claude.com/docs/en/context-window.md,
/prompt-caching.md). OpenHands' `LLMSummarizingCondenser` emits a first-class
`Condensation` event (`forgotten_event_ids` + summary) into the log, measured at up to 2×
per-turn API-cost reduction at equal solve rate (docs.openhands.dev/sdk/arch/condenser;
openhands.dev blog). Codex made compaction always-on (opt-out removed in 0.143.0) and
moved it **server-side** for OpenAI models via a dedicated compaction endpoint, with
per-conversation `prompt_cache_key` caching (developers.openai.com/codex/changelog;
/api/docs/guides/compaction). Amp reversed its own earlier "no compaction" position:
since the Neo rebuild it auto-compacts at ~90% of the window on a dedicated model
(ampcode.com/news/neo; /modes). Cursor adds "dynamic context discovery": pre-compaction
history is written to a file the agent can *search* to recover lost details
(cursor.com/blog/dynamic-context-discovery). Aider's repo-map is the repo-scale
complement: tree-sitter symbol extraction graph-ranked into a token budget
(aider.chat/docs/repomap.html). Devin adds
cross-session memory: org-wide Knowledge with trigger descriptions, DeepWiki repo
indexing, and notes carried between scheduled runs (docs.devin.ai/product-guides/
knowledge, /work-with-devin/deepwiki).

### 3.5 Permissions, sandbox, hooks

Three complementary layers recur: **rule evaluation** (Claude Code: deny → ask → allow,
specific-over-general, plus modes plan/acceptEdits/bypass —
code.claude.com/docs/en/permissions.md), **typed client-side asks** (ACP
`session/request_permission` with allow/reject × once/always options; the *client* owns
the UX — agentclientprotocol.com/protocol/tool-calls), and **risk-scored confirmation**
(OpenHands `LLMSecurityAnalyzer` + `ConfirmRisky`; the conversation enters
`WAITING_FOR_CONFIRMATION` — docs.openhands.dev/sdk/guides/security). Codex's approval
policy (`untrusted | on-request | never`, plus a `writes` mode auto-allowing declared
read-only actions) sits on **OS-level enforcement**: macOS Seatbelt SBPL, Linux
Landlock+seccomp, a Windows sandbox, with `sandbox_mode = read-only | workspace-write |
danger-full-access` and network access a separate opt-in
(developers.openai.com/codex/config-reference; codex-rs/sandboxing). Cursor followed the
same path: Seatbelt-based agent sandboxing across macOS/Linux/Windows, escaping requires
approval, plus domain-level network allowlists enforceable org-wide
(cursor.com/blog/agent-sandboxing; changelog 2.5). Amp is the deliberate counterpoint —
the Neo rebuild removed default permission checks in favor of plugin-event enforcement
(`tool.call` → allow/reject/modify/synthesize) and environmental safeguards
(ampcode.com/news/neo; /notes/permissions). Execution isolation
is per-session containers/VMs (OpenHands docker/k8s/remote runtimes; Devin per-session
VMs with enterprise guardrails Log/Warn/Block/Kill — docs.devin.ai/enterprise/features/
ai-guardrails). Hooks are now table stakes: Claude Code fires
PreToolUse/PostToolUse/Stop/SessionStart/SessionEnd/UserPromptSubmit… with exit-2
blocking and result modification (code.claude.com/docs/en/hooks-guide.md); Codex ships
**ten** events including PreCompact/PostCompact and SubagentStart/Stop
(developers.openai.com/codex/hooks); Cursor ~20 events including `beforeReadFile` and
conversation-level hooks (cursor.com/docs/agent/hooks); Devin's CLI ships the same
seven-event family (docs.devin.ai/cli/extensibility/hooks/overview); hermes exposes a
`hooks` namespace (local `hermes --help`).

### 3.6 Subagents, budgets, machine surfaces

**Subagents:** Claude Code spawns isolated-context subagents (Agent tool, `.claude/agents`
definitions restricting tools/model, background subagents, experimental teams —
code.claude.com/docs/en/sub-agents.md). Codex subagents are GA: TOML definitions with
per-agent model/effort/sandbox/MCP overrides, `max_threads` 6, `max_depth` 1
(developers.openai.com/codex/subagents). Cursor reads `.cursor/agents/` — **and
`.claude/agents/` and `.codex/agents/`** — with parallel/nested invocation, 8 worktree
agents per prompt and `/best-of-n` across models (cursor.com/docs/subagents; changelog
2.4/3.0). OpenHands V1 ships `DelegateTool` (parallel sub-conversations inheriting
model+workspace — docs.openhands.dev/sdk/guides/agent-delegation). Amp adds the
**Oracle** pattern — a second-opinion consult deliberately run on a *different* frontier
model (ampcode.com/manual). Devin scales it as manager/worker sessions in isolated VMs
(MultiDevin; Advanced Capabilities — docs.devin.ai/work-with-devin/advanced-mode), while
Cognition simultaneously argues *against* shared-context multi-agents — the reconciliation
is isolation-first delegation, never shared mutable context.
**Budgets:** only OpenHands (`max_budget_per_task` enforced in the controller) and Devin
(`max_acu_limit` per session) enforce spend engine-side; Claude Code's `--max-budget-usd`
is print-mode only; Codex has a rollout-level token budget behind a feature flag
(`features.rollout_budget.limit_tokens`) and Cursor's spend limits are admin/plan-level,
not per-session (developers.openai.com/codex/config-reference;
cursor.com/help/account-and-billing/spend-limits). **Machine surfaces:** Claude Code `-p`
+ `--output-format stream-json` + `--include-partial-messages` + `--json-schema`
structured output (code.claude.com/docs/en/headless.md); `codex exec --json` (typed
`thread.*`/`turn.*`/`item.*` JSONL) + `--output-schema <json-schema>`
(learn.chatgpt.com/docs/non-interactive-mode); Amp `-x` + `--stream-json[-input]`
(ampcode.com/manual/appendix); Cursor `cursor-agent --output-format stream-json` +
`--stream-partial-output` (cursor.com/docs/cli/reference/output-format); OpenHands
headless JSONL; Devin's poll-based API with `structured_output_schema` (JSON Schema
Draft 7) and webhook-triggered automations (docs.devin.ai/api-reference). Embedding
surfaces multiplied: `codex mcp-server` (Codex *as* an MCP server) and `codex app-server`
over stdio/WebSocket/unix-socket (developers.openai.com/codex/cli/reference). ACP standardizes the
client↔session wire (JSON-RPC, `session/new|load|prompt`, streamed `session/update`,
typed `StopReason` — agentclientprotocol.com), with Claude Code, Gemini CLI and hermes
(`hermes acp`) already speaking it; MCP owns the tool boundary; A2A the agent↔agent layer
above sessions.

### 3.7 Sentropic's current engine — the baseline to exceed (code-verified 2026-07-18)

Contrary to the h2a-lane framing ("no native agent exists"), **sentropic has a real
session engine**: the chat lane, mid-migration from `sentropic/api/src/services/
chat-service.ts` (5k lines) into the port-based `@sentropic/chat-core` (`ChatRuntime`,
BR14b lots). Inventory (paths verified in the sentropic checkout):

| Dimension | Today | Evidence |
|---|---|---|
| LLM↔tool loop | **Yes** — `runAssistantGeneration` `while` loop; ~30 server tools (web_search, documents, plan, CRUD…); capped at 10 iterations (60 in todo-autonomous mode) | `chat-service.ts:3177,3578,343`; `chat-core/src/runtime-tool-dispatch.ts` |
| Session persistence | **Yes** — Postgres: `chat_sessions/_messages/_contexts/_stream_events/_generation_traces` | `api/src/db/schema.ts:617–713`; `chat-core/src/session-port.ts` |
| Context management | **Yes** — token budget zones (`normal\|soft\|hard`), `compactContextIfNeeded` + summarization on hard zone | `chat-core/src/context-budget.ts`; `chat-service.ts:702,3505,3617` |
| Streaming | **Yes, replay-capable** — SSE `id: streamId:sequence`, `readStreamEvents(streamId, sinceSequence)`; typed event union (reasoning/content/tool deltas, status, error, done) | `api/src/routes/api/streams.ts:124,321`; `chat-core/src/stream-port.ts` |
| Checkpoint / fork | **Partial** — save/load/restore implemented; **`fork` and `tag` throw "not implemented"** | `chat-core/src/checkpoint-port.ts`; `api/.../postgres-checkpoint-adapter.ts:208` |
| Crash resume | **No for chat** — stranded `chat_message` jobs are *failed + finalized, never resumed* (workflow runs can pause/resume) | `api/src/services/queue-reaper.ts:14`; `runs.ts` pause/resume |
| Subagents (in-session) | **No** — delegation is workflow-level only (`agent_definitions`, `@sentropic/flow`, per-task jobs); no in-turn subagent spawn | `db/schema.ts:1089+`; `config/default-agents-code.ts` |
| Permissions | **Partial** — per-tool allow/deny table (`extension_tool_permissions`), broker authz; **no interactive ask flow / permission modes** | `db/schema.ts:960`; `chat-core/src/ports.ts:88` |
| Sandbox | **Partial** — `isolated-vm` for skills; server tools run unsandboxed in-process; **no shell/file/coding tools at all** in the chat loop | `packages/skills/src/sandbox/runtime.ts` |
| Hooks | **No** — no lifecycle-hook system (only DI callbacks) | grep evidence, `chat-core/src/runtime.ts` |
| Budget | **Partial** — token budget yes; **$ budget not wired into the chat path** (gateway metering is a separate v0 sink; account quota tables exist) | `llm-gateway/src/personal-passthrough/metering.ts`; `db/schema.ts:534–582` |
| Placement | **In-process** — chat generation runs inside the single api pod via a DB `job_queue`; no dedicated worker (k8s `30-api.yaml` replicas:1) | `api/src/index.ts:146–189`; `queue-manager.ts:1132` |
| LLM egress | **In-process mesh, NOT the HTTP gateway** — `createLlmMesh` + provider adapters in the api process; `@sentropic/llm-gateway` is a separate metered egress not on the chat path | `api/src/services/llm-runtime/mesh-dispatch.ts:338` |

Honest reading: sentropic's engine is a **credible conversational engine** (its streaming
replay and context-budget zones are already at or near the best-in-class bar) but it is
**not yet a coding-agent engine**: no shell/file/edit tools, no in-session subagents, no
hooks, no fork, no crash-resume of a turn, no enforced spend budget, one placement, and an
LLM path that bypasses the very gateway that carries sentropic's own audit/routing story.
Those are exactly the gaps §4 turns into requirements.

## 4. The engine capability contract — requirements and gaps

This is the load-bearing section: the h2a↔sentropic contract carries a **capability
requirements list**, not just an integration surface. Each requirement Rn states the bar
(with its best-in-class evidence from §3), what sentropic has today (§3.7, code-verified),
and the gap class. Sentropic owns *how* each is met. The whole table is **to co-validate
with sentropic** (sent as Q2, §9).

| R | Requirement (the bar) | Best-in-class evidence | Sentropic today | Gap |
|---|---|---|---|---|
| R1 | **Append-only event-sourced session log as source of truth** — state reconstructed by replay; every anomaly diagnosable from the log | OpenHands V1 ("state changes happen by appending events"; measured reduction of system-attributable failures, arXiv:2511.03690); Temporal history-replay; Claude Code append-only JSONL | `chat_stream_events` persists the *stream*, but session state lives in mutable rows (`chat_sessions/_messages`); not replay-reconstructible | **Partial** |
| R2 | **Replayable attach from any sequence number** (SSE/WS, `Last-Event-ID`-style) | ACP `session/load` = replay as `session/update` stream; OpenHands Socket.io resume | **At bar** — `readStreamEvents(streamId, sinceSequence)`, `id: streamId:seq` | **None** (expose at seam) |
| R3 | **Checkpoint + restore + FORK (time-travel)** — branch a session from any checkpoint without mutating history | LangGraph forking via `update_state` on a past checkpoint ("history is never mutated"); Claude Code `/rewind` (code+conversation) + `--fork-session`; `codex fork` (at a specific `turn_id` via app-server); `amp threads fork` | save/load/restore implemented; **`fork`/`tag` throw "not implemented"** (`postgres-checkpoint-adapter.ts:208`) | **Major** |
| R4 | **Durable execution: a crashed/killed turn is resumable**, not lost — replay recorded results, re-enter the loop idempotently | Temporal ("executes effectively once and to completion"); LangGraph durability modes + interrupts surviving process restarts; OpenHands passivate/rehydrate | Stranded `chat_message` jobs are **failed + finalized, never resumed** (`queue-reaper.ts:14`) | **Major** |
| R5 | **Context compaction as a first-class logged event** + budget zones + prompt-cache awareness | OpenHands `Condensation` event (forgotten_event_ids + summary; ~2× cost cut at equal solve rate); Claude Code auto-compaction + cache-preserving layering; Devin's dedicated compressor-LLM (Cognition essay) | Budget zones + `compactContextIfNeeded` exist — **near bar**; compaction not modeled as a log event; cache-awareness unverified | **Minor** |
| R6 | **Coding tool surface (ACI): shell, file read/edit, git, browser** with execution feedback into the loop | Claude Code Read/Write/Edit/Bash/Grep; OpenHands CodeAct + SWE-Agent-lineage AgentSkills (ACI, arXiv:2405.15793); Devin shell+IDE+browser; Aider auto-lint/test reflection | **Absent** — ~30 knowledge-work tools (web_search, documents, plan, CRUD); no shell/file/edit/git in the chat loop (coding lives outside, in cowork-bridge/workflow agents) | **Critical** (this is what makes it a *coding* engine) |
| R7 | **Interactive permission gate**: ask/allow/deny rules + permission modes, decision rendered by the CLIENT, enforced by the engine | Claude Code deny→ask→allow evaluation + modes (plan/acceptEdits/bypass); ACP `session/request_permission` (allow/reject × once/always); OpenHands `ConfirmRisky` + LLM risk analyzer | Static per-tool allow/deny table (`extension_tool_permissions`); **no ask flow, no modes** | **Major** |
| R8 | **Sandboxed tool execution + isolated placement** (container/VM per session; pause/resume at the substrate) | OpenHands per-session Docker/k8s/remote runtimes; Codex OS-level sandbox (Seatbelt / Landlock+seccomp / Windows) with opt-in network; Cursor Seatbelt sandbox + org-enforceable domain allowlists; Devin per-session VM + snapshot boot; E2B/Modal/Daytona pause-resume substrates | `isolated-vm` for skills only; server tools run unsandboxed **in the single api pod** | **Major** |
| R9 | **In-session subagents** with restricted tools/model, isolated context | Claude Code Agent tool + `.claude/agents` + background subagents; OpenHands `DelegateTool`; Devin CLI subagents (`.devin/agents/`) — with Cognition's single-thread dissent as design caution | **None in-session** (workflow-level `agent_definitions` only) | **Major** |
| R10 | **Lifecycle hooks** (pre/post tool, session start/end, stop) able to block/modify, client- or server-registered | Claude Code hooks (PreToolUse…SessionEnd, exit-2 blocks); Codex 10 events incl. Pre/PostCompact + SubagentStart/Stop; Cursor ~20 events incl. `beforeReadFile`; Devin CLI `.devin/hooks.v1.json` (7 events); hermes `hooks` | **None** (DI callbacks only) | **Major** |
| R11 | **Enforced budgets** ($ + tokens + iterations) with a **stop-reason taxonomy** on every exit | OpenHands `max_budget_per_task` enforced in-controller + `max_iterations` 500; Devin `max_acu_limit`; ACP `StopReason` enum; Claude Code `--max-budget-usd/--max-turns` (print mode only) | Token zones yes; **$ budget not wired** into the chat path; iteration cap (10/60) is a constant, not a policy; no stop-reason taxonomy | **Major** (also required by the 2026-07-13 relaunch corrections) |
| R12 | **Gateway-mediated LLM egress** — every native-session model call goes through llm-gateway/mesh with its ledger, catalog, sticky/audit invariants | The 2026-06-26 gateway STUDY invariants; unique vs vendor CLIs (all single-vendor) | Chat path uses **in-process mesh, bypassing the HTTP gateway** (`mesh-dispatch.ts:338`) | **Major** (this is the D4 governance invariant) |
| R13 | **Headless + machine output**: one-shot run, `stream-json` events, structured output against a JSON schema | Claude Code `-p` + `--output-format stream-json` + `--json-schema`; `codex exec --json` + `--output-schema`; Amp `-x --stream-json`; Cursor `--output-format stream-json`; OpenHands headless JSONL; Devin `structured_output_schema` (Draft 7) | SSE exists for the UI; no engine-level one-shot/exec contract, no schema-validated output | **Moderate** |
| R14 | **(Plus) Session interop**: expose the engine as an ACP agent (`session/new\|load\|prompt`, typed permission requests) | ACP v1 adopted by Zed/JetBrains/Neovim/Emacs; Claude Code + Gemini CLI ship ACP adapters; hermes ships `hermes acp` | None | **Opportunity** — one adapter makes every ACP client a sentropic front (subject to the §5 seam) |
| R15 | **Engine as MCP client** — attach user/project-declared MCP servers to a session, tool-policy-governed, deferred schema loading; plus engine-side skill loading (SKILL.md refs from the intent) | Claude Code `.mcp.json` + deferred tool search; Codex `codex mcp` (stdio/HTTP, OAuth, per-server enable lists); Cursor `.cursor/mcp.json` + enterprise allowlists; Amp `amp.mcpServers` | MCP **platform/broker** exists (`@sentropic/mcp-platform`, `mcp-auth`) but the chat loop consumes a fixed server toolset; no user-attached MCP servers per session; skills exist (`@sentropic/skills`) but load isolated-vm foundations, not session-scoped SKILL.md packs | **Major** |

### 4.1 Where the target must EXCEED best-in-class (not just match)

*(Everything in this subsection is engine design and therefore **to co-validate with
sentropic** — it deliberately strains the "h2a states the what, sentropic owns the how"
rule by naming compositions; sentropic may meet the same bar another way.)*

The owner's bar is "more demanding than the current sentropic engine, taking the best of
each". Matching §3 per-dimension is table stakes; the composition below is what **no
single engine offers today** — and each piece leans on something sentropic/h2a already
has, so the ambition is structural, not fantasy:

1. **One event log, three checkpoint substrates.** Combine the event-sourced log (R1)
   with LangGraph-style forks (R3) *and* placement-portable snapshots (R8): Claude Code
   cannot relocate a *running local* session to another substrate (its cloud/Remote
   Control surfaces are separate execution homes, not a migration path); Devin cannot
   fork a live session; LangGraph has no coding ACI. An engine with
   log+fork+portable-checkpoint covers all three. (Builds on: `chat_stream_events`,
   `checkpoint-port.ts`, the k8s control plane in `remote`.)
2. **Enforced budgets everywhere** (R11): best-in-class enforcement is print-mode-only
   (Claude Code) or cloud-only (Devin). Engine-level $ + token + iteration budgets on
   every session, with the gateway ledger as the meter, exceeds all of them. (Builds on:
   gateway metering + `llm_account_*` tables.)
3. **Multi-provider governed egress** (R12): every vendor CLI is locked to its vendor;
   OpenHands/Aider are multi-provider but ungoverned (no ledger/audit/sticky policy). A
   gateway-mediated engine is both. (Builds on: llm-gateway 0.9 / mesh 0.8, already
   proven with `claude --bare --model gpt-5.5`.)
4. **Stop-reason honesty + supervised relaunch** (R11 + the 2026-07-13 corrections):
   ACP's `StopReason` enum is the closest surveyed artifact, but it stops at
   end_turn/max_tokens/max_turn_requests/refusal/cancelled — no surveyed engine
   distinguishes the *failure causes* (crash/idle/auth-fail/OOM/budget) in a machine
   taxonomy at its boundary; h2a's drumbeat/liveness learnings make this a first-class
   seam field, which is exactly what safe auto-relaunch (WP3) needs.
5. **Governance-native sessions**: sessions born with an h2a identity, Track references,
   and conductor/negotiation reachability (via MCP h2a tools) — no competitor has an
   inter-agent governance protocol at all. This stays h2a's differentiation ON TOP of the
   engine, per the ownership boundary.

## 5. The session-creation seam (h2a ↔ sentropic)

The seam is one small, versioned API family — **intent in, projection out** — owned as a
contract, not as shared code. It extends the v1 seam table with the engine-specific
operations. Everything in this section is a *proposal to sentropic* (the questions were
sent, §9); nothing is presupposed.

### 5.1 Operations

| Op | Caller → Callee | Carries | Returns |
|---|---|---|---|
| `CreateSession` | h2a → engine | `SessionLaunchIntent`: correlationId, idempotencyKey+scope, descriptor revision, workspace binding ref, placement request (`local\|k8s\|sentropic`), runtime (`native`), tool-policy ref (incl. MCP server refs), **permission-mode**, **agent-definitions ref** (subagents), **hook-policy ref**, **skill refs**, model intent, effort intent, **output-schema** (optional JSON Schema), budget envelope, initial prompt/context refs | `SessionProjection`: executionId, actual placement, state+reason, advertised controls, revision, receipt |
| `AttachStream` | h2a → engine | executionId + **last seen sequence number** | replayable event stream (SSE/WS) from that sequence |
| `SendInput` | h2a → engine | executionId, revision, one of: user message / permission decision / hook response / **model-intent change** / steering input | receipt |
| `Checkpoint` / `Fork` | h2a → engine | executionId (+ checkpoint ref for fork) | checkpoint ref / new executionId |
| `Resume` | h2a → engine | checkpoint or session ref, placement request | `SessionProjection` (a successor, never PTY continuity) |
| `Stop` | h2a → engine | executionId, reason, revision | receipt with final stop-reason |
| `Inspect` / `List` | h2a → engine | filters | projections (descriptive, never ambient authority) |
| LLM calls | engine → gateway | model id/intent, messages, stream | provider-routed completion (catalog-resolved) |

Headless one-shot (`h2a run native -p`, R13) is a **composition**, not a new op:
`CreateSession` (with prompt + output-schema) → `AttachStream` from 0 → terminal event
with stop-reason + schema-validated result → h2a prints and exits. Every §7 flag marked
*(t)* maps to a named field above — that is the §10 acceptance criterion.

Safety envelope on every mutating op (unchanged from v1, restated because the engine
inherits it): caller/tenant + host-principal auth via the **enrollment bind**, session-bound
scope-limited grants, descriptor revision (`If-Match`), idempotency key + TTL, **fenced
lease epoch** for any writer (exactly-one-writer per session is engine-enforced), immutable
operation receipts.

### 5.2 Who creates the session

- **h2a** constructs the intent (workspace fingerprint, policy refs, model/effort intent,
  budget), presents consequences to the human where required, and renders the projection.
- **sentropic** validates, admits (policy/quota), places, and **owns the running loop** —
  including its durable state. The engine's executionId is the authoritative session
  identity; h2a's correlationId links it to the h2a descriptor and Track.
- **The gateway** is invisible in this seam: the engine consumes it; h2a only ever sees a
  service-attested `ResolvedModelProjection` (v1 §gateway).

### 5.3 Placement — and the local fork

`local | k8s | sentropic` placements share the same descriptor and the same event-stream
contract; only the executor differs. The **open fork is local placement** (A3 to the
architect, §9): either (a) a **sentropic-owned local worker** binary that h2a launches and
supervises (engine ships it, h2a wires it into tmux/session UX), or (b) the **engine as a
library** embedded in the h2a runtime process. (a) keeps one engine implementation and
one update channel but adds a local daemon to operate; (b) removes the daemon but forks
the engine into a second execution context that sentropic must keep in lockstep.
**Recommendation: (a)** — the 2026-07-13 corrections already require a durable local
supervision agent for relaunch; one sentropic worker can carry both duties. Marked **to
co-validate with sentropic**.

### 5.4 Relation to the three loops

This seam covers **loop #2 only** (the LLM/tool loop inside a session). The conductor
loop (#1, WP3/objective-loop) and process supervision (#3, drumbeat/relaunch) stay on
their existing tracks; they *consume* this seam (e.g. a relaunch becomes `Resume` from
the last checkpoint with a stop-reason-aware policy) instead of scraping PTYs.

## 6. `h2a run native` × every mesh model

The contract in one sentence: **h2a passes model intent through; the engine calls the
gateway; the gateway's catalog resolves it; h2a renders the attested result.**

- `h2a run native --model <id>` places `<id>` verbatim in `SessionLaunchIntent.modelIntent`.
  Valid ids are whatever the mesh routes (claude-*, gpt-*/codex, gemini-*, mistral-*, …).
  h2a performs **no validation against a local list** — a bad id fails at the service with
  a catalog error class h2a renders honestly.
- The gateway already proves the pattern: `claude --bare --model gpt-5.5` and
  `--model gpt-5.3-codex-spark` run through it today (verified in the 2026-06-26 gateway
  STUDY), with the catalog (`/v1/models`, model descriptors with `provider`,
  `upstreamModel`, `accountPool`, `capabilities`) as the resolution authority.
- **Model discovery UX without a second catalog:** `h2a run native --model ?` (or `h2a models`)
  may render a *read-through* of the gateway catalog — id, public label, capability flags
  only; no accounts, no routes, no pools. This is a display of the service's list, not an
  h2a-owned vocabulary (v1 S4 stands: adopt the service-owned intent/profile when
  ratified). **To co-validate with sentropic.**
- `--effort <low|medium|high|xhigh>` follows the same pattern: an intent normalized by the
  gateway per provider (reasoning-effort mapping is already a gateway capitalization item,
  2026-06-26 STUDY), never a per-provider flag matrix in h2a.
- Mid-session model switch (parity with `claude /model`, `codex -m` per session): expressed
  as `SendInput{kind: model-intent-change}`; the engine decides whether the running
  conversation tolerates it and records the change in the session log. Sticky/account
  consequences stay a gateway policy (silent intra-session provider fallback is already
  banned by the gateway invariants).

## 7. Parity matrix — claude / codex / hermes ↔ native h2a

Reference surfaces captured live on this machine (2026-07-18): `claude --help`,
`codex --help` + `codex exec --help`, `hermes --help`. The **Executor** column answers the
brief's "who executes each capability": `front` = h2a CLI/runtime, `engine` = sentropic
session engine, `gw` = llm-gateway/mesh. *(t)* marks a target h2a spelling that does not
exist today. The parity flags and explicit `native` selector are additive. Bare `h2a` and
exact, no-profile `h2a run` are owner-approved breaking changes; rejecting arbitrary
unknown executables is the separately disclosed recommended safety break. Native is the
only implicit runtime; every vendor remains an explicit route. Help is a core-front
short-circuit and never imports the runtime, migrates config, probes the engine or creates
a session. Abbreviated native flags below live under `h2a run native`; they do not make
option-first, no-profile `h2a run --<flag>` implicitly native or vendor-selected.

| Capability | claude | codex | hermes | Native h2a (target) | Executor |
|---|---|---|---|---|---|
| Interactive session | default TUI | default TUI | `hermes chat` / `--tui` | with stdin+stdout TTY: bare `h2a` *(t)* — canonical; exact, no-profile `h2a run` *(t)* enters the same flow; `h2a run native` *(t)* is the explicit equivalent. `CI` additionally blocks only the two implicit forms | front (guard/UX) + engine (loop) |
| Vendor-adapter session | native vendor CLI | native vendor CLI | native vendor CLI | always explicit: recognized `h2a run claude`, `h2a run codex`, other listed profiles/aliases, and retained direct aliases; preserves their PTY/adapter semantics and never enters the native seam | front + existing vendor adapter |
| Help / usage | `--help`, `/help` | `--help` | `--help` | canonical explicit forms: `h2a help`, `h2a --help`, preserved `h2a run --help`; current `-h` forms remain compatibility aliases; default bare `h2a` and exact `h2a run` do not render help (the time-boxed legacy env is the migration-only exception) | core front (short-circuit; no runtime import/config/engine/session) |
| Headless one-shot | `-p/--print` | `codex exec` | `-z PROMPT` / `hermes send` | `h2a run native -p "<prompt>"` *(t)*; today's `--headless` stays for vendor profiles | engine (loop) + front (exit/report) |
| Resume / continue | `--resume`, `-c`, `--from-pr` | `codex resume [--last]`, `codex exec resume` | `--resume SESSION`, `--continue [name]`, `sessions` | `h2a resume <slug>` exists today (local-session semantics); native resume is a **semantic extension** of that verb + `h2a run native --resume <ref>` *(t)* | engine (state) + front (picker) |
| Fork / branch a session | `--fork-session`, `/branch` | `codex fork` | checkpoints namespace | `h2a session fork <ref>` *(t)* | engine |
| Checkpoint / rewind | `/rewind` (code+conversation) | — (git `apply` only) | `hermes checkpoints` | `h2a session recover` (v1-proposed) + `h2a session checkpoint` *(t, new — not in v1)* | engine |
| Streaming machine output | `--output-format stream-json`, `--include-partial-messages` | `codex exec --json` (event stream) | ACP server (`hermes acp`) | `--json` (today, one result object) + `--output-format stream-json` *(t)* replaying engine envelopes | engine (events) + front (framing) |
| Structured output | `--json-schema` | `codex exec --output-schema` | — | `--json-schema` *(t)* passed in intent | engine |
| Model selection | `--model` (+ `--fallback-model`) | `-m/--model`, `--oss`, local providers | `-m MODEL --provider`, `moa`, `fallback` | native: `h2a run native --model <mesh-id>` becomes intent (§6); explicit vendor forms preserve their adapter-specific `--model` semantics | gw + engine for native; vendor adapter otherwise |
| Effort control | `--effort low…max` | `-c model_reasoning_effort` | — | native: `h2a run native --effort …` becomes intent; explicit vendor forms preserve their adapter-specific semantics | gw + engine for native; vendor adapter otherwise |
| MCP tools | `--mcp-config`, `.mcp.json`, deferred tool search | `codex mcp` + `mcp-server` | `hermes mcp`, `tools` | `--mcp-config` *(t)* refs passed in tool-policy; engine is the MCP client | engine |
| Skills / commands | skills + `/name`, plugins | `codex plugin` | `hermes skills`, `bundles` | `h2a install-skills` (exists) + skill refs in intent *(t)* | front (install) + engine (load) |
| Permissions | `--permission-mode`, allow/deny rules, `--dangerously-skip-permissions` | approval modes + `codex sandbox` (OS sandbox) | `--yolo` / `--safe-mode`, pairing | `--permission-mode` *(t)*; interactive decisions rendered by h2a, **enforced by the engine** | engine (gate) + front (ask UX) |
| Sub-agents | `--agents` JSON, `.claude/agents`, background subagents, teams | TOML subagents GA (`max_depth` 1, per-agent model/sandbox) | `moa` (mixture of agents) | `--agents` *(t)* in intent; h2a protocol peers stay distinct (h2a governance, not engine subagents) | engine (spawn) + front (defs) |
| Hooks | settings hooks (PreToolUse… SessionEnd) | 10 events in `hooks.json` (incl. Pre/PostCompact) | `hermes hooks` | hook policy ref in intent *(t)*; h2a host hooks (Stop→drumbeat) keep working at the front | engine (fire) + front (subscribe) |
| Background / attach | `--bg`, `claude agents` | `codex cloud`, `--remote ws://` (remote app server) | `serve`, `gateway` | `--no-attach` + `h2a attach` (exist today) over the replayable stream | front (attach) + engine (stream) |
| Budget caps | `--max-budget-usd`, `--max-turns` (print mode) | rollout token budget (feature flag) | — | `--max-budget-usd\|--max-turns` *(t)* in intent budget envelope, **engine-enforced** | engine (enforce) + gw (meter) |
| Session naming / listing | `-n/--name`, `/resume` picker | `codex resume` picker, `archive\|delete` | `sessions list\|rename\|export` | `--name` (exists), `h2a ls` (exists) | front |
| Fan-out N agents | — (teams experimental) | — | — | `--count N` (exists today — **h2a is ahead here**) | front |
| Multi-CLI coordination | teams (experimental) | — | kanban/gateway | **h2a protocol itself** (inbox/negotiation/conductor) — h2a's differentiator | front/protocol |
| Remote/cloud execution | claude.ai/code, Remote Control | `codex cloud`, exec-server | `serve`/`desktop` | placement `k8s\|sentropic` in the same verb set | engine + placement |

Reading of the matrix: the front already owns respectable session UX (`ls/attach/stop/
resume/--count/--json`); **everything in the "engine" column is missing today** because
there is no engine — that is precisely the §4 requirements list. Parity is achieved not by
cloning each CLI's flags but by (a) the engine exposing the capability and (b)
`h2a run native` mapping a stable flag onto the intent. Bare `h2a` changes from help to
the native interactive agent, and exact `h2a run` changes from requiring a profile to
defaulting to native; these are coordinated major-version breaks, not additive aliases.
`h2a run native` and new flags are additive. Recognized explicit vendor profiles and
aliases keep their current meaning. The generic unknown-token-as-executable behavior does
not: the successor DEC must ratify its fail-closed replacement or define an unambiguous
custom-adapter selector. No configuration, model intent or picker selects a vendor
implicitly. Explicit help short-circuits before the lazy runtime boundary.

## 8. Decisions and recommendations

| ID | Decision / fork | Options or settled target | Recommendation | Owner |
|---|---|---|---|---|
| E1 | Is the §4 capability list the co-validation object? | (a) requirements list h2a states, sentropic owns how; (b) sentropic publishes its own roadmap, h2a consumes | **(a)** — it is the only framing that carries the owner's "exceed the current engine" requirement across the seam without h2a designing sentropic's internals | **to co-validate with sentropic** |
| E2 | Local placement executor | (a) sentropic-owned local worker launched/supervised by h2a; (b) engine-as-library in h2a runtime | **(a)** — one engine implementation, one update channel; the local supervision daemon is needed for relaunch anyway (2026-07-13 corrections). (b) forks the engine into a second execution context | **to co-validate with sentropic** |
| E3 | Session state model | (a) append-only event-sourced session log as source of truth, checkpoints as derived snapshots; (b) transcript file + ad-hoc state | **(a)** — it is what makes resume/fork/replay/attach-from-sequence and audit cheap and correct (§3: OpenHands event stream, Claude Code append-only JSONL) | **to co-validate with sentropic** |
| E4 | Budget enforcement | (a) engine enforces per-session budget envelope, gateway meters; (b) advisory only (today's norm, §3) | **(a)** — enforced budgets are a genuine differentiator vs best-in-class (only `--max-budget-usd` in print mode exists at Claude Code; most engines have nothing) | **to co-validate with sentropic** |
| E5 | Native interactive entrypoint + explicit vendors/help + parity flags | **Owner-settled breaking target:** bare no-argv `h2a` and exact, no-profile `h2a run` start the native interactive agent; `h2a run native` is the explicit equivalent; native is the sole implicit runtime and every vendor remains explicit; canonical help is `h2a help`, `h2a --help` and preserved `h2a run --help`; §7 parity flags are otherwise additive | Freeze §0's ordered classifier, TTY/`CI` guard, core-owned help, readiness/no-fallback rule and exits in the successor DEC; atomically switch both implicit forms in one coordinated major; every parity flag still maps to an intent field, none to h2a-local behavior | **h2a owner — settled 2026-07-18** |
| E6 | Engine event stream vs today's h2a-runtime envelopes | (a) engine-native envelopes (sequence-replayable) become the attach contract for native sessions; PTY `terminal.output` stays vendor-profile-only; (b) translate engine events into the legacy envelope | **(a)** — the legacy envelope is a terminal byte pipe; wrapping structured agent events in it loses the machine surface parity demands | h2a + sentropic |
| E7 | Engine subagents vs h2a protocol peers | keep distinct: engine subagents live INSIDE one session (engine-owned); h2a peers are addressable agents on the bus (protocol-owned); a session may *reference* peers via MCP h2a tools | adopt as vocabulary now — prevents the "agent" word from collapsing two safety models (mirrors v1's three-loop rule) | h2a (doc-level) |
| E8 | Build order | (1) write the minimal h2a EVOL/successor DEC and pure dispatch fixtures, paper only; (2) answer Q1–Q5/A1–A4 and freeze the versioned seam/capability/readiness/stop-reason contracts; (3) engine MVP R1–R5 and local worker, then k8s; (4) implement and validate additive `h2a run native`; (5) preannounce for at least one release; (6) bump both package majors and the runtime CLI capability, then atomically switch bare `h2a` and exact `h2a run`, retire the historical direct-entry vendor picker, and apply the ratified unknown-selector policy; (7) remove the legacy env in the following major | Staged as listed. The paper-only EVOL is actionable now, but **no h2a runtime/dispatch implementation or default switch occurs before the sentropic seam answers**. Exact `h2a run`'s current missing-profile parser and the separate direct-entry picker are migrated independently; neither implicit default flips before explicit native readiness passes | joint |
| E9 | Migration announcement, opt-out and measurement | (a) silent break; (b) preannouncement + one-major env escape hatch + privacy-bounded measurement | **(b):** announce in top-level help, the exact-run missing-profile diagnostic, release notes/changelog and upgrade guide for at least one release; ship `H2A_LEGACY_EMPTY_DISPATCH=1` for one major; do not create ambient telemetry. If an existing consented sink is available, record only coarse invocation class/TTY/guard/outcome counts—never argv values, prompt, cwd, model, profile, session id or content. Otherwise use canary tests and support feedback | h2a |

**The single highest-risk assumption**, restated from the backbone STUDY and still true:
that a sentropic-owned engine can reach the §4 bar *while being consumed through a seam*
— if the seam forces h2a to re-implement session semantics client-side (picker state,
permission queues, checkpoint maps), the boundary erodes into two engines. The mitigation
is E3 (one event-sourced truth) plus projections that are genuinely renderable without
client-side state reconstruction.

## 9. Coordination log

Co-design questions were sent over h2a on 2026-07-18 (sender
`claude:a2a-cli:30ac6d55d67e`); both named sentropic targets were registered but **not
live**, so the envelopes are **deposited for their wake** — no sentropic answer is claimed
in this v2 (same honest status as v1's `env:1784322654000:8a9c`).

- To **`claude:llm-mesh:e5f8b95941e9`** (engine/gateway owner) — envelope
  `env:1784358800772:e191`, thread `thr:1784358800772:e191`:
  **Q1** the concrete session-creation API (does an intent/projection equivalent exist
  today; what would you change?); **Q2** which of the §4 capabilities exist / are planned /
  are rejected in the current sentropic code engine; **Q3** confirmation of the
  model-intent-passthrough contract and a stable catalog-read API; **Q4** identity via
  enrollment bind, single-writer lease ownership, budget accounting location (gateway
  ledger vs engine); **Q5** the local-placement fork (worker vs library).
- To **`claude:architect:ed8bbd8bf573`** — envelope `env:1784358800772:1d54`, thread
  `thr:1784358800772:1d54`: **A1** Session Descriptor schema ownership;
  **A2** intent/projection API family vs narrow job-submit; **A3** the local-placement
  fork and who ships the worker binary; **A4** acceptance of the "capability requirements
  list" framing as the co-validation object.

The owner-decision diff and recommended next action from this revision were delivered to
the live **`claude:a2a-cli:d36d7390005e`** on 2026-07-18 from
`codex:a2a-cli:3af20fb40e70`, envelope `env:1784363788617:a949`: author the paper-only
minimal EVOL/successor DEC next, with no implementation or cutover before the sentropic
gates above are answered.

Every cross-owner conclusion in this study is conditional on those replies and marked
**to co-validate with sentropic**. The v1 questions (service identifiers, placement
contract, enrollment ownership, conductor noun) remain open in parallel.

## 10. Acceptance and cutover gates

The h2a-side EVOL may be authored now. Runtime implementation and either default switch
remain gated. “Study accepted” and “safe to cut over” are therefore separate checks.

### 10.1 Minimal EVOL acceptance (paper/specification)

- A successor DEC explicitly supersedes DEC-034's no-argv behavior and the runtime's
  required-profile `run` contract. It labels both implicit changes as breaking, calls for
  coordinated major releases of `@sentropic/h2a` and `@sentropic/h2a-runtime`, and
  requires a runtime CLI capability bump from the current v1
  (`packages/h2a/src/bin-routing.ts`, `H2A_RUNTIME_CLI_API_VERSION`).
- One pure ordered argv classifier freezes every §0 row, including core-owned
  `help`/`--help`/current `-h`, exact `run --help`/`run -h`, exact empty forms,
  `run native`, recognized vendor profiles/direct aliases, recognized existing non-run
  heavy-runtime verbs, selector-less options, unknown selectors and unrelated existing
  core verbs. It retains runtime-parser delegation as the recognition authority for
  non-core first words rather than creating a core allowlist.
- The EVOL freezes the TTY/`CI` automation guard, the one-major
  `H2A_LEGACY_EMPTY_DISPATCH` behavior and removal date, the side-effect-free readiness
  probe, the no-fallback rule and the exit table. The unknown-token executable fallback
  is either separately ratified for removal or replaced by a non-ambiguous explicit
  custom-adapter grammar; it is never silently called “preserved.”
- Golden parser/dispatch cases cover `cli.ts::runCli`, `bin.ts::dispatchRuntime`,
  `bin-routing.ts::shouldDispatchRuntime`/`resolveH2aRuntimeDispatch`, runtime
  `main`/Commander `run <profile>`, and `profile-menu.ts::shouldShowProfileMenu`.
  Negative fixtures assert no import/config migration/PATH probe/network/session effect
  for help, core-resolved selector-less syntax errors and automation refusal; unknown
  delegated grammar may resolve/import the runtime parser but performs no config or
  launch effect. Readiness failure and mixed package versions create no session.
- The rollout specifies an additive explicit-native validation phase, at least one
  release of advance help/diagnostic/release-note announcements, atomic major cutover,
  rollback through the time-boxed env, and E9's no-new-ambient-telemetry/privacy rule.

### 10.2 Realization and implicit-cutover gates

- Sentropic has answered Q1–Q5/A1–A4 and co-validated the §4 requirements list (each Rn
  accepted, re-scoped, or explicitly rejected with a rationale), including E2's local
  executor and E3's event-log-as-truth model.
- The §5.1 seam has versioned Create/Attach/Send/Stop schemas, capability/readiness and
  authentication/admission probes, the full auth/revision/idempotency/fencing/receipt
  envelope, and a frozen stop-reason-to-exit mapping. A probe failure occurs before
  `CreateSession` and never selects help/vendor/picker fallback.
- Every parity flag marked *(t)* maps to a named intent field the engine can honor;
  `h2a run native --model <mesh-id>` reaches at least two providers through the gateway
  with a service-attested `ResolvedModelProjection`.
- Additive `h2a run native` passes interactive and explicit-headless acceptance before
  either implicit spelling changes. With an eligible TTY, bare `h2a`, exact `h2a run`
  and interactive `h2a run native` normalize to the same launch intent. Implicit forms
  under non-TTY or `CI`, and explicit interactive native without both TTYs, exit 1 with
  stderr only and no runtime/config/engine/session side effects. Explicit native is
  allowed in `CI` when its TTY or explicit-headless grammar is satisfied.
- `h2a help`, `h2a --help`, current `h2a -h`, `h2a run --help` and current
  `h2a run -h` exit 0 and work when the optional runtime or native engine is absent,
  without crossing the lazy runtime boundary. Help states that the two empty forms start
  native and gives the explicit noninteractive spelling.
- A missing optional runtime exits 127, an incompatible runtime API exits 64, native
  readiness/admission failure exits 2, and none creates a session or falls back. Clean,
  usage/I/O/signal and vendor-child outcomes match §0's table.
- Every recognized vendor/host-adapter route remains explicit and retains its argv,
  PTY/adapter, output and exit behavior. No config, workspace, PATH, previous use, model,
  provider, profile picker or unknown token can infer or launch a vendor.
- Recognized existing non-run runtime verbs retain lazy dispatch and their current
  contracts; an unknown delegated verb is rejected by the runtime parser before config
  migration or launch.
- Both implicit defaults flip atomically in the coordinated major only after the explicit
  path, mixed-version rejection, migration notices and rollback fixture pass. There is no
  intermediate release in which only one empty form has changed.

## 11. Next step — minimal h2a-side EVOL proposal

Author one paper-only EVOL, tentatively **“native dispatch successor contract”**, with
four small lots:

1. **DEC and grammar:** record the owner decision, the extra unknown-executable safety
   decision requiring ratification, the ordered dispatch/exit tables, explicit vendor and
   help precedence, TTY/`CI` guards, and the one-major legacy env.
2. **Versioned boundary:** specify the next runtime CLI API capability and a
   side-effect-free `native` availability/readiness result that distinguishes package
   missing (127), API mismatch (64), engine/admission unavailable (2), and ready—without
   implementing the sentropic engine.
3. **Acceptance fixtures:** enumerate the parser matrix and no-import/no-config/no-launch
   assertions around the existing functions named in §10.1, plus equivalence of the three
   successful native spellings and unchanged recognized vendor adapters.
4. **Release/rollback:** coordinate both package majors; preannounce for at least one
   release; document explicit help/headless migration; ship then retire
   `H2A_LEGACY_EMPTY_DISPATCH`; use only E9-compliant measurement.

This EVOL may be drafted immediately. It must carry the sentropic Q1–Q5/A1–A4 and §5
schema/capability/readiness/permission/stop-reason answers as **hard realization gates**:
no h2a dispatch code, native engine implementation, package change, publish or implicit
cutover is authorized by this study.
