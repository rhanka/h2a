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
