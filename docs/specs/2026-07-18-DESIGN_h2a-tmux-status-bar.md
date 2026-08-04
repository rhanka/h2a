# Design — h2a tmux status surface

Date: 2026-07-18  
Status: design complete, implementation not started  
Rung: DESIGN / EVOL candidate plus implementation plan  
Scope: local tmux sessions launched by `h2a run`, the embedded local LLM gateway, managed-agent/job projections, and objective-loop projections

## Authority and constraints

This document implements the design brief at `/tmp/design-tmux-status-bar.md`. That brief is authoritative for this run. The run is design-only: it changes no runtime source, package metadata, generated artifact, or published surface.

The design also preserves the compatibility boundary in `docs/specs/2026-07-17-STUDY_h2a-cli-coconception.md`: bare `h2a status` remains the frozen machine-first presence inventory. Human and tmux renderers are additive flags. h2a may show the safe, observed outcome of the local gateway, but this does not make h2a the owner of provider routing, account policy, model catalogues, sticky binding, or failover.

## Outcome

Adopt three coordinated but independently shippable changes:

1. New local tmux sessions are named `h2a-<slug>`. Discovery accepts both `h2a-<slug>` and legacy `remote-<slug>` during a compatibility window, while all new writes use `h2a-`.
2. The gateway publishes a typed, per-session status snapshot. The tmux renderer shows the actual requested-to-upstream model mapping and a safe account label; it never substitutes an authentication class such as `Raw API key` for account identity. Direct sessions show `gw off`.
3. The bar shows only compact managed-agent and objective-loop counts. `h2a status --human --watch` is the detailed live view, and an optional companion tmux window runs that view. No CLI stdout is scraped: core reads loops/presence directly and lazily consumes a typed runtime projection for sessions/jobs.

The recommended bar is:

```text
left:  [h2a-a20:claude*] A2!1 L1
right: gw active · claude-opus-4-8→gpt-5.6-sol · acct work-codex  14:32
```

Width-reduced examples are:

```text
[h2a-a20:claude*] A2!1 L1      gw idle · opus-4.8→sol · work-codex  14:32
[h2a-a20:claude*] A2 L1        gw active · work-codex  14:32
[h2a-a20:claude*] A2 L1        gw off  14:32
```

`A` is the count of non-terminal h2a-managed runtime agents/sessions/jobs. `L` is the count of non-terminal objective loops. `!N` is the combined attention count; the detailed view explains every attention item.

## Current-state evidence

The following are facts in the current checkout unless explicitly labelled otherwise.

| Concern | Fact | Exact source |
|---|---|---|
| Canonical local tmux prefix | `LOCAL_PREFIX` is `"remote-"`; `localSessionName()` creates it, `listLocalSessions()` filters on it, and `findLocalSession()` resolves full name or slug. | `packages/h2a-runtime/src/tmux.ts`: `LOCAL_PREFIX`, `localSessionName`, `listLocalSessions`, `findLocalSession`, `startLocalSession`, `startHeadlessSession` |
| CLI compatibility | `h2a ls` uses `listLocalForLs()`. `h2a attach` first uses `findLocalSession()` and then `localTmuxSessionForName()` as a registry fallback. `h2a stop` only uses `findLocalSession()` before falling through to the remote control-plane path. | `packages/h2a-runtime/src/index.ts`: the `ls`, `attach`, and `stop` command actions |
| Registry fallback | Local-tmux liveness and missing `tmuxSession` values fall back to `remote-${id}`. `localTmuxSessionForName()` canonicalizes only `remote-`. | `packages/h2a-runtime/src/registry.ts`: `isLive`, `listLocalForLs`, `localTmuxSessionForName` |
| Other synthesized names | The agent projection synthesizes `remote-${row.slug}` and the conversation guard prints a `remote-` fallback. | `packages/h2a-runtime/src/agents-projection.ts`: `projectLocalSessionAgent`; `packages/h2a-runtime/src/conv-guard.ts`: `ownerFromEntry` |
| Launch posture | The launcher already records gateway `on|off` as safe tmux metadata derived from the effective environment. | `packages/h2a-runtime/src/launch-context.ts`: `buildLaunchContext`, `launchContextOptions`, `parseLaunchContext`; `packages/h2a-runtime/src/tmux.ts`: `persistLaunchContext`, `readLaunchContext` |
| Observed gateway renderer | `updateTmuxStatus()` is not in the current `HEAD`. It exists in the 2026-07-16 `refs/stash` version of `packages/h2a-runtime/src/llm-gateway-runtime/proxy-anthropic.ts`. A stale generated `packages/h2a-runtime/dist/llm-gateway-runtime/flow-bridge.js` still calls it although the current generated proxy does not export it. | `refs/stash:packages/h2a-runtime/src/llm-gateway-runtime/proxy-anthropic.ts`; generated `packages/h2a-runtime/dist/llm-gateway-runtime/flow-bridge.js` |
| Gateway text in that WIP | Active/429/idle overwrite the whole `status-right`. Active passes `request.modelId` as `requested`, but `selected.provider` as `upstream`; idle similarly passes `session.provider`. Therefore the displayed arrow is not the actual requested-to-upstream model route. | Stashed `updateTmuxStatus()` plus generated `H2aPoolState.select()`, `H2aDispatch.dispatch()`, and `H2aDispatch.dispatchStream()` |
| `Raw API key` source | Account labels are arbitrary `AccountDescriptor.label` values parsed from `GATEWAY_ACCOUNTS`. The flow bridge forwards `selected.label`; cached sessions sometimes replace it with `session.accountId`, while idle resolves `findAccount(session.accountId)?.label`. `Raw API key` is a fixture/configured label, not a gateway-derived identity. | `packages/h2a-runtime/src/llm-gateway-runtime/accounts.ts`: `AccountDescriptor`, `getAccounts`, `publicAccountDescriptor`; gateway tests containing the fixture; generated `flow-bridge.js` |
| Actual model route data | `RoutingTarget` fields are recorded into the session ledger as `requestedModel`, `modelId`, and `upstreamModel`; account public descriptors include id/provider/label/auth type/model ids/status. | `packages/h2a-runtime/src/llm-gateway-runtime/model-catalog.ts`; `session-ledger.ts`: `SessionLedgerEntry`, `routeFields`, `recordSessionRequest`; `accounts.ts`: `publicAccountDescriptor` |
| Gateway session targeting gap | Local launcher acquisition currently reuses gateway session id `local-dev`. It records `workspaceId`, but not the exact tmux session name. The WIP renderer derives a tmux target from the workspace basename and prepends `remote-`, which is ambiguous for `--name`, fan-out, and multiple sessions in one workspace. | `packages/h2a-runtime/src/llm-mesh.ts`: `startGateway`, `acquireLlmMeshSessionEnv`; `llm-gateway-runtime/index.ts`: `/v1/session`; `sticky.ts`: `AcquireSessionOptions`; stashed `updateTmuxStatus()` |
| Managed agents/jobs data | `projectAgentsForH2a()` returns the stable `remote-agents-list` v1 projection built from registry jobs plus local tmux rows. It is already consumed by core through a lazy dynamic import, not stdout parsing. `h2a jobs ls` is human-only today and performs reconciliation; it has no JSON flag. | `packages/h2a-runtime/src/index.ts`: `projectAgentsForH2a`, `agents ls`, `jobs ls`; `packages/h2a-runtime/src/agents-projection.ts`; `packages/h2a/src/runtime/loop/engine/adapters.ts`: `readAgents` |
| Presence data | `h2a sessions` and `h2a_discover_sessions` read fresh presence. Presence means a reachable h2a protocol session, not necessarily a managed work session. | `packages/h2a/src/cli.ts`: `cmdSessions`; `packages/h2a/src/runtime/mcp/sessions.ts`: `SessionRegistry.scanFresh`; `packages/h2a/src/runtime/mcp/handlers.ts`: `handleDiscoverSessions` |
| Objective-loop data | `listObjectiveLoops()` reads typed loop state, including loop/agent statuses and `remoteJobId`/`h2aInstance` links. `h2a loop list` currently emits full loop JSON; MCP `h2a_loop_list` already emits a compact projection. | `packages/h2a/src/runtime/loop/index.ts`: `H2AObjectiveLoop`, `H2ALoopAgent`, `listObjectiveLoops`; `packages/h2a/src/cli.ts`: `cmdLoop`; `packages/h2a/src/runtime/mcp/handlers.ts`: `handleLoopList`, `handleLoopStatus` |
| CLI routing boundary | `status`, `sessions`, and `loop` are native light-core verbs. `run`, `jobs`, `agents`, `ls`, `attach`, and `stop` lazily dispatch to `@sentropic/h2a-runtime`. | `packages/h2a/src/bin.ts`; `packages/h2a/src/bin-routing.ts`; `packages/h2a/src/cli-contract.ts` |

### Source-baseline warning

The observed gateway bar is grounded in a stashed WIP and a stale generated artifact, not in current source parity. Implementation must first choose a coherent baseline and restore source/generated consistency. It must not patch `dist/**` directly or assume the missing flow-bridge source is authoritative.

## Decision N — tmux session naming

### N1. Dual-reader, single-writer prefix migration

Introduce two explicit constants in `packages/h2a-runtime/src/tmux.ts`:

```text
LOCAL_PREFIX = "h2a-"                 # canonical writer
LEGACY_LOCAL_PREFIX = "remote-"       # compatibility reader only
```

Replace prefix-specific slicing and string construction with shared helpers:

```text
parseManagedSessionName(name) -> { prefix: "h2a-" | "remote-", slug } | undefined
managedSessionCandidates(slug) -> ["h2a-<slug>", "remote-<slug>"]
localSessionName(slug) -> "h2a-<slug>"
```

All new sessions, headless jobs, loop-launched sessions, and synthesized projection values use `h2a-`. Readers continue to recognize legacy sessions. The legacy prefix is compatibility data, not a reintroduced public noun.

### N2. Resolution and collision rules

Resolution by slug follows these rules:

1. An exact full session name always resolves that exact managed session.
2. A bare slug resolves if exactly one canonical or legacy candidate exists.
3. If both `h2a-<slug>` and `remote-<slug>` exist, the bare slug is ambiguous and the CLI must refuse with both exact attach/stop choices. It must not silently prefer one.
4. Registry `tmuxSession` is authoritative when present. Missing historical values try both candidates instead of manufacturing only `remote-<id>`.
5. `ls`, `attach`, `stop`, `jobs attach/logs`, restore, relaunch, conversation guards, and agent projections share the same resolver.

This preserves `h2a ls/attach/stop` by slug and prevents a local lookup miss from falling through to an unrelated remote control-plane session.

### N3. Explicit reversible migration

Do not rename live sessions automatically during ordinary `run`, `attach`, or package upgrade. Add an explicit, idempotent migration surface under the future session namespace:

```text
h2a session migrate-tmux-names --dry-run
h2a session migrate-tmux-names --apply
h2a session migrate-tmux-names --rollback
```

Until the `session` namespace is ratified, the same operation may ship as `h2a tmux migrate-names`; it must not overload `h2a migrate`, which already owns remote/local movement semantics.

The operation:

- enumerates only managed legacy names;
- refuses any target collision;
- uses exact tmux targets;
- renames `remote-<slug>` to `h2a-<slug>` and updates the matching registry `tmuxSession` atomically enough to remain recoverable;
- records a local migration journal containing old/new names and timestamps but no secrets;
- rolls back only entries whose canonical target still matches the recorded migration.

The low-risk first release can omit the command and rely on dual-read compatibility. The explicit migrator is a separate increment because rollback, collisions, and registry recovery deserve dedicated tests.

### N4. Scope of `remote` removal

This change removes `remote-` from new tmux names and user-visible fallbacks touched by the feature. It does not rename transport concepts (`h2a remote …`), on-disk compatibility paths, environment variables, or unrelated internal option keys. The broader eradication remains owned by its existing migration work.

## Decision G — truthful gateway indicator

### G1. One typed snapshot, pure renderers

Replace the loose `updateTmuxStatus(status, details)` boundary with a typed snapshot produced from the gateway's actual selected route and account:

```text
GatewayTmuxStatusV1
  version: 1
  state: off | idle | active | rate-limited | unavailable
  gatewaySessionId
  clientSessionId
  tmuxSession
  requestedModel?
  upstreamModel?
  provider?
  transport?
  accountId?
  accountLabel?
  fallbackAccountLabel?
  retryAfterMs?
  updatedAt
```

Formatting is pure and separate from tmux side effects. Account labels, model ids, and provider strings are sanitized as untrusted display data: strip control characters and tmux formatting metacharacters, normalize whitespace, and truncate by display width. No token, key, authorization header, raw credential type, prompt, or response content may enter the snapshot.

### G2. Exact target identity

The launcher computes the prospective tmux name before gateway acquisition and acquires a gateway session for that exact managed session. `/v1/session` already accepts `clientSessionId`, `workspaceId`, `profile`, model, reasoning effort, and transport constraints; use `clientSessionId` for the exact tmux session identity and keep `workspaceId` as workspace context only.

`local-dev` must stop being the shared identity for launched tmux sessions. A custom `--name`, fan-out member, loop launch, and ordinary workspace launch each receive a distinct gateway session/token. The gateway resolves its tmux target from the stored client session identity, never from `basename(workspaceId)`.

This is required for correctness, not presentation polish. Without it, the bar can update the wrong session.

### G3. State transitions and content

The canonical full strings are:

```text
gw off
gw unavailable
gw active · <requestedModel>→<upstreamModel> · acct <accountLabel>
gw idle · last <requestedModel>→<upstreamModel> · acct <accountLabel>
gw 429 · <requestedModel>→<upstreamModel> · acct <accountLabel> · retry <duration>
gw 429 · <requestedModel>→<upstreamModel> · acct <oldLabel>→<actualFallbackLabel>
```

Rules:

- `requestedModel` and `upstreamModel` come from `RoutingTarget` / `SessionLedgerEntry`, never from provider names placed in model fields.
- `accountLabel` comes from the selected `AccountDescriptor`. Resolve it consistently for cached and newly selected sessions.
- A label equal to a generic credential description (`Raw API key`, `API key`, `Bearer`) is not sufficient identity. Render the stable, secret-free account id as the fallback display label and show the configured label only when it adds identity. The detailed view may show both `label` and `accountId`; the compact bar shows one safe label.
- On a 429, show the exhausted account immediately. Show a fallback arrow only after selection/rebinding returns the actual fallback account; never show `rotating...` as if it were an account.
- After a successful request or stream, transition to `idle` while retaining the last real route/account.
- A direct launch initializes `off`. A required gateway that cannot start fails before session creation; a legacy auto/direct fallback initializes `off` and the detailed view explains the fallback reason.
- Stale status is explicit in the detailed view when `updatedAt` exceeds a documented threshold. The compact bar keeps the last state but dims it or adds `?`; it must not claim current activity indefinitely.

### G4. tmux ownership

The gateway should publish per-session status fields, not repeatedly own the complete user status bar. The launcher installs one h2a-managed format that composes:

- left: session/window identity plus workload counts;
- right: gateway segment plus the existing clock/date segment.

Gateway events update session-scoped `@h2a_gw_*` options and request a tmux status refresh. A pure renderer turns those options into text. This avoids clobbering the time, workload segment, or an unrelated user's global tmux configuration on every request.

If the first increment retains direct `set-option status-right` for delivery speed, it must still use the typed snapshot, preserve the prior clock/date suffix, initialize `gw off`, and be explicitly documented as transitional.

## Decision S — managed agents and objective loops

### S1. Do not put names in the bar

The bar is an attention index, not an inventory. It shows:

```text
A<active>[!<attention>] L<active>[!<attention>]
```

Agent active states are `pending`, `running`, `throttled`, `attached`, `detached`, and `live`. Agent attention states are `pending` without a conductor, `throttled`, `blocked`, `awaiting-decision`, `rate-limited`, `out-of-tokens`, and failed work that has not been acknowledged by a future acknowledgement mechanism. Terminal success is excluded.

Loop active states are `created`, `running`, `waiting-human`, `waiting-agent`, `stalled`, `degraded`, `active`, and `blocked`. Loop attention states are `waiting-human`, `stalled`, `degraded`, and `blocked`. `done`, `cancelled`, and `stopped` are terminal; `failed` is terminal but attention-worthy in the detailed view.

The current runtime projection cannot express every desired attention state (`awaiting-decision` is currently computed only in `jobs status`). The first increment must count only states it can prove and mark the projection degraded rather than infer missing states.

### S2. Additive CLI views

Preserve bare `h2a status` exactly. Add:

```text
h2a status --bar [--segment workload|gateway|all] [--tmux-session <exact-name>]
h2a status --human
h2a status --human --watch [--interval 2s]
```

`--bar` is a stable one-line, no-heading renderer intended for tmux. It never writes state. `--human` is the concise operator dashboard proposed by the CLI study. `--watch` refreshes in-process to avoid starting a full Node process on every detailed refresh.

The human view separates nouns instead of conflating them:

```text
MANAGED WORK
  ID                 KIND       HOST    STATE       SESSION       LOOP
  codex-review-1     job        codex   running     h2a-review-1  loop-abc
  a20                session    claude  attached    h2a-a20       -

OBJECTIVE LOOPS
  ID          STATE          AGENTS  ATTENTION  GOAL
  loop-abc    waiting-human  2/3     decision   Review gateway routing

REACHABLE PEERS
  codex:a2a-cli:…  active
```

Presence remains a separate `REACHABLE PEERS` section because `h2a sessions` is connectivity truth, not managed-work truth.

### S3. Typed aggregation

Core owns the additive status renderer and reads:

- `listPresence(root)` for reachable peers;
- `listObjectiveLoops(root)` for loop state;
- a lazy `@sentropic/h2a-runtime` export for managed runtime work and tmux/gateway state.

Extend the existing lazy-runtime precedent instead of parsing commands:

```text
projectStatusForH2a({ root, tmuxSession? }) -> H2AStatusRuntimeProjectionV1
```

The runtime projection includes local sessions, delegated jobs, exact tmux names, liveness, safe launch posture, safe gateway snapshot, and a `degraded`/`warnings` channel. It can reuse `projectAgentsForH2a()` internally, but it must expose exact stored tmux names rather than synthesize them from a prefix.

Cross-links use explicit identifiers only:

- loop agent `remoteJobId` ↔ runtime job id;
- loop agent `h2aInstance` ↔ presence instance;
- exact `tmuxSession` ↔ managed session.

No fuzzy name matching. Unmatched rows remain visible and unlinked.

### S4. Optional tmux companion

Provide an opt-in companion window named `h2a-status`, distinct from the existing `h2a` MCP side window:

```text
h2a status --tmux-window <exact-session>
```

It creates or reuses a window running `h2a status --human --watch --interval 2s`. It does not start by default in the first release. A later config key may request it from `h2a run` after the view proves stable.

Using a distinct window avoids replacing the existing `H2A_WINDOW_NAME = "h2a"` sidecar contract in `packages/h2a-runtime/src/tmux.ts`.

## Refresh model

Use a hybrid refresh strategy:

- Gateway state: event-driven. Update the exact session's `@h2a_gw_*` options at request start, 429/rebind, and completion, then request a tmux refresh.
- Workload bar counts: poll every 5 seconds through `#(h2a status --bar --segment workload ...)`, or through a small cache if cold-start measurements show the lazy import is too expensive.
- Companion window: in-process polling every 2 seconds by default.
- Presence: existing heartbeat/expiry semantics; do not add a second watcher.
- Loops/jobs: read the existing stores/projections. Filesystem watching is a later optimization, not a correctness dependency.

Do not run a full `h2a jobs ls` reconciliation from tmux's status interval: it can mutate registry state and may contact the control plane. The bar path must be bounded, local, read-only, and tolerant of a missing optional runtime.

## Width, escaping, and failure behavior

- Render by display width, not JavaScript string length.
- Full gateway route/account at wide widths; compact account/state at narrow widths; always retain `gw off`, `gw 429`, and non-zero attention counts.
- Sanitize every external label before embedding it in tmux format text. Escape or remove `#`, brackets, control bytes, newlines, tabs, and escape sequences.
- A missing runtime yields `A?`; a malformed loop store yields `L?`; a missing gateway snapshot yields `gw ?`. Absence is never rendered as zero or idle.
- The status command returns quickly with a degraded segment and exit 0 for unavailable optional data, so tmux does not display shell errors. `--human` reports warnings explicitly.
- Cache writes, if introduced, use atomic rename and a short TTL. No shared append-only store is created for presentation.

## Compatibility and rollback

### Forward compatibility

- Existing `remote-<slug>` tmux sessions remain visible and controllable by slug and exact name.
- Existing registry entries with explicit `tmuxSession` remain authoritative.
- Bare `h2a status` JSON and exit codes do not change.
- `h2a sessions`, `h2a loop list/status`, `h2a agents ls --json`, and `h2a jobs` keep their current contracts.
- Generated `dist/**` is rebuilt from source; never hand-edited.

### Rollback

- Reverting the canonical writer to `remote-` does not strand `h2a-` sessions while the dual reader remains.
- The explicit name migrator has a journal-backed rollback and refuses collisions.
- Gateway rendering can be disabled per session by restoring the prior `status-left`/`status-right` values captured at installation time.
- Status projections are read-only and can be removed without migrating loop, presence, registry, or gateway data.

### Compatibility window recommendation

Keep legacy prefix reads for at least two minor releases and until telemetry/manual audit finds no managed `remote-*` sessions. Removal of the legacy reader is a separate owner-approved change, not part of this feature.

## Security and ownership boundary

- Account display is a local diagnostic. It uses a safe label/account id already present in local gateway configuration; it never exposes credential material.
- The compact bar should prefer label only. The detailed local view may include stable account id, provider, and transport because the brief explicitly requests the actual local lane/account; this is not automatically a permissible remote sentropic projection.
- A future service-owned gateway may return only a service-attested public label. h2a must not reconstruct hidden provider/account data from audit or credentials.
- The gateway owns route/account truth; h2a owns local rendering and session correlation. The bar is a projection, not a routing control.

## Delivery plan

### Increment 0 — baseline and contract tests

Trivial, design-preserving work:

- reconcile the stashed gateway WIP against the selected source baseline and remove source/generated drift;
- add pure fixtures for managed-name parsing, gateway status rendering, width tiers, escaping, and workload counting;
- freeze additive `status --bar|--human|--watch` output contracts without changing bare status.

Gate: no runtime behavior change before the source baseline is coherent and all current prefix/status contracts are characterized.

### Increment 1 — canonical `h2a-` names with compatibility readers

Mostly mechanical but cross-cutting:

- update tmux naming helpers and all reader/fallback sites;
- create only `h2a-*` sessions;
- preserve slug/exact-name `ls/attach/stop/jobs/restore/relaunch` behavior;
- update user-facing wording touched by these paths;
- update agent projection to carry the exact tmux name.

Gate: tests cover new sessions, legacy-only sessions, dual-prefix collisions, registry-only resolution, `stop` local-vs-remote safety, jobs, and restore.

### Increment 2 — truthful gateway snapshot

Non-trivial because identity and data flow change:

- acquire distinct gateway sessions for exact tmux client sessions;
- persist route/account/state in one typed snapshot/ledger path;
- initialize `off`, emit active/429/rebind/idle events, and render from actual route/account data;
- install a composable tmux gateway segment without clobbering other segments.

Gate: custom names, two sessions in one workspace, fan-out, cached account selection, actual fallback account, stream completion, direct mode, stale state, injection-safe labels, and no-secret tests.

### Increment 3 — workload bar and human companion

Non-trivial CLI integration but read-only:

- add the typed runtime projection and lazy core adapter;
- add pure aggregation/counting/linking;
- add `status --bar`, `status --human`, and in-process `--watch` while preserving bare status;
- add the opt-in `h2a-status` tmux companion after bounded-read performance is measured.

Gate: optional runtime absent/incompatible, malformed loop state, exact loop/job/presence linking, degraded output, width tiers, cold-start budget, and bare-status contract regression.

### Increment 4 — explicit name migrator

Separate hardening increment:

- add dry-run/apply/rollback with collision refusal and a recovery journal;
- update registry names after exact tmux rename;
- document the compatibility-window exit criteria.

Gate: idempotency, interrupted migration recovery, target/source disappearance, rollback after partial apply, and no mutation outside managed sessions.

## File-level implementation map

| Area | Primary files/functions | Expected tests |
|---|---|---|
| Prefix parsing/writing | `packages/h2a-runtime/src/tmux.ts`; `registry.ts`; `agents-projection.ts`; `conv-guard.ts`; affected resolver call sites in `index.ts` and `restore.ts` | `tmux.test.ts`, `registry.test.ts`, `agents-projection.test.ts`, `conv-guard-wiring.test.ts`, `restore.test.ts`, `index.test.ts` |
| Gateway identity/snapshot | `llm-mesh.ts`; `llm-gateway-runtime/index.ts`; `sticky.ts`; `session-ledger.ts`; `proxy-anthropic.ts`; a new pure `tmux-status.ts` | existing embedded gateway tests plus new `tmux-status.test.ts`; mirror only transport-neutral tests in `apps/llm-gateway` if shared behavior changes |
| Gateway flow bridge | The selected coherent source baseline for the flow bridge; do not use the stale generated JS as source | source-level bridge tests after the baseline is restored |
| Runtime projection | `agents-projection.ts`; `index.ts::projectAgentsForH2a`; new `projectStatusForH2a` | projection and runtime CLI tests |
| Core status UI | `packages/h2a/src/cli.ts`; `bin.ts`; `cli-contract.ts`; a new status aggregation/renderer module; lazy runtime adapter | `packages/h2a/test/cli-runtime.test.js`, `bin-routing.test.js`, `cli-contract.test.js`, `remote-facade.test.js`, and focused status renderer tests |
| Companion window | `packages/h2a-runtime/src/tmux.ts` and runtime command wiring | tmux argv/unit tests; no live tmux dependency in ordinary unit tests |
| Name migration | new runtime migration module plus a narrowly named CLI command | pure plan/apply/rollback tests with injected tmux/registry adapters |

## Open decisions and recommendations

These questions do not block the design run and are not being sent to the owner for answers.

| ID | Open point | Recommendation |
|---|---|---|
| O1 | Exact public location of the reversible name migrator before the proposed `session` namespace is ratified | Ship dual-read/single-write first. Add `h2a tmux migrate-names` only if migration demand exists; later alias it under `h2a session` without repurposing an existing verb. |
| O2 | Whether a local account id/provider may appear in a remote/service-backed future status | Allow it only for the current local gateway diagnostic. Require a service-attested public label for remote sentropic projections. |
| O3 | Default companion-window behavior | Keep it opt-in. Counts in the bar satisfy ambient awareness without paying an always-running window/process cost. |
| O4 | Bar polling implementation | Start with a 5-second bounded local `#()` renderer and measure cold-start. Add an atomic cache only if the measured budget is missed. Gateway state remains event-driven. |
| O5 | Baseline containing the observed `updateTmuxStatus()` and flow bridge | Treat current source/generated divergence as Increment 0. Rebase the feature onto the branch that owns the gateway-flow integration or recreate the behavior from source; never promote the stash/generated JS directly. |

## Acceptance for implementation readiness

Implementation may start after an independent review confirms:

- the selected gateway source baseline is coherent;
- the dual-prefix resolver covers every local lookup/fallback path;
- exact gateway-to-tmux session identity is carried end-to-end;
- account/model fields are observed truth, secret-free, and injection-safe;
- bare `h2a status` remains unchanged;
- the bar read path is bounded and read-only;
- the runtime/core dependency boundary remains lazy and typed;
- increments can ship and roll back independently.
