# Agent identity fix — unique key-anchored NHI + first-class workspace (Option A, completed)

**Date**: 2026-05-30 · **Status**: design ratified (Option A + PRINCIPAL enrichments), pre-build · **Priority**: urgent.
**Source**: live-bus inventory showed instance collisions (`claude:sent-tech-design-system` ×4 procs, `claude:sentropic` ×8). PRINCIPAL: real UUID identities, workspace traced, harmonized with `remote`, **and grounded in NHI** ("on ne peut pas parler de NHI si le tag n'est pas une identité traçable").

## Root cause (confirmed in code)

`instance = ${host}:${cwd-leaf}` — derived from **location, not the agent** (two sites: `resolveAutoOpen` `cli.ts:833`, `cmdConnect` `cli.ts:2434`); no unique suffix. `sessionId` is unique (`sess:${randomBytes(8)}`) but **all addressing keys on `instance`** (inbox routing, discover, negotiation parties/signers, keyring, remote auth, org/coach). So two agents in one repo share an inbox, are **forced to share one keypair** (the 2nd `registerInstance` is rejected; a different key under the same id is treated as an attack — DEC-035), cannot co-sign or be told apart, and are cryptographically indistinguishable to `remote`. Presence traces no `workspace`/`cwd`.

**This is why NHI was hollow**: `nhi report/attest/inventory/offboard` (DEC-087/089/090) operate per `instance`; on a colliding label they attest/offboard *the collision*, not an agent. A unique, **key-anchored** identity is the precondition for NHI to mean anything.

## Completed identity model (Option A ratified + PRINCIPAL enrichments)

Three orthogonal layers — **perennial identity vs connection identity** made explicit:

### 1. WORKSPACE — a place (own UUID, collision-proof)
`workspace = { id: "ws:<uuid>", path, repo?, host, label }`. The **UUID** disambiguates collisions (same repo name in different checkouts; reused paths). `id` is minted once and **cached** (proposed: `<cwd>/.h2a/workspace-id` or a workspace registry entry) so every agent in that workspace reports the **same** `workspace.id` → agents are **groupable**. `repo` (git remote) + `path` + `label` are attributes. First-class attribute on presence + registration — still **not an actor** (VOCABULARY §WORKSPACE stays "not an actor", promoted to a traced attribute).

### 2. AGENT — a perennial Non-Human Identity (own UUID + mutable name + key anchor)
`agent = { uuid: "<uuid>", name, workspaceId, publicKeys[] }`. The **UUID is the stable, durable identity** (persists across sessions/connections). The **`name`** is a **mutable display label** (e.g. set by a session `/rename`, or `--name`) — UX only, never a key. The identity is **anchored by an ed25519 keypair** (the existing keyring, DEC-078): **the agent UUID bound to its key IS the NHI**. This is the subject of `nhi report/attest/inventory/offboard` and the **auth principal both locally (registration/TOFU) and remotely (signed-bearer, DEC-073/077)** — one identity+key scheme everywhere (the harmonization the PRINCIPAL asked for).

### 3. SESSION/CONNECTION — transient liveness
The existing `sessionId = sess:<random>` per process attachment. Carries heartbeat/state; **references the perennial agent UUID + workspace id**. Reconnecting = a new session under the **same** agent UUID + key → inbox, keys, history persist. (Perennial ≠ connection: the user's distinction, made structural.)

### The addressable `instance` handle (Option A)
`instance = "${host}:${slug(name|label)}:${uuid8}"` (e.g. `claude:sent-tech-design-system:9f3a1c20`), where `uuid8` = the first 8 hex of the agent UUID. **Greppable + collision-proof.** All existing addressing keeps keying on `instance` (no lookup-code change) — it just stops colliding. The full `{uuid, name, workspaceId, keys}` live in the registration; the `instance` string is the shorthand. Legacy bare `claude:label` ids remain valid (degenerate prefix) → gentle migration.

### How the two `sent-tech-design-system` agents then coordinate
Distinct `instance`/UUID (different `uuid8`) + **own key each** (own NHI), but **same `workspace.id`** → separate inboxes (direct messaging), each a distinct negotiation signer (co-sign possible), each independently attestable/offboardable (NHI), and the coach groups them by `workspace.id`/scope while routing to each. "Distinct but groupable" — achieved.

## NHI harmonization (the load-bearing payoff)
Because identity = `agent.uuid` and is bound to a per-agent key: `nhi inventory` lists real distinct agents; `nhi attest` attests a real NHI's posture; `nhi offboard` revokes one agent's keys without touching its workspace-mate; `remote` authenticates each agent as itself. Zero change to the keyring/auth code (already keyed on `instance`) — it only becomes *meaningful* once `instance` is unique + key-anchored.

## Blast radius (small, additive, back-compat)
- **Core (`@sentropic/h2a`)**: new `identity.ts` (pure `deriveWorkspace`, `workspaceId`, `deriveInstanceId`, `slugify`, UUID gen via `node:crypto.randomUUID`); add optional `workspace?: H2AWorkspaceRef` + `name?` to `H2ASession` (`session.ts`) and `H2AActorRegistration` (`types.ts`); guards validate when present (additive — old records stay valid).
- **CLI**: `resolveAutoOpen`/`cmdConnect` use the derivation + a **stable agent token/UUID** cached in env (`H2A_AGENT_TOKEN`, survives DEC-108 re-exec) or `<root>/.h2a/agent-id`; `--instance`/`--name` overrides kept; session-open threads `workspace`+`name`; host plugins bake the token at launch; `store migrate --backfill-workspace` best-effort from `launchContext.cwd`.
- **Unchanged (the payoff)**: all addressing/lookup, the keyring, remote auth, org/coach, blockage, drumbeat — they key on `instance` and benefit automatically.
- **Docs**: DEC (next after DEC-111); VOCABULARY (WORKSPACE → traced attribute with UUID; AGENT → perennial UUID + mutable name + key-anchored NHI; SESSION → connection identity); `cli-contract`.

## Draft TDD plan (6 tasks, core-first)
1. **Core `identity.ts`** — pure derivations + `randomUUID`; `H2AWorkspaceRef`; tests (same path+different token → different instance; same repo → same `workspace.id`; uuid8 form; slug safety; total).
2. **Core schema** — optional `workspace?`/`name?` on `H2ASession` + `H2AActorRegistration`; guards validate-when-present; round-trip tests (old records valid).
3. **CLI derivation + stable token** — `resolveAgentToken`, rewire `resolveAutoOpen`/`cmdConnect`; `--instance`/`--name` overrides; tests (two connects same cwd → distinct instances; legacy id still accepted).
4. **Session open threads workspace + name** — `OpenSessionRequest`/`open`/`handleSessionOpen`; presence carries them; `discover_sessions` returns them; tests.
5. **Host plugins + skill + `migrate --backfill-workspace`** — stable token per agent across re-exec; skill examples; best-effort backfill.
6. **Docs + DEC + VOCABULARY**; full suite green → 0.20.0.

## Open (small) confirmations folded into the build
- Where the **workspace UUID** is cached (proposed `<cwd>/.h2a/workspace-id`, git-ignored) vs a shared-root workspace registry — build picks the simplest (cwd-local cache) unless the PRINCIPAL prefers a registry.
- `name` source of truth: registration (durable) with a session-level override for `/rename` (display) — build uses registration + session override.

---

## Reconnect de-collision (PRINCIPAL build requirement, 0.20.0)

> **Verbatim (PRINCIPAL)**: « faudra bien gérer la décollision, avec une gestion de désambiguation quand deux agents reviennent avec une id ; à la reconnexion il y a une renego basée sur des id de session du provider (codex, gemini, agy, claude — pas la version de label de session, une vraie uuid de session associée au répertoire de travail ou l'identifiant du workspace dans le contexte du provider). »

**This supersedes the earlier "stable agent token cached in env/file" sketch.** The authoritative disambiguator is the **provider's native session UUID** (claude / codex / gemini / agy each expose one, tied to the working directory / workspace in the provider's context) — **never** a session label. The cached token is only a last-resort fallback.

**Re-binding negotiation at (re)connect** maps `(provider, providerSessionUuid, workspaceId) → agentUuid` against a durable, append-only **binding registry**:
- **Reclaim** — if `(providerSessionUuid, workspaceId)` is already bound to a perennial agent → reconnect under the **same** agent UUID + key + inbox + history (a reconnection is the same agent).
- **De-collision (mint-distinct)** — if a *new* `providerSessionUuid` appears in a workspace that already hosts a live/registered agent → mint a **distinct** perennial identity. This is the core fix: two agents in one workspace become two perennial NHIs, each keyed by its own provider session.
- **Ambiguity guard** — if two live agents would resolve to the same `instance`, the renego forces a fresh distinct identity rather than letting them share an inbox/key.

**Build prerequisite — per-provider investigation (ties to EVO-1 host matrix)**: determine HOW to read each provider's native session UUID at `mcp-serve`/`connect` time — claude (session id from the transcript path / hook context / env), codex / gemini / agy (their equivalents). Where a provider truly exposes none, fall back to a minted UUID cached per `(workspace, provider-process)`, and log that the weaker fallback was used. The provider session UUID is preferred because it is authoritative per running agent and survives label changes.

**Net**: `instance = host:label:uuid8` where the UUID is the perennial agent UUID; the perennial agent is bound to `(provider, providerSessionUuid, workspaceId)` so reconnects reclaim and collisions split — deterministically, at the connection layer, before any addressing/keyring/negotiation touches `instance`.

---

## Migration — transparent, beneficial, immediate (PRINCIPAL build requirement, 0.20.0)

> **Verbatim (PRINCIPAL)**: « il faut absolument que la migration (immédiate pour les utilisateurs comme moi) soit transparente (et bénéfique). »

Hard requirements for the 0.20.0 rollout to live users (who already have `claude:label` registrations, keys, inboxes, history on a shared bus):

- **Immediate, zero manual step**: the existing auto-upgrade + in-place re-exec (DEC-108) lands 0.20.0; the **next auto-connect performs the migration itself** — no command to run. `store migrate` (if used) is idempotent + auto-invoked; the connect path is self-healing.
- **Transparent (no breakage)**: schema stays **additive** (optional `workspace`/`name`/uuid); **legacy bare `claude:label` ids remain valid addresses**, so in-flight inbox messages, existing registrations and keys keep working through the transition. Forward- and backward-compatible (a downgrade still reads the data).
- **Legacy continuity (no re-keying, no lost mail)**: a legacy `claude:label` that maps **unambiguously** to a single agent (one provider session in that workspace) is **adopted** as that agent's perennial identity — its existing keyring + inbox + history carry over; the legacy id becomes an **alias** of the new perennial UUID. Nothing is regenerated, nothing is lost.
- **Collision split = the benefit**: where a legacy id was shared by several live agents (the bug), the first reconnects **split** them into distinct perennial identities (each bound to its provider session UUID); the legacy shared id is kept as a **transitional alias** whose inbox stays readable during a grace window so no message is dropped, while new traffic routes to the now-distinct identities. The collision **resolves itself in the user's favour**.
- **Beneficial + observable**: immediately each agent gains its own traceable NHI (attest/inventory/offboard finally meaningful), workspace grouping, and remote-auth disambiguation — with nothing to do. Surface a one-line notice (`migrated: N agents de-collided, workspace ws:<id> registered`) so the benefit is visible.

This makes the migration a **net upgrade the user simply receives**, not a chore — exactly the "transparente et bénéfique" bar.

---

## Provider session resolution (investigation outcome, 2026-05-30) — UNBLOCKS the build

Per-provider native session UUID (the de-collision anchor):
- **claude** — `env.CLAUDE_CODE_SESSION_ID` (UUID). **Proven** inheritable to the spawned MCP subprocess (matches the transcript filename); stable across `--continue`/`--resume`, distinct per concurrent session. Solid.
- **codex** — `env.CODEX_THREAD_ID`; fallback = newest `~/.codex/sessions/**` rollout whose `session_meta.payload.cwd === cwd()` → `payload.id`. MCP-subprocess env presence unconfirmed (codex `shell_environment_policy` may strip) → **live test**.
- **gemini** — `env.GEMINI_SESSION_ID` (proven for hooks); fallback = `~/.gemini/tmp/<projectKey>/logs.json` last `sessionId` where `.project_root === cwd()` (match by `.project_root`, do NOT recompute the key hash). MCP path unconfirmed → **live test**.
- **agy** — `env.ANTIGRAVITY_CONVERSATION_ID` (format-string in the binary; strongly indicated). Conversations are flat (no per-workspace index) → take the workspace from h2a's own `cwd()`. MCP env presence → **live test**.

**Uniform resolver** (pure, core/CLI), called at `mcp-serve` boot (`runMcpServe`/`resolveAutoOpen`) + `cmdConnect` + the stop-hook record path:
```
resolveProviderSession({ host, env, cwd }) -> { providerSessionId?, source: "env"|"transcript"|"minted-fallback", workspaceHint? }
```
Env-first (the channel all four use to spawn `h2a mcp-serve`); per-provider transcript fallback where it exists; else **mint + cache per `(workspaceId, provider)`** at `<root>/.h2a/provider-session/<host>.json` (NOT by PID — PID is not reconnect-stable) and log `source:"minted-fallback"`. De-collision binding registry keys on `(host, providerSessionId, workspaceId) → agentUuid`.

**Plumbing note**: the MCP `initialize` `params` are currently discarded (`stdio.ts:106`); capture them so a `clientInfo`/roots fallback exists, and have `renderStopHook` (`hosts/plugin.ts:91`) forward the hook `session_id` into the `drumbeat record` command (claude/codex/gemini all expose `session_id` to hooks → the stop path can stamp it without relying on env).

**Live tests to run during the build** (env-first works regardless thanks to the fallback): confirm `CODEX_THREAD_ID` / `GEMINI_SESSION_ID` / `ANTIGRAVITY_CONVERSATION_ID` are present in the env of an MCP server spawned by codex / gemini / agy respectively. claude is already proven.

→ The identity fix is now fully specified and unblocked; the TDD plan (this doc) + this resolver are sufficient to build 0.20.0.

---

## Stabilization — adversarial Opus 4.8 review (2026-05-30) — CHANGES THE BUILD

The diagnosis + the 3-layer model are sound, but the central security claim is unmet in code. Findings:

- **F1 (FATAL)** — reclaim is anchored on a **spoofable env var with NO proof-of-possession**. Code is TOFU (DEC-035:371; `registerInstance` `store.ts:363` dedups only on `id`; `addInstanceKey` `store.ts:402` requires only that the instance exists; remote auth resolves keys by `actor.instance` `serve.ts:37`). A local process presenting a victim's `CLAUDE_CODE_SESSION_ID` + `workspaceId` reclaims the victim's `agentUuid` → its inbox, signer slot, and can then attach its own key. "Key-anchored NHI" is aspirational, not implemented → **a security regression as written.**
- **F2 (SERIOUS)** — the minted fallback keyed per `(workspace, provider)` (line 99) **re-collides** two concurrent same-workspace/same-provider agents (same cache file → same id). The de-collision is a no-op for exactly the providers (codex/gemini/agy) whose env is unconfirmed.
- **F3 (SERIOUS)** — reclaim-vs-mint is a read-decide-append TOCTOU; no single-lock perimeter specified → double-mint / tuple-stomp.
- **F4 (SERIOUS)** — migration "alias inbox readable + no re-keying" is unbacked: legacy `claude:sentropic` → inbox dir `claude__sentropic` ≠ composite `claude__sentropic__<uuid>` (`paths.ts:87`, `safePathSegment` maps `:`→`__`). Default behaviour strands or double-delivers mail; collision-split sharing one legacy keyring = key confusion.
- **F5/F6 (model)** — nothing parses `instance` by `:` (good: uuid8 safe; but "greppable structure" buys nothing — forbid future `:`-splitting). Freeze the handle at mint (rename = display only, never moves the inbox). Widen uuid8→uuid12. Workspace id in a git-ignored cwd file aliases across clones/containers → salt by machine-id + realpath, mint into a per-host registry.
- **F7 (minor)** — `nhi offboard` is per-`id` (correct post-fix) but unsafe against a live legacy-alias during the migration window.

### What survives (the build MUST adopt)
1. **Proof-of-possession at reclaim** (closes F1): reclaim requires signing a fresh server nonce with the private key already bound to that `agentUuid` (verify via `verifyCanonical`/`verifyEnvelopeSignature`). No key → no reclaim → mint fresh. The **ed25519 keypair is the sole authority anchor**; the provider session id is demoted to a **routing hint** only. `addInstanceKey` requires a signature by an already-active key (signed rotate-in).
2. **Fallback mints per agent keypair fingerprint** (closes F2), not per `(workspace, provider)` — so reconnect-with-same-key reclaims, new key mints.
3. **One lock**: binding read+decide+append inside one `registryLock` critical section (closes F3).
4. **Migration = dual-read + dedup-by-`envelope.id`** over `{newDir ∪ legacyDir}` with single-writer cutover (closes F4 mail loss); **one** split agent inherits the legacy keyring (first to prove possession), the others **mint net-new keys** → soften the spec's "no re-keying" to "no re-keying for the adopting agent; net-new key for the de-collided peers". Forbid `nhi offboard` on a live legacy alias.
5. Freeze `instance` at mint (uuid12); never parse it by `:`; salt the workspace id by machine + realpath.

### Verdict on ratified choices
Option A composite instance — **hold** (widen to uuid12, freeze at mint). Provider-session-uuid — **demote to routing hint**, key-possession is the anchor (load-bearing change). Transparent migration — **hold the goal, change the mechanism** (dual-read + dedup; honest re-key for split peers). Env-first + fallback — hold env as hint, **fallback mints per keypair fingerprint**.

### Residual decisions — PRINCIPAL (not derivable)
1. **Threat model**: is a hostile/buggy **same-user local process** in scope? If yes → proof-of-possession (F1) is mandatory + private key needs at-rest protection (file perms / OS keystore). If "single trusted user, same machine" is declared out of scope → F1 is defense-in-depth and the env anchor can ship with a documented caveat. **This one call sizes the whole slice.**
2. **Migration re-keying honesty**: accept "one agent inherits the legacy key, the de-collided peers mint fresh" (surfaced in the notice), or invest in per-agent key-provenance migration?
3. **Workspace on clone/container**: is a copied checkout the *same* workspace or a *new* one? (salt-by-machine = new; travels-with-tree = same.)
