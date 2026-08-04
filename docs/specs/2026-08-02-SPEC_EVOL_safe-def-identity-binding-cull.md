# SPEC_EVOL — Safe cull of churn-minted DEF identity bindings

- **Owner lane:** runtime (WP5 identity)
- **Status:** design and safety proof only; no cull is authorized by this document
- **Target store (DEF):** `/home/antoinefa/h2a-workspace/.h2a`
- **Protected store (PIN):** `/home/antoinefa/src/a2a-cli`
- **Authority:** the conductor may present a completed proof packet; only the owner may authorize the destructive stage
- **Safety posture:** fail closed — life, ownership, protected identity, missing evidence, parser failure, race, or ambiguity means **KEEP**

## 1. Purpose and non-goals

This specification defines how a future, separately implemented operation may identify and reversibly stage only those DEF `identity/bindings.jsonl` records proven to be garbage produced by the reclaim-key defect. It also defines the evidence the conductor must attach when asking the owner for a destructive go.

This document does **not** execute a cull, authorize one, or specify a general identity/data-retention policy. It does not delete, rewrite, move, or repair a binding, key, alias, presence record, registry row, inbox, outbox, loop, negotiation, decision, Track event, or either store. Headline volume and random-ID disjointness are observations, never deletion authority.

The object in scope is narrowly the binding record in DEF's `identity/bindings.jsonl`. Related identity material is read-only evidence and remains out of scope.

## 2. Read-only measurement, 2026-08-02

The following snapshot was measured at `2026-08-02T05:30:30Z`. The files are live, so these values describe that snapshot only.

| Measure | DEF | PIN | Interpretation |
|---|---:|---:|---|
| Binding rows | 24,304 | 193 | DEF had already advanced by three rows from the 24,301 headline. A cull set must never be a hard-coded count. |
| Unique `instance` values | 24,304 | — | Every measured DEF row represented a distinct instance. |
| Unique `agentUuid` values | 24,304 | — | Every measured DEF row represented a distinct UUID. |
| Unique `(host, providerSessionId)` values | 17,653 | — | Provider-session keys are not one-to-one with minted identities. |
| Provider-session keys mapping to multiple DEF instances | 4,548 | — | Binding data alone does not establish why a particular row was minted or that it is harmless. |
| Fallback provider-session rows | 199 | — | `fallback:<host>:<workspaceId>` is workspace-stable and does not bear the stated provider-conversation churn signature; default **KEEP**. |
| Non-fallback rows | 24,105 | — | Necessary, not sufficient, for the churn signature. |
| DEF/PIN `instance` intersection | 0 | — | Disjointness is observed, but is not a safety property. |
| DEF/PIN `agentUuid` intersection | 0 | — | A random-ID non-collision cannot protect real actors or owner data. |

Snapshot hashes were:

- DEF bindings: `sha256:01f3d7df379adb4fe6791812182465cf7e2c8fd72cc9b4ab6dbe8bbabbe301b7`
- PIN bindings: `sha256:337260eb0ea575f50e0fae01de770aaccc07ba9c854a9fc48403d9d5b49258fa`

The mid-July burst is directionally confirmed but the brief's “~77% in ~8 days” is not a precise boundary: 19,255 rows (79.22% of the measured DEF snapshot) were timestamped from July 10 through July 21 inclusive, while 18,335 (75.44%) were timestamped from July 11 through July 21 inclusive. The execution proof must use an independently established defect-deployment interval, not choose dates to fit a percentage.

The current implementation and tests key `findBinding`/`reclaimOrMint` on `(host, providerSessionId)` and describe provider conversation identity as intentional. A root-fix therefore needs an explicit superseding identity decision; cleanup must not silently redefine that contract.

## 3. Definitions and frozen inputs

For one proof run `R`:

- `DEF_R` is the canonical, realpath-resolved DEF root and `PIN_R` the canonical PIN root.
- `B_R` is the exact byte snapshot of DEF `identity/bindings.jsonl` identified by path, device, inode, size, line count, and SHA-256.
- The decision atom is an **identity component** `i`: the transitive closure of binding rows joined by a shared `instance`, `agentUuid`, `(host, providerSessionId)`, alias, proof-of-possession lineage, continuity/supersession edge, or other identity-resolution edge. Every row receives a `rowFingerprint = sha256(exact line bytes)` and original line number. All rows in a component receive one decision; a conflicting edge, row, or gate verdict means KEEP for the whole component. This prevents filtering a newest last-wins row while exposing an older row for the same lookup key.
- `P_R` is the protected-identity set: the three ratified real actors, every owner/human identity and alias, every identity selected by the ratified org/owner allowlist, and every PIN identity. `P_R` is itself hash-addressed.
- `E_R` is the preserved, hash-addressed evidence corpus and closed-world coverage proof used for life, ownership, protection, and churn provenance. It includes a source → parser → identity-edge → gate dependency graph. Its source set is independently derived and reconciled from the pinned runtime/store schema, configuration, canonical registrations, workspace history, configured remotes, filesystem discovery, and an owner-ratified external-source registry. A gap propagates `UNKNOWN` to every dependent gate.
- `W_defect = [t_start, t_stop)` is the independently attested interval in which the defective reclaim behavior was active. Release/deployment evidence establishes both endpoints. An approximate date histogram does not.
- `T_mcp` is the recent-MCP veto lookback. It must be recorded in the proof, may not be shorter than the runtime's canonical ten-minute advisory window, and must include clock-skew and propagation margins. It never proves that a provider conversation is terminal or non-resumable.
- `S_R` is the owner-ratified, collision-resistant root-fix migration map that records canonical actor continuity/supersession and retirement of legacy provider-session lookup keys without merging concurrent actors.

No proof may use an unresolved symlink, a basename-only store comparison, a partial evidence inventory, or a mutable “latest” reference.

## 4. Cull predicate: four ALL-must-hold logical conjuncts

Let `L(i)`, `O(i)`, `P(i)`, and `C(i)` mean respectively **no life**, **no owned work**, **not protected**, and **proven churn signature**. The exact cull set is:

`CULL_R = { i in B_R | L(i) AND O(i) AND P(i) AND C(i) }`

Every gate returns one of `PASS`, `FAIL`, or `UNKNOWN`. Only four `PASS` results yield `WOULD_CULL`. `FAIL` or `UNKNOWN` on any gate yields `KEEP`. Evidence is evaluated over the whole identity component. The conjuncts are logically separate but may share sources/parsers, so an `E_R` dependency gap invalidates every affected result rather than being counted as four independent confirmations.

### 4.1 Gate L — no evidence of life

`L(i) = PASS` only when all of the following are positively established at the proof timestamp:

1. **No presence artifact:** no canonical, temporary, partial, stale, mirrored, or otherwise parseable presence file refers to `i`. The brief's condition is absence of a presence file, not merely an expired heartbeat. An unreadable candidate presence file is ambiguity and keeps every identity it might cover; it never counts as absence.
2. **No live process/session:** a single fleet-wide tmux/process inventory contains no session, pane, custom option, worker attribution, PID/start-time/boot-id tuple, launch name, or session lease resolving to `i`. A bare PID check is insufficient because PIDs recycle.
3. **No recent MCP activity:** every authoritative MCP activity source in `E_R` was successfully read and contains no traffic attributable to `i` in `T_mcp`. `lastMcpActivityAt` is MCP evidence; a heartbeat is process evidence only. If the installation has no complete activity source beyond a now-absent presence file, this condition is unprovable and the result is `UNKNOWN`, not zero.
4. **No live alias:** no alias, durable name, provider-session key, registry row, session descriptor, or lease resolves from `i` to an identity with evidence of life.
5. **Resume is safe:** every provider session and launch lease in the component has authoritative terminal/non-resumable status, **or** `S_R` proves that every resume/reconnect resolves to a surviving canonical identity without a fresh mint, inbox/key collision, or predecessor-row resurrection. A resumable transcript/session, valid unreconciled proof-of-possession lineage, provider with no terminality authority, or missing supersession edge is KEEP/UNKNOWN.
6. **Two observations agree:** the dry-run observation and the fenced final observation both pass. Any new evidence between them removes `i` from the set and invalidates the prior packet.

Current inactivity is not terminality. `T_mcp` is veto-only, and the post-stage behavior of a binding that can no longer reclaim itself cannot be used as proof that it was safe to remove.

### 4.2 Gate O — no owned work or attribution dependency

`O(i) = PASS` only after a schema-aware scan plus a byte-search backstop establishes zero references that carry authorship, participation, addressing, decision, responsibility, or recoverability meaning. At minimum, `E_R` must enumerate and successfully scan:

- every DEF inbox, outbox, envelope, negotiation journal/state, loop event/state, engagement, blockage, escalation, governance/decision artifact, drumbeat/processed record, and other protocol log;
- every Track event/item/decision store reachable from workspace registrations associated with the binding, plus the owner/conductor-declared Track roots that may contain cross-workspace attribution;
- all provider-native transcript/session stores and resume/fork indices for every candidate `providerSessionId`, including archived/moved forms, transformed identifiers, and every historical path for the durable `workspaceId`;
- git, archive, backup, and mirror attribution stores declared in the closed-world inventory;
- registry, alias, key-history, presence/session/lease, and workspace mappings as evidence sources, even though none is modified;
- any external or mirrored evidence store declared authoritative for this fleet.

Mechanical registration/key existence, which is created for every mint, is not by itself “owned work”; it is still checked for aliases, proof-of-possession, recent use, and conflicts. Conversely, any authored/participant reference is conservatively meaningful. The cull process may not decide that historical work “does not matter.” Such a retention exception would require a separate owner-ratified policy.

A missing/historical workspace path, unresolved candidate-to-transcript/session join, transformed identifier that cannot be reversed, inaccessible Track/provider store, unknown file type, malformed record, parser/schema mismatch, truncated scan, or incomplete source inventory makes `O(i) = UNKNOWN`. A substring search cannot replace schema-aware extraction, but it can veto a PASS. A still-valid, unreconciled proof-of-possession key/lineage is also a resume/supersession veto under Gate L even though mechanical key creation alone is not owned work.

### 4.3 Gate P — not a real actor, owner, or protected identity

`P(i) = PASS` only when all of these hold:

- neither `instance` nor `agentUuid` nor any alias is in `P_R`;
- no durable name/role resolution associates it with `runtime`, `cond`/`conductor`, `arch`/`architect`, the principal, a human/owner actor, or an owner-provided alias;
- it is absent from PIN and no PIN identity resolves to it through a provider-session, alias, registration, or proof-of-possession lineage;
- the positive-control checks in section 6 all pass.

Name comparison is an additional veto, not an identity join. Store disjointness and the 12-hex suffix do not discharge this gate. The owner identity list must be explicit, ratified, and hash-addressed; the currently proposed `org.h2a.yaml` name `fabien` is not an exhaustive identity map.

### 4.4 Gate C — proven reclaim-key churn signature

`C(i) = PASS` only when every condition below is evidenced:

Distinct provider conversations are legitimate by default under the currently ratified contract. Host, workspace, label, or launch name — alone or combined — must never establish that two conversations are one actor. PASS requires `S_R` to provide a collision-resistant, owner-ratified continuity/supersession record that preserves concurrent actors and proof-of-possession roots. Concurrency, multiple unattested PoP roots, missing canonical successor, or missing legacy-key retirement is UNKNOWN.

1. Every binding row for `i` was appended inside `W_defect`.
2. `providerSessionId` is a real provider-conversation value, not `fallback:*`, missing, malformed, synthesized from an unknown source, or reused ambiguously across hosts.
3. The row is proven to be a mint produced by the affected `reclaimOrMint` path and code/deployment version. Timestamp coincidence is insufficient.
4. `S_R`, not a heuristic lineage inferred from names/workspaces, places `i` in an attested multi-mint continuity component with distinct provider sessions and minted UUIDs, identifies the surviving canonical identity where one exists, and marks the component's legacy lookup keys retired.
5. No evidence suggests a deliberate one-conversation/one-identity actor, concurrent legitimate actor, test fixture that owns results, imported identity, migration, fallback mode, manual override, remote identity, or other mint cause.
6. The churn classifier version, inputs, cluster members, and reasons are recorded per ID and are reproducible from `B_R` and `E_R`.

The 4,548 measured provider-session keys associated with multiple identities are evidence of abnormal minting, but not standalone deletion authority. A singleton, a row outside an attested defect window, or a row whose stable lineage cannot be reconstructed is `UNKNOWN` and stays.

## 5. Never-touch boundary

The future operation must enforce, before opening any output file, all of these invariants:

1. **PIN is entirely read-only and excluded:** canonical root `/home/antoinefa/src/a2a-cli`; no file below it may be created, moved, renamed, linked, chmodded, rewritten, truncated, or deleted.
2. **The real actors are immutable controls:**
   - runtime: `claude:h2a:e3c21fe83da3` / `e3c21fe8-3da3-4cf3-a837-6fdbadda8d95`
   - conductor: `claude:h2a:c18853e319ea` / `c18853e3-19ea-410f-bba8-88f69d97d9b5`
   - architect: `claude:h2a:87db03b72762` / `87db03b7-2762-43fb-8977-8dd67f625c82`
3. **Owner/human identities and owner data are immutable:** the ratified owner allowlist is unioned into `P_R`; any `focus:local-human`, principal, owner name, owner alias, or ambiguous human attribution is a veto.
4. **Within DEF, only the binding transaction may write:** keys and key history, aliases, registry, presence, inbox, outbox, loops, negotiations, engagements, governance, Track data, leases, status, policies, and all other persistent files are read-only evidence. The write-set manifest contains exactly the active binding replacement, one transaction staging inode, and the canonical `identity/.lock` sentinel lifecycle described in sections 7–8 (or an owner-ratified lock outside DEF). No other DEF file may be created or changed, and no general binding-directory write permission is implied.
5. **Quarantine is outside PIN and outside the active DEF tree:** it is an owner-approved, access-controlled path on durable storage. It contains only the binding snapshot and proof material necessary for restoration; it must never be confused with an active store.
6. **Exact-target checks are mandatory:** canonical path, device/inode, schema, and snapshot hash must match the approved packet. A mismatch aborts before mutation.
7. **The boundary is structurally enforced:** execution occurs under OS-enforced write confinement. PIN and every evidence root are mounted/read-open-only; the only writable locations are the approved quarantine directory and the pinned DEF binding-directory transaction. Roots and binding files are opened once with no-symlink/beneath/no-cross-device resolution; file/directory descriptors remain held and are re-`fstat`ed through commit. All creation/rename operations are descriptor-relative. Unexpected hard links, mount changes, unsupported confinement, or descriptor/path mismatch abort. Hashes detect drift but do not replace write confinement.

## 6. Required safety-proof packet

The dry run is read-only and produces a self-contained, immutable packet. It must list exactly what **would** be culled, not a sample or aggregate.

### 6.1 Required artifacts

- `run-manifest.json`: run ID; UTC times; operator; tool source commit and binary hash; canonical DEF/PIN paths and filesystem identities; schema versions; `W_defect`; `T_mcp`; evidence-source inventory, parser versions, completeness/freshness results; snapshot hashes/counts; protected-set and owner-allowlist hashes.
- `coverage.json` and `dependencies.json`: the independently derived closed-world source set, recursive path inventories, exclusions with ratified reasons, and the source → parser → identity-edge → gate graph with reconciliation results.
- `evidence/`: the exact captured bytes or signed canonical query responses for every source used by every gate, including `lstat`/filesystem metadata, acquisition start/end times, mount/boot/clock identity, command/query exit status, and truncation/error state. Ephemeral tmux/process observations carry a signed acquisition attestation bound to the fence epoch.
- `decisions.jsonl`: exactly one decision per DEF identity component, containing all member rows/edges/line numbers/fingerprints, raw identity fields, four gate verdicts, machine-readable keep/cull reasons, evidence references and hashes, and final `WOULD_CULL` or `KEEP`.
- `would-cull.jsonl`: the exact ordered subset of rows proposed for removal, with row fingerprints and per-component evidence references.
- `keep.jsonl`: every remaining identity and at least one decisive KEEP/UNKNOWN reason.
- `lookup-replay.json`: before/after replay of runtime's last-wins `(host, providerSessionId)` lookup for every key, canonical-successor/retirement evidence, and proof that filtering exposes no predecessor or different effective binding.
- `positive-controls.json`: the actor/owner/PIN assertions below and their evidence.
- `summary.json` and a human-readable report: counts by gate and reason, parser/source failures, ambiguous IDs, input/output count reconciliation, and hashes of every packet member.

The packet invariant is `DEF identity components = WOULD_CULL + KEEP`, with no duplicate, omission, split component, or undecided row. Each `WOULD_CULL` decision must show `presenceRefs=0`, `liveSessionRefs=0`, `recentMcpRefs=0`, `ownedWorkRefs=0`, `protectedRefs=0`, terminal/supersession proof, and a non-empty reproducible churn proof. Zero without source-completeness evidence is invalid.

A clean-room verifier with no access to mutable live state must rederive `decisions.jsonl`, `would-cull.jsonl`, `lookup-replay.json`, and the predicted filtered bytes/hash `K_R` byte-for-byte from the preserved packet. Unpreserved evidence, an undiscoverable source, or a non-reproducible query makes every dependent gate UNKNOWN.

### 6.2 Positive controls

The proof must fail unless it demonstrates all of the following:

1. The three real actor bindings above are present in the pinned PIN snapshot, absent from `would-cull.jsonl`, and PIN's binding hash is unchanged before and after every stage.
2. The full owner/human allowlist is absent from `would-cull.jsonl`. At least one known owner/human control must be resolved through each configured owner-identity source; an empty owner set is a failed control, not success.
3. Same-name DEF identities are not mistaken for the PIN actors. At measurement time the following DEF identities had fresh live presence and are explicit KEEP controls:
   - `claude:h2a:16f6e26295a3` (`h-runtime`)
   - `claude:h2a:c3d1621ed118` (`h-cond`)
   - `claude:h2a:8b329a6c9c31` (`h-arch`)
4. A binding with known owned work is detected and kept, proving that the ownership join is active rather than returning zero for everything.
5. A row outside `W_defect` and a `fallback:*` row are detected and kept, proving that the churn classifier is not merely “old/inactive = garbage.”
6. For each Gate P resolution route — exact instance, UUID, owner alias, durable role, DEF→PIN provider-session/registration edge, and proof-of-possession lineage — a target-universe DEF control or faithful fixture fails P while the other three gates pass. A control already caught by L, O, or C does not validate P; an unexercised join cannot support `P=PASS`.
7. Two legitimate concurrent, same-workspace/same-name provider conversations stay separate and KEEP, and a multi-row same-provider lookup key stays as one component unless its whole component passes and `S_R` retires the key.

The actor control is intentionally cross-store: the real three are in PIN, not DEF. Requiring them to appear in DEF would contradict the measured topology and could tempt an unsafe identity substitution.

## 7. Fenced final proof, owner gate, and time-of-check/time-of-use control

The conductor's pre-fence dossier is informational only. It contains the preliminary proof packet, top-level hash, exact proposed count, all UNKNOWN/KEEP classes, quarantine location/retention, restoration procedure, root-fix status, and explicit statement that only DEF bindings are in scope. It does not authorize a future set computed from changing evidence.

The maintenance fence is a generation-numbered writer barrier covering every process/service capable of creating a DEF binding, presence/session/lease, MCP activity, alias/registration, message/protocol artifact, provider resume record, or attributed work for any candidate. Before final scanning, ingress closes, all registered writers drain pre-fence work and acknowledge the same epoch, and the executor proves no unregistered writer exists. The binding lock is acquired only after those acknowledgements. The epoch remains valid through evidence capture, final authorization, swap, directory fsync, and read-back. Missing acknowledgement, expired lease/fence, unfenceable source, unregistered writer, or any write not carrying the epoch aborts with no mutation. The binding lock alone is insufficient.

Under the held fence, the executor must:

1. prove OS write confinement and the canonical fence/lock epoch;
2. prove PIN is outside the write set and matches the pinned read-only snapshot;
3. capture the final `E_R`, recompute components and gates, replay lookup semantics, and clean-room verify the final immutable packet;
4. have the conductor present that final packet while the fence remains held;
5. obtain and verify `owner-authorization.json`, signed by a trusted owner key and binding: owner identity/key, nonce, expiry, run/fence IDs, canonical DEF filesystem identity, `B_R` hash, the ordered input row-fingerprint sequence, `would-cull.jsonl` hash, exact candidate component/row set, `K_R` hash, quarantine root/retention, and tool/classifier versions;
6. verify signature, trust, expiry, nonce/replay status, and revocation immediately before staging;
7. abort on any changed byte, ordered row, evidence item, protected set, fence state, candidate component, parser/tool version, or authorization field. No subset/superset substitution is permitted.

The owner authorization is approval of this exact fenced packet, never permission to “remove about 24k identities.” If the owner cannot review/sign before the bounded fence expires, release it without mutation and start a new final proof.

## 8. Reversible-first staging and restoration

This section is a required execution protocol, not authorization to run it.

### 8.1 Quarantine before active removal

Under the validated fence and lock, create an external quarantine package containing:

- a byte-for-byte copy of approved `B_R` with metadata and permissions;
- the complete proof packet and owner authorization;
- the exact removed rows with original line numbers/fingerprints;
- the predicted filtered prefix `K_R` hash;
- a restoration manifest that reconstructs original ordering.

Write, fsync, SHA-256 verify, make read-only, and independently read back the quarantine package **before** replacing the active binding file. A missing, unverified, writable-by-untrusted-users, or capacity-constrained quarantine aborts the operation.

Before swap, fsync every quarantine member, its manifest, the package directory, and its durable parent, then independently reopen and verify it. A fsynced quarantine transaction record advances only through `QUARANTINE_VERIFIED`, `SWAP_COMMITTED`, and `READBACK_VERIFIED`; deterministic crash recovery is defined for each phase.

The sole additional data inode permitted in DEF is one anonymous or collision-resistant `O_EXCL` staging inode in the pinned binding directory. The transaction may also create/write/remove exactly the canonical `identity/.lock` sentinel, whose identity, contents, fence epoch, holder, acquisition, and release are recorded in the write-set manifest. A pre-existing, unowned, or stale-looking lock is ambiguity and aborts; it is never automatically removed. Crash cleanup may unlink only a lock proven from the durable transaction record and process/fence evidence to belong to this transaction and to have no live holder.

The staging inode is written and fsynced, byte/hash verified as `K_R`, and never reopened through an untrusted path. Before rename, the executor captures from `B_R`, stores in quarantine, reproduces on the staging inode, and verifies every supported security-relevant attribute: owner/group, mode, ACLs, xattrs, SELinux/AppArmor or other security labels, file flags, and filesystem-specific metadata. Unsupported, unreadable, unreproducible, or post-application-mismatched metadata aborts before rename. The executor then performs a descriptor-relative atomic replacement and fsyncs the binding directory. Post-swap read-back re-verifies bytes and all security metadata. No in-place truncation or per-line mutation is permitted. Abort cleanup may remove only the transaction-recorded staging inode and eligible transaction-owned lock.

Immediately before commit, `lookup-replay.json` must prove that no retained `(host, providerSessionId)` changes effective last-wins binding and no predecessor becomes visible. A lookup key may disappear only when every row in its identity component passes all gates and `S_R` explicitly retires that key. Otherwise the component is KEEP.

#### Crash-state protocol

Each transition is durably recorded in the external quarantine transaction log by writing/fsyncing the record and its directory. Rename commit ordering is: durable `QUARANTINE_VERIFIED` → verified staging inode → descriptor-relative rename → binding-directory fsync → durable `SWAP_COMMITTED` → read-back → durable `READBACK_VERIFIED`. Recovery first reacquires the complete writer fence and exact-target descriptors; it never relies on a pathname-only observation.

| Durable transaction state on restart | Permitted active binding bytes | Required recovery action |
|---|---|---|
| No durable transaction state | `B_R` only | Treat as not started. Do not mutate DEF. Retain any unclassified quarantine/staging artifact for owner inspection. |
| `QUARANTINE_VERIFIED` | `B_R` or `K_R` | If exactly `B_R`, no swap committed: verify and remove only the recorded staging inode/transaction lock, then close as aborted. If exactly `K_R`, rename occurred before the next durable state: fsync the binding directory, durably record `SWAP_COMMITTED`, and continue read-back. |
| `SWAP_COMMITTED` | `K_R` only | Re-run full byte, lookup, security-metadata, PIN, and never-touch read-back. On success durably record `READBACK_VERIFIED`. |
| `READBACK_VERIFIED` | `K_R` only | Reverify the final hash/metadata, then resume the post-stage protocol; never repeat the swap. |

At any state, unexpected active bytes, missing/extra transaction objects, invalid log transition, fence/confinement failure, or unprovable directory durability means: keep quarantine, make no automated cleanup or new replacement, and stop for owner-directed restoration under a fresh complete fence. This rule covers crashes after rename but before directory fsync, after fsync but before `SWAP_COMMITTED`, and during read-back.

### 8.2 Read-back, rescan, and soak

Before releasing the fence/lock, read back and verify:

- active bytes/hash equal the predicted `K_R`;
- active row count plus quarantined row count equals `B_R`'s row count;
- every kept row is byte-identical and in original order;
- every proposed row and only those rows is absent;
- PIN and all non-binding DEF evidence hashes/metadata expected to be immutable are unchanged.

After writers resume, run an immediate fleet/evidence rescan. Any quarantined identity acquiring presence, MCP activity, owned-work evidence, protected resolution, or alias conflict triggers restoration, not a second deletion decision.

Quarantine remains through an owner-specified soak period long enough to cover reconnect/resume and delayed evidence propagation. A durable, gap-free activity/audit monitor covers the whole soak with recorded health and lag bounds. Candidate activity, monitor failure, audit gap, or evidence lag prevents hard deletion and triggers the specified restoration/escalation path.

Before real staging, a non-live byte-faithful fixture must rehearse a resume/reconnect against `K_R` and prove the root-fix migration reaches the surviving canonical identity without fresh mint, shared inbox/key, or predecessor resurrection. Hard deletion of quarantine is a separate owner-gated act whose signed authorization binds the exact quarantine manifest/hash after the soak and final proof; it is never implied by staging approval.

### 8.3 Lossless restoration with a live append-only tail

Restoration must not overwrite bindings appended after staging. Under the same complete writer-barrier protocol and a new fence epoch/identity lock, it pins and reads the active file once. `N` is exactly the bytes beginning at offset `len(K_R)` after bytewise prefix equality; it must be empty or complete, newline-terminated, schema-valid JSONL rows with no partial final record. Every tail-row fingerprint is recorded.

Before rename, the executor preserves and fsync-verifies the exact `N` bytes/fingerprints in the external restoration transaction package. Restoration inherits section 8.1's exact DEF write set, transaction-owned lock lifecycle, descriptor-relative confinement, complete security-metadata capture/reproduction/read-back, directory fsync, and unknown-state stop rules.

The executor builds `B_R || N` in a new transaction-recorded staging inode, fsyncs it, verifies the predicted hash and security metadata, performs descriptor-relative atomic replacement, fsyncs the binding directory, and reopens/read-backs the result before releasing the fence. Durable restoration ordering is: `RESTORE_INPUT_VERIFIED` → verified staging inode → rename → directory fsync → `RESTORE_COMMITTED` → read-back → `RESTORE_READBACK_VERIFIED`.

Recovery uses the same complete fence and permits: at `RESTORE_INPUT_VERIFIED`, exactly `K_R || N` (abort/clean only recorded transaction objects) or `B_R || N` (finish directory fsync and advance); at `RESTORE_COMMITTED`, exactly `B_R || N` followed by repeated full read-back; at `RESTORE_READBACK_VERIFIED`, exactly `B_R || N` and no repeated rename. At every phase, the recovered `N` must byte/fingerprint-match the preserved restoration package. Any other bytes, metadata, object, log transition, or durability state retains quarantine and stops for owner direction.

This restores original order and last-wins semantics while preserving new rows. Any prefix, parse, record-boundary, writer, confinement, metadata, or hash discrepancy forbids automated restoration; the owner receives the intact quarantine and diagnostics, and the executor must not guess or append old rows at the end. Quarantine remains until owner acceptance of the restored state.

## 9. Reclaim-key root-fix pendant (source stop)

Cleanup is blocked until the source is stopped. The binding log was still growing at measurement time, which demonstrates that a count-based cull would immediately become stale.

A separate identity design/fix must supersede the current `(host, providerSessionId)` reclaim contract with a stable key/proof model that reclaims across conversations without collapsing legitimately concurrent actors. At minimum it must:

- make provider conversation ID a routing/audit hint rather than the perennial reclaim key;
- retain proof-of-possession as the authenticator and specify key rotation/recovery;
- define the stable actor/launch lineage used across conversations;
- preserve concurrent-session isolation and prevent two actors from sharing an inbox or key;
- emit the collision-resistant continuity/supersession map `S_R`, including canonical successors and explicit retirement of legacy provider-session lookup keys;
- make mint vs reclaim reason/provenance observable so future lifecycle decisions are evidence-based;
- include migration, race, concurrent-start, resume, cross-workspace, owner/real-actor, and no-proof tests.

The order is: ratify and deploy the root fix, observe that defect-signature minting has stopped for an owner-approved window, produce the exact cull proof, obtain owner authorization, then stage reversibly. Culling first is not allowed.

## 10. Current unproven/KEEP identities and blockers

This design-time measurement does **not** certify any DEF identity as safe to cull. No exhaustive per-component ownership index, complete recent-MCP/resume audit, ratified owner identity map, attested `W_defect`, `S_R`, or reproducible component churn classifier was produced. Therefore the current `WOULD_CULL` set is empty until a compliant dry run proves otherwise.

Known explicit KEEP/UNKNOWN cases are:

| Identity/class | Current result | Reason |
|---|---|---|
| PIN runtime `claude:h2a:e3c21fe83da3` | NEVER TOUCH | Real actor; PIN is wholly excluded. |
| PIN conductor `claude:h2a:c18853e319ea` | NEVER TOUCH | Real actor; PIN is wholly excluded. |
| PIN architect `claude:h2a:87db03b72762` | NEVER TOUCH | Real actor; PIN is wholly excluded. |
| DEF `claude:h2a:16f6e26295a3` | KEEP | Fresh live `h-runtime` presence observed. |
| DEF `claude:h2a:c3d1621ed118` | KEEP | Fresh live `h-cond` presence observed. |
| DEF `claude:h2a:8b329a6c9c31` | KEEP | Fresh live `h-arch` presence observed. |
| DEF `codex:antoinefa:3ae2c4955912` | KEEP / owner ambiguity | Owner-like human/home identity; no ratified mapping proves it non-owner. |
| All 199 measured `fallback:*` rows | KEEP | They lack the stated provider-session churn signature. |
| Any row outside an attested `W_defect` | KEEP | Date coincidence cannot prove defect provenance. |
| Any identity in the remaining DEF population without a complete four-gate record | KEEP | Safety has not been proven from headline measurement. |

## 11. Acceptance criteria for a conductor dossier

The conductor may pose the destructive go only when:

1. the root fix is ratified, deployed, and observed to stop the source;
2. the protected/owner set is explicit, ratified, non-empty, and hash-addressed;
3. every DEF identity component has one reconciled decision and every proposed component passes all four gates, including terminal/resume-safe supersession;
4. last-wins lookup replay proves no effective binding changes or predecessor resurrection and every disappearing key is retired in `S_R`;
5. all positive and negative controls pass, including route-specific P controls, the three PIN actors, owner/human control, live same-name DEF controls, owned-work control, outside-window/fallback controls, legitimate concurrent conversations, and a multi-row provider key;
6. the closed-world evidence/dependency inventory is complete, every source/parser is healthy, and a clean-room verifier reproduces the final packet and `K_R` byte-for-byte;
7. a complete writer fence and OS-enforced write confinement remain valid through the signed final authorization, swap, directory fsync, and read-back;
8. quarantine/crash recovery has been independently verified, filtered-file resume/reconnect has been rehearsed safely, and lossless tail-preserving restoration has been rehearsed on a non-live fixture;
9. the owner signs the exact fenced manifest, ordered row set/hash, `K_R`, quarantine contract, and scope before fence expiry;
10. the gap-free soak monitor, post-stage read-back/rescan, restoration owner, and separately signed hard-delete gate are scheduled and owned.

Failure of any criterion produces no mutation.
