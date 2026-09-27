# Independent Adversarial Review: Lot 4 v2 Design (Unified Identity Succession Lock)

- **Target Design Document**: [`.lot4/lot4-design-v2.md`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md)
- **Reference Codebase Artifact**: `ec09dac9` (v0.97.9)
- **Reviewer**: Antigravity (Independent Adversarial Review)
- **Review Scope**: Verification of v1 closure, concurrency races (reclaim / CAS commit / GC / cull), write-order crash durability, machine identity constraints (containers / cloned images / NFS), failure retry classification (`identity_worker_failed`), and the architectural placement of [`succession-lock.ts`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a-runtime/src/succession-lock.ts) given [`cull.ts`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a-runtime/src/identity-cull/cull.ts).

---

## Executive Verdict

### **BUILDABLE-WITH-FIXES**

The core architectural direction of Lot 4 v2 is mathematically and conceptually sound:
1. Unifying prefix upgrade and identity binding exclusion around the atomic succession protocol ([`link(2)`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts#L701-L745) + `SUCC` chains).
2. Implementing true storage-level fencing via per-key CAS commit slots in `identity/commits/<kh>.<pred>.json`.
3. Adopting strict "in doubt, never dead" liveness invariants and first-occurrence deduplication.

However, implementation cannot proceed until **two critical blockers** (regarding machine identity collisions in cloned containers and monorepo package layering between `@sentropic/h2a` and `@sentropic/h2a-runtime`) and **three major specification gaps** (in `decideAndCommit` retry lifecycle, roll-forward slot cleanup, and legacy operator breaks) are explicitly corrected.

---

## 1. Status of Gemini v1 Findings (B1–B3, M1–M3, m1)

Every finding raised in the v1 review ([`.lot4/review-lot4-gemini.md`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/review-lot4-gemini.md)) was audited against [`.lot4/lot4-design-v2.md`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md) and verified against the committed code in `ec09dac9`:

| v1 Finding | Classification | Status in v2 | Verification & Proof |
|---|---|---|---|
| **B1**: Undefined `res` and `deps.mint()` side effects in CAS loop | **BLOCKER** | **PARTIALLY CLOSED / FIX NEEDED** | [`.lot4/lot4-design-v2.md#L106`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L106) explicitly defines `const res: ReclaimOrMintResult`. Furthermore, [`.lot4/lot4-design-v2.md#L128`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L128) specifies that `deps.mint()` must be minted once per call and reused across retries. **However**, the pseudocode at lines 96–107 still calls `deps.mint()` unconditionally inside the loop. (Tracked as **MAJOR 1** below). |
| **B2**: `tailLatest` undefined contract leading to false conflicts | **BLOCKER** | **CLOSED** | [`.lot4/lot4-design-v2.md#L124`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L124) formally specifies the contract: reads exclusively `[snap.size, EOF)`, strictly filters on key $K$, returns `snap.rawLine` (or `undefined` for genesis) if no row for $K$ appears in the tail, and triggers a full rescan if `ino` changes or file truncates. |
| **B3**: State regression on late zombie append without first-occurrence dedup | **BLOCKER** | **CLOSED** | [`.lot4/lot4-design-v2.md#L125`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L125) fixes `scanBindings` as `seen.has(rawLine) ? drop : keep` over exact raw bytes. A delayed append of an already-materialized line is dropped and cannot overwrite newer state. |
| **M1**: Unrestricted directory sweep destroying `identity/` store | **MAJOR** | **CLOSED** | Verified in committed code [`packages/h2a/src/runtime/upgrade/index.ts:1055, 1084, 1093`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts#L1053-L1100). The shared sweep filters strictly by `${basename(lockPath)}.succ.` and `${basename(lockPath)}.tmp.`. Unrelated files (`bindings.jsonl`, `commits/`, `keyring/`) are untouched. |
| **M2**: Orphan unmaterialized commit slots accumulating | **MAJOR** | **CLOSED** | [`.lot4/lot4-design-v2.md#L116, L126`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L116-L126) specifies [`gcMaterializedSlots`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L116) to purge slots whose `pred` is older than `snap.line`, combined with lock-held startup cleanup. |
| **M3**: Out-of-protocol lock acquisition in `cull.ts` | **MAJOR** | **CLOSED IN DESIGN** | Elevated to Deliverable 4 ([`.lot4/lot4-design-v2.md#L148-L151`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L148-L151)). `cull.ts` is migrated to use the unified [`tryAcquireSuccessionLock`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L83). |
| **m1**: `unlinkOwnSlot` throwing `ENOENT` | **MINOR** | **CLOSED** | [`.lot4/lot4-design-v2.md#L126`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L126) explicitly specifies that [`unlinkOwnSlot`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L126) ignores `ENOENT`. |

---

## 2. Concurrency & Race Analysis

### 2.1 Two Writers Committing Simultaneously
The architecture uses a two-tier defense:
1. **Tier 1 (Outer Exclusion Lock)**: `withLock(bindingsLock(root))` via [`tryAcquireSuccessionLock`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L83) on `identity/.lock`.
2. **Tier 2 (Inner Storage Fencing)**: Per-key CAS commit slot `identity/commits/<kh>.<pred>.json` via atomic [`publishExclusive`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L109) ([`link(2)`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts#L701-L745)).

**Verification of the Exclusion Guarantee (Lemmas D, E, F):**
- If Process A is frozen (SIGSTOP / VM pause), Process B cannot acquire the Tier 1 lock because [`classifyLiveness`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts#L788-L844) evaluates A as `live` (`kill(pid, 0)` succeeds and start time matches).
- If Tier 1 exclusion is violated (operator break or false death):
  - Both A and B observe predecessor state $X$ (`pred = sha256(X)`).
  - Both attempt to create `identity/commits/<kh>.<sha256(X)>.json` using [`publishExclusive`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L109).
  - By POSIX `link(2)` semantics, exactly one process succeeds (`"ok"`). The second receives `EEXIST` (`"exists"`).
  - The loser cannot append to `bindings.jsonl`; it rolls forward the winner's slot and re-evaluates.
  - If a zombie wakes up after winning the slot and appends to `bindings.jsonl` after a successor already rolled forward that same slot, the resulting log order `[... X, L_P, R2, L_P]` is neutralized by first-occurrence deduplication: the trailing `L_P` is discarded, preventing state regression.

### 2.2 Reclaiming a Live Holder
- A holder is declared dead **only** when [`classifyLiveness`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts#L788-L844) reaches absolute certainty:
  - Linux `boot_id` difference ([`index.ts:799`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts#L799)) with matching machine identity.
  - Linux PID namespace confirmed identical and `process.kill(pid, 0)` returns `ESRCH` ([`index.ts:813`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts#L813)).
  - Process state confirmed `Z` (zombie, [`index.ts:818`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts#L818)).
- In every other scenario (`ns === null` ([`index.ts:803`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts#L803)), differing namespaces ([`index.ts:804`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts#L804)), mixed start sources ([`index.ts:825`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts#L825)), or unknown time namespaces ([`index.ts:835`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts#L835))), the verdict is `undecidable` or `live`. **A live holder is never reclaimed automatically.**

### 2.3 Legacy Lock Handling Without Token
- In legacy records (`{pid, hostname, startedAt, protocol: "identity-binding-fence-v1", fenceEpoch}` as seen in [`locks.ts:186-191`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/local-files/locks.ts#L186-L191) and [`cull.ts:1024-1031`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a-runtime/src/identity-cull/cull.ts#L1024-L1031)), there is no `token`, no `boot_id`, no `ns`, and no `startSource`.
- In v2, the legacy reader classifies any such payload as `HolderView{kind: "legacy"}` which maps strictly to `undecidable` ([`.lot4/lot4-design-v2.md#L77`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L77)).
- **Safety guarantee**: Even if `kill(pid, 0)` returns `ESRCH` locally, the legacy lock is **never** reclaimed automatically because without namespace and machine confirmation, local absence does not prove process termination. The legacy lock is treated as living/unreclaimable until an operator breaks it via `breakLockAsOperator` with `--assert-dead`. (See **MAJOR 3** for necessary operator break mechanics).

---

## 3. Crash Durability Matrix Across the Write Pipeline

The write pipeline defined in [`.lot4/lot4-design-v2.md#L40, L115-116`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L40):
$$\text{write tmp} \xrightarrow{\text{fsync}} \text{link(slot)} \xrightarrow{\text{fsync(dir)}} \text{append(bindings)} \xrightarrow{\text{fsync(file)}} \text{fsync(dir)} \xrightarrow{} \text{gcMaterializedSlots}$$

| Failure Point | State on Disk | Recovery Behavior on Next Execution | Integrity Result |
|---|---|---|---|
| **Crash during write to `slot.tmp`** | Incomplete temporary file in `identity/commits/`. Slot link does not exist. | Temporary file ignored. Older than debris threshold $\to$ unlinked. Writer retries from scratch. | **Zero loss / Zero corrupt state.** |
| **Crash after `link(2)` of slot, before `appendRowDurable`** | Slot `commits/<kh>.<pred>.json` is durable. `bindings.jsonl` does not contain the new row. | Next reader executes [`scanLatest`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L97), computes `pred`, finds pending slot, executes [`appendRowDurable`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L102) (**roll-forward**). | **Zero loss.** Decision was committed at slot publication; roll-forward materializes it. |
| **Crash during `appendRowDurable`** | Slot exists. `bindings.jsonl` has a partial/corrupted trailing line. | [`listBindings`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/identity/bindings.ts#L79-L81) skips malformed lines. `scanLatest` identifies `pred` matching the slot. Roll-forward appends the complete line from the durable slot. | **Self-healing.** Durable slot repairs corrupted tail. |
| **Crash after `appendRowDurable`, before `gcMaterializedSlots`** | Row is durable in `bindings.jsonl`. Slot `commits/<kh>.<pred>.json` remains on disk. | Next reader sees row in `bindings.jsonl`. `pred` advances. Slot is older than current row $\to$ purged by subsequent [`gcMaterializedSlots`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L116) or startup sweep. | **Zero loss / Bounded debris.** |

---

## 4. Machine Identity: Cloned Images, Containers, and NFS

The machine identity model in [`.lot4/lot4-design-v2.md#L57-L67`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L57-L67) enforces:
1. **Remote Machine**: Any record where `r.host !== self.host` returns `undecidable` ([`index.ts:791`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts#L791)). Local process queries (`kill -0`) are never executed for remote hosts.
2. **Weak Machine Identity**: If a host identifier is derived purely from hostname (because `/etc/machine-id` was absent), it cannot establish co-location on a shared store (NFS). It must evaluate to `undecidable`.
3. **Cloned Image Risk**: If two container sandboxes (e.g. Kata, gVisor) share a storage root and were created from an image with a pre-baked `/etc/machine-id`, both containers report identical `host` strings but distinct `boot_id` values.
   - **Vulnerability**: In the existing code ([`packages/h2a/src/runtime/upgrade/index.ts:798-800`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts#L798-L800)):
     ```ts
     if (r.boot && self.boot && r.boot !== self.boot && platform === "linux") {
       return { verdict: "dead", datable: false };
     }
     ```
     Container B will read Container A's lock, see matching `host`, see differing `boot`, and declare Container A **dead** while Container A is actively running!
   - While v2 §1 discusses this constraint, v2 §2 omits the code specification to prevent this false death. (See **BLOCKER 1**).

---

## 5. Failure Retry Classification: `identity_worker_failed`

### Evaluation of Decision: Keep `identity_worker_failed` as Non-Retryable (Permanent)
**The current decision (NO) is CORRECT.**

**Rationale:**
1. **Root Incident Resolution**: In the 51-server incident, workers timed out because a dead predecessor held the lock without reclamation. Waiters failed with [`identity_timeout`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/mcp/identity-state.ts#L41), which is **already** in [`TRANSIENT_FAILURE_CAUSES`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/mcp/identity-state.ts#L56). With Lot 4's succession lock, the very next attempt reclaims the dead lock in $< 2\text{ s}$ without timing out.
2. **Worker Failure Semantics**: [`identity_worker_failed`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/mcp/identity-state.ts#L424-L428) is triggered by `worker.onExitWithoutResult()` (child process crash, uncaught exception, broken native binary, or permission fault). These are deterministic runtime failures. Retrying them spawns doomed child processes repeatedly.
3. **Fail-Closed Principle**: Keeping [`identity_worker_failed`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/mcp/identity-state.ts#L44) terminal protects system stability.

---

## 6. Findings: Blockers, Majors, and Minors

### 6.1 BLOCKERS

#### [BLOCKER 1] Cloned Container `/etc/machine-id` Collision Leads to False Death Reclaim
- **File & Line Proof**:
  - [`.lot4/lot4-design-v2.md#L64, L76-81`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L64)
  - [`packages/h2a/src/runtime/upgrade/index.ts:798-800`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts#L798-L800)
- **Problem**:
  Section 1 identifies that two concurrent sandboxes (Kata, gVisor) sharing a store with a frozen, pre-baked `/etc/machine-id` will present identical `host` strings but different `boot` strings. In [`index.ts:798`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts#L798):
  ```ts
  if (r.boot && self.boot && r.boot !== self.boot && platform === "linux") {
    return { verdict: "dead", datable: false };
  }
  ```
  This immediately concludes `dead`, causing Container B to reclaim Container A's active lock, creating a dual-holder state. Section 2 fails to incorporate any safeguard against this in [`classifyLiveness`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts#L788-L844). Furthermore, [`LockRec`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts#L642-L655) does not tag whether `host` was derived from `/etc/machine-id` vs fallback `hostname`.
- **Required Fix**:
  1. Prefix the stored `host` field with its source (e.g. `mid:<id>` for `/etc/machine-id` and `host:<name>` for hostname fallback). If `r.host` is `host:*` (weak), evaluate to `undecidable`.
  2. For store roots that can be shared, require an instance-specific boot token or guard the boot comparison: when instance identity cannot be proven strictly unique, differing boot IDs must return `undecidable` rather than `dead`.

---

#### [BLOCKER 2] Broken Package Architecture: Placing `succession-lock.ts` in `@sentropic/h2a-runtime`
- **File & Line Proof**:
  - [`packages/h2a/package.json:61-63`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/package.json#L61-L63)
  - [`packages/h2a-runtime/package.json:5-14, 50`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a-runtime/package.json#L5-L14)
- **Problem**:
  The user decision places the lock module in `packages/h2a-runtime/src/succession-lock.ts` because [`cull.ts`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a-runtime/src/identity-cull/cull.ts) lives in `h2a-runtime`. However:
  1. In [`packages/h2a/package.json`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/package.json#L61-L63), `@sentropic/h2a-runtime` is only a `peerDependency`. In [`packages/h2a-runtime/package.json:50`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a-runtime/package.json#L50), it is documented as *"Lazily imported by @sentropic/h2a; installed separately."*
  2. Core CLI features in `@sentropic/h2a`—specifically [`upgrade/index.ts`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts) and [`identity/bindings.ts`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/identity/bindings.ts)—require the lock module at entry. If `succession-lock.ts` is in `h2a-runtime` and `h2a-runtime` is not installed or resolved, the CLI and auto-upgrade crash on `ERR_MODULE_NOT_FOUND`.
  3. [`packages/h2a-runtime/package.json:5-14`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a-runtime/package.json#L5-L14) currently only exports `.` and `./status`. A root import `import { ... } from "@sentropic/h2a-runtime"` executes [`h2a-runtime/src/index.ts`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a-runtime/src/index.ts#L1-L60), pulling in heavy dependencies (Commander, ws, node-pty, AWS S3 SDK), destroying CLI performance.
- **Required Fix**:
  If `succession-lock.ts` is placed in `packages/h2a-runtime`:
  1. `packages/h2a-runtime/package.json` must declare a dedicated, isolated subpath export:
     ```json
     "./succession-lock": {
       "types": "./dist/succession-lock.d.ts",
       "import": "./dist/succession-lock.js"
     }
     ```
  2. [`succession-lock.ts`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a-runtime/src/succession-lock.ts) must be bundled independently by `tsup` with zero runtime dependencies beyond Node built-ins.
  3. `@sentropic/h2a-runtime` must be promoted from `peerDependencies` to `dependencies` in `packages/h2a/package.json` (or extracted into a dedicated zero-dependency `@sentropic/locks` package).

---

### 6.2 MAJORS

#### [MAJOR 1] `deps.mint()` Keyring Lifecycle Desynchronization in `decideAndCommit`
- **File & Line Proof**:
  - [`.lot4/lot4-design-v2.md#L96-L107`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L96-L107) vs [`.lot4/lot4-design-v2.md#L128`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L128)
- **Problem**:
  In the pseudocode at lines 96–107:
  ```ts
  for (let round = 0; round < 4; round++) {
    ...
    const mintResult = deps.mint();
    const line = rowLine(key, mintResult, deps.now());
    ...
    o.beforePublish?.(res, { identity:true });
    const p = publishExclusive(slot, ...);
    if (p === "exists") continue;
  ```
  If `publishExclusive` encounters `p === "exists"` (a CAS conflict), the loop retries. At round 1, it calls `deps.mint()` again, creating a fresh keypair and publishing another entry via `beforePublish`. This directly violates Section 3 line 128: *"Décision : mint UNE fois par appel decideAndCommit, réutilisé sur toute la boucle"*.
- **Required Fix**:
  Move `mintResult` allocation outside or guard it across retry rounds:
  ```ts
  let mintResult: MintResult | undefined;
  for (let round = 0; round < 4; round++) {
    ...
    if (!mintResult) {
      mintResult = deps.mint();
      const res: ReclaimOrMintResult = { action: "mint", instance: mintResult.instance, agentUuid: mintResult.agentUuid };
      o.beforePublish?.(res, { identity: true });
    }
    const line = rowLine(key, mintResult, deps.now());
    ...
  ```

---

#### [MAJOR 2] Undefined `markSlotMaterialized` and Incomplete Roll-Forward Cleanup
- **File & Line Proof**:
  - [`.lot4/lot4-design-v2.md#L102, L113, L116`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L102)
- **Problem**:
  1. At line 113: `if (now === line) { markSlotMaterialized(slot); return res; }`. `markSlotMaterialized` is called but never defined anywhere in the design or existing code.
  2. At line 102: `if (pending !== "absent") { appendRowDurable(root, pending.rawLine); continue; }`. The recovery process rolls forward the line into `bindings.jsonl`, but does not clean up the slot. In round 1, if the recovered binding is proven via `deps.verifyProof(snap.binding)` (line 103), `decideAndCommit` returns immediately via `return reclaim(snap.binding)`. Because line 116 (`gcMaterializedSlots`) is skipped on reclaim, the rolled-forward slot remains orphaned on disk indefinitely.
- **Required Fix**:
  Replace `markSlotMaterialized(slot)` with `unlinkOwnSlot(slot, held.token)`. When performing roll-forward at line 102, ensure the rolled-forward slot is either unlinked or `gcMaterializedSlots` is invoked before returning on the reclaim branch.

---

#### [MAJOR 3] Missing Synthetic Token Specification for Legacy Operator Breaks
- **File & Line Proof**:
  - [`.lot4/lot4-design-v2.md#L77, L80`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L77)
  - [`packages/h2a/src/runtime/upgrade/index.ts#L418-L420`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts#L418-L420)
- **Problem**:
  In v2 §2, `breakLockAsOperator(lockPath, {expectToken, assertDead})` publishes `SUCC(g)` and unlinks `g`. For a legacy lock record (`{pid, hostname, startedAt}`), there is no `token` field in the file. If the legacy reader does not synthesize a deterministic token, `g` is undefined, `succPathFor(lockPath, g)` throws, and an operator cannot break a legacy lock using the CLI (`h2a identity unlock`).
- **Required Fix**:
  Formally specify in `parseLockRec` / `readLockRecord` that a legacy record is assigned a deterministic token: `token = "legacy-" + sha256(rawBytes).slice(0, 32)`. The CLI command `h2a identity unlock` / `h2a lock break` can then display and accept this token to execute a safe SUCC retirement.

---

### 6.3 MINORS

#### [MINOR 1] `tailLatest` EOF Inode Rotation Rescan Flow
- **File & Line Proof**:
  - [`.lot4/lot4-design-v2.md#L124`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L124)
- **Problem**:
  `tailLatest` specifies that if `ino` changes or file size shrinks below `snap.size`, a full rescan must occur. The specification should explicitly clarify that when `tailLatest` detects an inode rotation or truncation, it returns a distinct sentinel or updated line that causes `now !== snap.rawLine` to evaluate to true, triggering `unlinkOwnSlot` and cleanly restarting the CAS round.

#### [MINOR 2] Concurrency Between On-Demand Retry and Operator Break
- **File & Line Proof**:
  - [`.lot4/lot4-design-v2.md#L80, L138-145`](file:///home/antoinefa/src/h2a/tmp/lot4-review/.lot4/lot4-design-v2.md#L80)
  - [`packages/h2a/src/runtime/mcp/identity-state.ts:447-459`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/mcp/identity-state.ts#L447-L459)
- **Problem**:
  If an operator breaks a lock (`breakLockAsOperator`) concurrently while an MCP client calls a tool that invokes `retry()` from [`identity-state.ts`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/mcp/identity-state.ts), the retiring unlink may race with the new worker's initial `publishLockRecord`. This is safely handled by `publishLockRecord` returning `EEXIST` and entering the next succession round, but should be covered by an explicit integration test.

---

## 7. Action Plan for Construction

1. **Package Layering**:
   - Create `packages/h2a-runtime/src/succession-lock.ts` containing the mechanically extracted lock logic.
   - Configure `packages/h2a-runtime/package.json` to expose `"./succession-lock"`.
   - Update `packages/h2a/package.json` dependencies so `@sentropic/h2a-runtime` is guaranteed at runtime.
2. **Machine Identity**:
   - Add source tagging (`mid:` vs `host:`) to [`LockRec.host`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts#L645).
   - In [`classifyLiveness`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a/src/runtime/upgrade/index.ts#L788), treat `host:*` or differing boots without proven instance uniqueness as `undecidable`.
3. **CAS Loop Implementation in `bindings.ts`**:
   - Align `decideAndCommit` with `mintResult` hoisted before the CAS retry loop.
   - Replace `markSlotMaterialized` with `unlinkOwnSlot(slot, held.token)`.
   - Ensure roll-forward paths on line 102 sweep or clean up the materialized slot before returning on reclaim.
4. **Cull Migration**:
   - Migrate [`packages/h2a-runtime/src/identity-cull/cull.ts`](file:///home/antoinefa/src/h2a/tmp/lot4-review/packages/h2a-runtime/src/identity-cull/cull.ts) to use `tryAcquireSuccessionLock` and `lease.release()`.
   - Bump protocol to `identity-binding-fence-v2` across both modules.
