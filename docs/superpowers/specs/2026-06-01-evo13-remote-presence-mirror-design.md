# EVO-13 — Remote presence mirror (signed, key-enrolled, event-replicated)

Status: design (approved 2026-06-01). Supersedes the first "snapshot upsert"
sketch, which an Opus 4.8 adversarial review rejected (À REVOIR) on three
structural grounds — captured under "Why the first sketch was wrong" below.

## Problem

The EVO-12 hosted MCP (`https://h2a-mcp.sent-tech.ca`) exposes a read-only
surface (`h2a_discover_instances`, `h2a_discover_sessions`, `h2a_nhi_inventory`,
`h2a_nhi_report`, `h2a_conflict_posture`, `h2a_blockage_list`) for claude.ai
enrollment. Those tools read the server's `H2A_ROOT` on the PVC. That root is
**empty**: no local agent is registered there, so claude.ai would see nothing.
There is no value in enrolling the connector until the user's local agents are
represented on the remote.

This design makes a local agent's **registration** (P1), then **presence** (P2),
then **NHI events** (P3) appear on the remote `H2A_ROOT`, so the read-only
surface reflects reality — without weakening any existing invariant.

## Invariants (non-negotiable)

1. **DEC-116 / "always think remote too".** The ed25519 private key never
   leaves the agent and never reaches the remote. The remote trust boundary
   does **not** get the relaxed local TOFU: authority is **possession of a key
   already known to the remote**, never a self-declared instance id.
2. **Hosted MCP surface stays read-only.** The `readonly-allowlist` invariant
   (no exposed tool takes `privateKeyPem`) is untouched. Replication ingestion
   is a **separate signed channel**, not an MCP tool, and not served by the
   claude.ai-facing read-only process.
3. **2-package strict.** `@sentropic/h2a` (core) stays dependency-free; the
   shared record/envelope **schema types** live in core (pure) so client and
   ingester share one contract. The store, servers, and CLI verbs live in
   `@sentropic/h2a-cli`.
4. **Reuse the EVO-11 transport.** Signature verification + replay guard +
   delivery already exist in `runtime/remote` (`acceptRemoteEnvelope`,
   `remoteServerForStore`, `signEnvelope`). No new auth model, no bearer token,
   no new envelope verifier.

## Model (key-enrolled event replication)

### Identity & authority
- Each local agent owns its ed25519 keypair; the private key stays local.
- The agent's instance id + **public key** is **pre-enrolled** on the remote by
  an explicit operator act (the operator has remote access; e.g. an admin write
  to the remote registry, or `h2a remote enroll` output installed operator-side).
  The replication channel **never registers an unknown instance/key** (no
  race-to-register, no namespace squatting).
- **Namespacing is derived from the verified signing key**, not from the
  self-declared `actor.instance`: an envelope signed by key K may only write
  records for instances for which K is an active key on the remote
  (`store.listInstanceKeys`). This is the existing authority anchor of DEC-116.

### What is replicated, and how
- The registry files (`instances.jsonl`, `keys.jsonl`, `subagents.jsonl`,
  `offboard.jsonl`) are **append-only event logs**. Replication replays the
  **missing events**, never overwrites. Tombstones (offboard) and `revoked`
  events therefore propagate naturally — no lost-deletion, no false-active NHI.
- **Presence (P2) is derived on the remote**, not re-stamped from the local
  clock. The remote computes freshness from the **actual arrival time of the
  replication POSTs** (remote clock), bounded by the real push interval. A dead
  agent stops pushing → its presence expires naturally. A **per-instance
  monotonic sequence number** (fencing) makes the ingester reject any event
  stream older-or-equal to the last applied, so a pod restart + replayed old
  payload cannot resurrect stale presence/keys.

### Ingestion topology
- Ingestion runs **outside the read-only MCP process** — a **separate
  deployment** that co-mounts the store and writes it; the claude.ai-facing MCP
  pod stays strictly read-only.
- **DECIDED (verified on the `poc` Kapsule, 2026-06-02):** RWX is available via
  storage class **`matchid-rwx`** (`filestorage.csi.scaleway.com`) and already in
  production — the `sentropic-remote` tenant runs 5 `ReadWriteMany` PVCs on it.
  So the store PVC moves to **RWX (`matchid-rwx`) + `H2A_LOCK_MODE=lease`**
  (DEC-065/067), letting the read-only MCP pod and the ingester co-mount it. No
  in-process fallback needed. Presence writes on the remote go through a
  **locked** path, not the lockless `writePresence` (which assumes the session
  owns its own file — false here, the ingester writes on behalf of others).

## Components

**Core (`@sentropic/h2a`, pure):**
- `MirrorEvent` / `MirrorEnvelope` schema types — the contract shared by client
  and ingester (instance-registration event for P1; presence + NHI event shapes
  reserved for P2/P3).

**CLI (`@sentropic/h2a-cli`):**
- `buildInstanceMirror(store)` — P1: produce the local instance's registration
  event(s) (id + public keys) as `MirrorEvent`s. (P2 adds presence, P3 reuses
  `gatherNhiSnapshot` to emit key/subagent/offboard events.)
- `h2a remote enroll` — operator one-time: emit the local instance id + public
  key for the operator to install on the remote registry (the pre-enrollment).
- `h2a remote mirror --url <ingest> --root <local> [--interval N]` — ongoing:
  build → `signEnvelope` (local private key) → POST signed envelope → repeat.
  Interval coordinated with the replay-guard freshness window and presence TTL.
- **Ingester** — extends the `remoteServerForStore` / `acceptRemoteEnvelope`
  path with a `mirror` handler: after signature verification (public key from
  the remote registry) + replay guard + sequence fencing, it **appends** the
  instance-registration events **namespaced by the verified key**. Served by a
  process distinct from the read-only MCP.

## Auth / trust
- Pre-enrolled public keys (operator). Every payload is an ed25519-signed
  envelope verified against the remote registry keys — identical to
  `acceptRemoteEnvelope`. No bearer token. Replay guard **plus** durable
  per-instance monotonic sequence (fencing) for mutable state. The verifier is
  **pluggable** so ingestion auth can later defer to a 39-auth-issued credential
  (P3) without reworking the channel.

## Data flow (P1)
```
operator: enroll(agent pubkey) ──► remote registry/instances.jsonl (trusted write)
agent:    buildInstanceMirror → signEnvelope(privkey) → POST /…/mirror
ingester: verify sig vs enrolled pubkey → fence(seq) → append instance event
hosted:   h2a_discover_instances reads registry/instances.jsonl
claude.ai: sees the local agent
```

## Phasing
- **P1 (this slice): instances only.** Operator enrolls one agent's key; agent
  pushes its signed instance registration; ingester applies it; the hosted
  `h2a_discover_instances` returns it; claude.ai sees the agent. Fully
  demonstrable end-to-end, and it avoids the presence/TTL hazard entirely.
- **P2: presence**, derived on the remote (arrival-time TTL + sequence fencing).
- **P3: NHI events** (keys/subagents/offboard, append-only) + **39-auth
  federation** of the ingestion verifier.
- **Out of scope:** `h2a_conflict_posture` (derives from negotiation journals,
  not the registry — it stays empty until negotiations are replicated) and
  `h2a_blockage_list` (later). The hosted surface must not promise data this
  design does not feed; P1 only lights up `discover_instances`.

## Testing
- Unit: `buildInstanceMirror` shape; ingester **rejects an unknown key** (no
  TOFU), **rejects a record whose instance the signing key does not own**,
  accepts an enrolled key; sequence fencing rejects an older-or-equal stream.
- E2E: enroll → mirror → `discover_instances` returns the instance; tampered
  signature → rejected; non-enrolled key → rejected; replayed old payload after
  restart → rejected (no resurrection).

## Risks / open questions
- ~~RWX on Kapsule~~ — RESOLVED: `matchid-rwx` storage class available + in use
  (`sentropic-remote`); the store PVC uses it with lease locking.
- **39-auth contract**: keep the verifier interface narrow so the enrolled-key
  check can later defer to 39-auth without changing the wire format.

## Why the first sketch was wrong (Opus 4.8 review, 2026-06-01)
1. **TOFU + shared `H2A_MIRROR_TOKEN` on the remote** contradicted ratified
   DEC-116 ("always think remote too"); namespacing by self-declared
   `actor.instance` is not a security boundary (race-to-register / squat).
2. **Snapshot upsert-only** could not propagate deletions/expiry/revocations →
   immortal ghost presence (re-stamped heartbeats), false-active NHI, replay
   resurrection after restart.
3. It **reinvented EVO-11/DEC-122** (registration + signed bridge) and hit an
   unresolved RWO ↔ read-only-pod tension.
The corrections above (no TOFU, key-derived authority, append-only events,
remote-derived presence with fencing, reuse of the EVO-11 transport, separate
ingester) are this design.
