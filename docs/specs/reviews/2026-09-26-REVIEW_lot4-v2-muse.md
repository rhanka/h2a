# Lot 4 v2 — independent adversarial review (artifact `ec09dac9`, v0.97.9)

## Verdict: BUILDABLE-WITH-FIXES

The core technical direction is sound and the v2's claim that #288/#291 changed the starting point is verified. The succession primitive (tmp+fsync+`link(2)` `EEXIST`, token-targeted unlink, strict liveness) is correctly extracted on paper, and the per-key commit-CAS is the right fencing primitive. But the design as written has one wrong placement decision, one underspecified safety invariant, and several spec gaps that would let an implementer build a fork or a false-death path while believing they followed the spec. All are fixable without changing the architecture.

Independence note: I did not read the two existing v2 reviews in `.lot4/`. All line citations below were re-checked on `ec09dac9`.

---

## BLOCKER

### B1 — Module placement in `h2a-runtime` inverts the dependency direction. Put it in `local-files/succession-lock.ts`.

The posterior decision (`packages/h2a-runtime/src/succession-lock.ts`) is architecturally wrong.

- `@sentropic/h2a` does **not** hard-depend on `@sentropic/h2a-runtime`: it is a `peerDependencies` entry (`packages/h2a/package.json:61-63`), and the codebase states the golden rule explicitly (`packages/h2a/src/runtime/canevas/adapter.ts:2`: "`@sentropic/h2a` never hard-depends on `@sentropic/h2a-runtime`"; same rule in `packages/h2a/src/runtime/loop/engine/tick.ts:6`, `decision.ts:3`). Runtime is loaded lazily via resolver (`packages/h2a/src/cli.ts:3751-3758`) and dynamic central-MCP helpers (`packages/h2a/src/runtime/mcp-central.ts:73-79`).
- The lock is needed on the **synchronous hot path**: `upgrade/index.ts`, `identity/bindings.ts` (`packages/h2a/src/runtime/identity/bindings.ts:34,166,241`), `local-files/locks.ts`, and the identity worker child. It cannot go through a lazy resolver, and it must stay a leaf (`node:fs/os/crypto/child_process` only — v2 §2 gets this right).
- `h2a-runtime` is heavy (`node-pty`, `aws-sdk`, `hono` — `packages/h2a-runtime/package.json:18-27`). Pulling it into every CLI boot for a ~300-line lock primitive is a packaging regression.
- The reverse edge does not exist today (`packages/h2a-runtime/package.json` has no `@sentropic/h2a` dep), but adding `h2a-runtime → h2a-core` (light, no native deps) is far cheaper than `h2a-core → h2a-runtime` (heavy, lazy, cyclic risk).

Fix: keep v2 §2 as written — `packages/h2a/src/runtime/local-files/succession-lock.ts`, direct file import, never via `local-files/index.js` (`packages/h2a/src/runtime/local-files/index.ts:1-65` shows why: index pulls store/presence/lease). Have `cull.ts` import from core (add the dep to `h2a-runtime`), with the fence constant single-sourced in core. Consequence: step 1 of the sequencing stays a **neutral same-package move**; as specified with a cross-package move it cannot be neutral (import rewrites + packaging + peerDep wiring).

### B2 — Machine-identity "strong host" is required but unencodable. As specified, the shared-store reclaim is unsafe.

Verified in tree:

- `readHostId` prefers `/etc/machine-id`, falls back to hostname, then `"unknown-host"` (`packages/h2a/src/runtime/upgrade/index.ts:452-466`). Same fallback pattern in identity (`packages/h2a/src/runtime/identity/live.ts:151-160`).
- The classifier only tests **equality**: other host → `undecidable` (`index.ts:791`). Two distinct machines with the same hostname compare **equal**, proceed to local `kill(pid,0)` + start comparison, and can falsely declare death. The fallback makes the equality check unsound on a shared store.
- v2 §1 says "hostname-only → weak → `undecidable`" but defines **no encoding**: no new field, no sentinel, no `hostKind`, no check order. An implementer following the spec keeps comparing strings and ships the false-death path.

Fix: add an explicit strength marker to the record (e.g. `hostKind: "machine-id" | "weak"` or a `hostSrc` prefix), set it at `makeLockRec` (`index.ts:642-655`), and make `classifyLiveness` return `undecidable` before any kill/start probe when either side is weak. Freeze with `T-machine-id` (other `machine-id` → `undecidable`; hostname-only → `undecidable`). This is the single largest shared-store safety gap; step 2 must land it **before** any identity reclaim is wired.

### B3 — Cloned-image / jail cases are declared, not designed.

- Linux "boot differs → dead" (`index.ts:798-799`) assumes a trustworthy `machine-id`. Two concurrent sandboxes from an image with a frozen `/etc/machine-id` sharing one store look like "same host, different boots" → false death. v2 §1 proposes a "per-instance non-collidable UUID persisted in the store", with missing → `undecidable`. Where is it stored, who writes it, what wins when two clones write different UUIDs, and what is the exact gate in `classifyLiveness`? None of this is specified.
- Off-Linux `readPidNs` returns `"host"` (`index.ts:515`). Under FreeBSD jails this is false co-location: `kill(0)` from a jail on a host PID gives ESRCH → false death. v2 §1 says "off-Linux co-location insufficient without strong machine+instance identity → `undecidable`" but gives no platform table, no field, no test beyond a name (`T-machine-id`).

Fix: either (a) fully specify the instance-identity field + write path + gate order + jail/platform matrix, or (b) explicitly scope Lot 4 to **same-machine, Linux + darwin, strong-`machine-id` only**, with every other combination → `undecidable`, and move the per-instance-UUID design to Lot 5. What is not acceptable is the current middle state: a deployment note presented as a mitigation.

### B4 — Legacy invariant ("no-token lock stays alive unless death proven by PID and start-time") is the right safety call but unimplementable as worded.

- New-format upgrade records carry a comparable process start (`proc:`/`ps:` prefixes, `index.ts:556-610`; source gate `612-616`; mixed-source → `undecidable`/`live`, `825-826`; proc gated by time-ns, `835-837`). Good.
- Legacy `LockOwner` (`packages/h2a/src/runtime/local-files/locks.ts:68-76`, parsed at `139-160`) carries `startedAt` = **lock-write wall clock**, not process start. It is incomparable with `procStartInfo`/`ps lstart`. "Proven by PID and start-time" has no meaning for this shape.
- Worse, the identity lock **today** reclaims legacy on `kill(pid,0)` + hostname alone (`locks.ts:162-179`, `214-221`) — no ns, no boot, no start. PID reuse → false death. The upgrade path is safe only by accident (legacy fails `parseLockRec` at `657-687` → `corrupt` → `dead-undecidable`, `889-893`).

Fix: spell the rule operationally — (i) ESRCH in a **known-shared ns + strong host** → `dead` (PID absence is conclusive, no start needed); (ii) PID present, EPERM, any error other than ESRCH, any null ns (`803`), any ns mismatch (`804`), any host mismatch (`791`), any weak host, any legacy/unparseable start (`825`) → `live`/`undecidable`, never `dead`; (iii) the identity lock must use the succession classifier **exclusively** — forbid the `locks.ts:214` kill-only reclaim for the bindings lock once migrated; (iv) keep the wedge escape the v2 already names: `legacy-record` counter + typed diagnostic naming `h2a identity unlock` + operator break. Also enforce T7a: `makeLockRec` (`642-655`) is already clean (no `hostname`/`startedAt`); ensure the identity path never uses the `locks.ts:186-191` legacy shape again.

### B5 — `decideAndCommit`摩擦: mint-once vs. the existing outside-lock pre-publish is unresolved; keyring double-mint will orphan keys per CAS round.

- v2 §3 says "mint ONCE per `decideAndCommit`, reuse across rounds; `beforePublish` idempotent by `(kh, instance)`". But `resolveLiveIdentityAsync` **already** publishes a mint candidate **outside** the lock (`packages/h2a/src/runtime/identity/live.ts:666-722`, `publishIdentity` at `670-700`, candidate at `720`), then calls `reclaimOrMintAsync` **without** `beforePublish`. If the CAS body mints again inside, there are two mints per call by construction.
- `ensureKeypair` is idempotent-safe but not atomic: two racers both miss, both `writeFileSync` different random keys (`live.ts:211-238`); loser files are removed (`cleanupOrphanKeypair`, `248-260`) but registration/alias rows are append-only and stay. `recordIdentityAlias` dedups by read-then-append (`packages/h2a/src/runtime/identity/migration.ts:125-131`) — itself racy, harmless duplicates but growth. `registerInstance` dedups inside the registry lock (per the `live.ts:327-332` comment), which is the only safe one of the three.
- The pseudocode also references undefined pieces: `held.stillHeld()` (no such method in tree), `markSlotMaterialized`, `keyHash`/`commitSlotPath`/`scanLatest`/`slotBody`, bare round count `4`, and `throw storageError(p)` with no mapping into the worker `classify` (`packages/h2a/src/runtime/identity/worker.ts:50-68`: `LockTimeoutError`/`LockCancelledError` → `identity_timeout`, `ENOSPC`/`EIO` → `identity_storage_failed`, else `identity_worker_failed`).

Fix: single-mint ownership — share one `mintMemo` between the outside-lock candidate and the in-lock CAS body (the `mint`/`mintMemo` plumbing already exists in `live.ts:643-655`); define `beforePublish` as re-entrant on the **same** `mintResult` (same `(kh, instance)` → byte-identical keyring writes or skip-if-present under the held lock); specify that a fresh `mintResult` is drawn at most once per outer call, never per CAS round; map the two new errors in `worker.ts` classify (`BindingFenceStaleError`/`BindingCommitConflictError` → contention retry within budget, i.e. the `identity_timeout` family, not `identity_worker_failed`). Add T-gemini-B1 proving one keypair per outer call under `EEXIST` retry. Also correct the citation: `worker.ts:159-167` as cited in v2 does not exist at `ec09dac9` (worker file is ~110 lines; classify is at `50-68`).

### B6 — Fence-duplication and lock-path collision: wrong line citation, and the real collision is unaddressed.

- Duplication confirmed: `packages/h2a/src/runtime/identity/bindings.ts:42` and `packages/h2a-runtime/src/identity-cull/cull.ts:149` are byte-identical (`"identity-binding-fence-v1"`).
- The task's "`cull.ts:456` O_EXCL write" is a mis-citation: `cull.ts:453-470` is `writePacketFile` (contained packet output, `O_CREAT|O_EXCL|O_NOFOLLOW` + `assertPacketWriteContainment` — not the identity lock). The off-protocol fence write is `acquireCanonicalBindingFence` (`cull.ts:1047-1070`: `openSync(O_CREAT|O_EXCL)` then `writeFileSync`+`fsync` — crash between open and write leaves an empty/corrupt `.lock`), with ownership check `fenceIsHeld` (`1033-1043`, including `pid === process.pid`, which is incompatible with succession semantics) and unconditional-shape release (`1072-1075`), plus the staging probe at `1084-1107` acquiring `join(dirname(canonicalBindingPath), ".lock")` (`1089`) — the **same** `identity/.lock` path the bindings writer uses (`bindings.ts:67-69`).
- v2 §5 says "bump v1→v2 in both files + adapt `cull.test.ts:44,177,317`" but does not resolve the **same-path, two-protocol** collision: unifying the version string without unifying acquisition still leaves two writers with different invariants on one path.

Fix: migrate `cull.ts` acquisition onto `tryAcquireSuccessionLock`/`publishExclusive` (v2's primary option, correct), single-source the protocol constant from core (B1 fix), and state the path rule: exactly one acquirer for `identity/.lock`. If migration overruns, take v2's explicit fallback (fail-closed disable with typed error), not a version-string bump alone.

---

## MAJOR

### M1 — `tailLatest`/`scanBindings` contracts are correct in outline, missing the crash cases. (gemini B2/B3, muse B4)

- Nothing cited exists in tree: no slots, no `tailLatest`/`scanLatest`, no dedup — `listBindings` re-parses (`bindings.ts:71-84`, malformed skipped `79-81`), `findBinding` is last-wins (`98-106`), appends are bare `appendFileSync` (`172-176`, `257-261`). So v2's §3 is all new code, correctly aimed: strict key filter on `[snap.size, EOF)`, empty-tail → `snap.rawLine` (genesis → `undefined`), first-occurrence-wins dedup, `ino` guard + truncation rescan.
- Missing: (i) torn trailing line (crash mid-`appendRow` leaves a partial last line — must be ignored, not parsed, not treated as conflict); (ii) what a full rescan does to `pred` (must restart the round with a fresh `pred`, not compare against the stale `snap`); (iii) `ino` reuse after rotation/replacement; (iv) byte identity for `lineId`: v2 says "raw octets" but the append format is `JSON.stringify + "\n"` (`173-174`) — the spec must pin whether the trailing `\n` is inside the hash, with frozen vector T-B4 capturing exact prod bytes; (v) `kh = sha256(host \0 providerSessionId)[:32]` uses the **binding key host** (a label like `agent`, per `live.ts`), not the machine id — correct (matches `findBinding` semantics) but must be stated, lest an implementer mix in `machine-id` and split slots per machine for a per-conversation key.

### M2 — Durability order needs file-descriptor reality. (muse B6)

v2 §3 order — `publishExclusive` (slot fsync+link) → `appendRowDurable` → `gcMaterializedSlots` + roll-forward — is right, but `appendFileSync` has no fsync. Specify: open with `O_APPEND`, `writeSync`, `fsyncSync(fd)`, close, then open `dirname` fd + `fsyncSync(dir)`. Also specify: startup roll-forward runs **under the lock**, is idempotent (two starters appending the same winning line → dedup absorbs), and GC never runs before both fsyncs are confirmed. T-B6 must cover slot-present/line-absent crash and line-present/slot-present crash distinctly.

### M3 — GC/sweep blast radius is not a prohibition list. (gemini M1, muse M3)

- Upgrade sweeps are verified basename-gated (`index.ts:1053-1056`, `1080-1093`, `1163-1183`) — safe within their own prefix. Generalizing `prefix` → `dirname(lockPath)` (v2 §2) puts the identity sweeper in `identity/`, next to `bindings.jsonl`, `aliases.jsonl` (`migration.ts:99`), `commits/`, `<root>/keys/` (`live.ts:143-146`), and legacy `.stale-*` files (no code references — manual renames, must never be auto-deleted).
- v2 says "strict `${basename(lockPath)}.` prefix" but never lists the forbidden set, and `gcMaterializedSlots(root, keyHash, snap)` as sketched could plausibly delete another key's winning slot (pred-older-than-snap across keys) or a live slot whose line is durable but not yet visible to this reader's `tailLatest`.

Fix: hard rules — (i) lock-debris sweep touches only `${basename(lockPath)}.succ.*` / `${basename(lockPath)}.tmp.*`; (ii) slot GC touches only `identity/commits/<kh>.<pred>.json` for **this** `kh`, only after the line is durable **and** visible via `tailLatest`, or pred strictly older than this key's confirmed line; (iii) never touch `bindings.jsonl`, `aliases.jsonl`, `commits/` of other keys, `<root>/keys/`, registry, or any `.stale-*`; (iv) startup cleanup takes the lock first. Tests must attempt each forbidden deletion and fail on touch.

### M4 — Operator break leaves the post-break chain unspecified. (muse B5)

`succPathFor` uniqueness per `g` confirmed (`index.ts:418-420`). Targeted retire re-read (`972-980`) and token-conditional release (`1026-1033`) confirmed. But `breakLockAsOperator` is new, and v2's "re-read `LOCK==expectToken` before `unlink(g)`, retire without republishing LOCK" leaves: what a concurrent auto-successor holding `SUCC(g)` does after the operator removes `g` (its `retireDeadToken` re-reads `LOCK`, sees absent, falls to publish fresh — `1001-1007` — acceptable, but must be stated + tested); what `SUCC(g){operator:true}` means to a later reader (chain walk expects `target === g`, `931-936`); and whether the operator must SIGKILL a local PID first (v1's "tuer-avant-SUCC" for upgrade) — for identity, killing a worker PID from the CLI is a destructive act needing explicit confirmation, not a default. Split T-operator into live-refused / dead-normal / undecidable-requires-`--assert-dead` + re-read, each RED-first.

### M5 — `readFirst` needs a "never decides" rule. (muse M4)

Tree has no `readFirst` (every round pays tmp+fsync+link). Making it required is correct for fsync storms, but specify: `readFirst` may only **skip** a publish (LOCK present and holder live/undecidable → wait), never **conclude** death — death always goes through a fresh `readLockRecord` + `classifyLiveness` immediately before `succeedDeadToken`. Otherwise a stale read becomes a decision.

### M6 — `retryAfterMs` advisory bug is real; plumbing is missing.

`server.ts:318-326` returns the constant `MCP_IDENTITY_RETRY_MIN_MS` instead of `max(0, interval − elapsed)`; the env override (`H2A_IDENTITY_RETRY_MIN_MS`, `identity-state.ts:289-292`) and elapsed time are ignored. v2 §4.3 correctly flags it, but the fix needs a controller accessor for the next-eligible time (`failedAtNs` at `307` is private; `retry()` at `447-459` computes eligibility inline). Either expose `nextEligibleInMs` or accept the constant as advisory and document it. Small, but do not ship the "fix" without the accessor.

---

## MINOR

- **m1 (`unlinkOwnSlot` ENOENT)** — v2 §3 (ignore `ENOENT`) is correct and complete. Note the deeper point is already handled: token equality + 96-bit unique tokens (`newToken`, `638-640`; `LOCK_TOKEN_RE`, `412`) make read-then-unlink safe against deleting a successor; `ENOENT` just means a co-GC won.
- **m2 (branch stability)** — confirmed leveled: #288 merged (`8be3a774`), HEAD `ec09dac9`. No action.
- **Line-citation hygiene** — v2's citations check out except: `cull.ts:456` (should be `1047-1075` + `1033-1043`), `worker.ts:159-167` (nonexistent at this artifact; use `worker.ts:50-68` + `identity-state.ts:201-255,421-431`), and `locks.ts:284` (the unconditional `unlinkSync` is at `285`/`327` inside `finally` at `280-290`/`322-332` — same finding, off-by-line). Fix before build so implementers open the right windows.
- **Step granularity** — the 5-step order (neutral extraction → extensions → CAS commit → #291 reconciliation → cull) is right, but step 2 bundles five extensions (legacy reader, `readFirst`, `stillHeld`, operator, machine-id) and step 3 bundles the whole CAS commit. Split each to its own RED→green with the tests v2 already names (`T-extract`, `T-B2/B3/B4/B6`, `T-zombie`, `T-tué-tenant-verrou`, `T-reclaim-retry`, `T-prédicat`, `T7a`, `T-operator`, `T-cull`, `T-machine-id`, `T-structurel`). Builder ≠ re-reviewer per step, as v2 §7 states.
- **Transition risk (multi-version)** — correctly declared residual (Lemmas D/E/F don't cover a slot-less legacy writer + exclusivity violation), but "counter + runbook" is thin for a 27k-line prod store: add a version gate (new binary refuses, or at least warns, when it sees slot-less appends from an old binary within the window) and document the exact operator sequence. Keep it out of Lot 4 scope, but do not call the counter alone a mitigation.

---

## Point-by-point answers to the six checks

1. **v1 findings closure (code-real):** muse B2, gemini M1/m2 are genuinely closed in tree (`803-804`, `1053-1093`, `1163-1183`, #288 merged). muse B1/B5-partial, gemini m2 likewise leveled. Everything else (muse B3/B4/B6/M1-M4, gemini B1/B2/B3/M2/M3/m1) is **spec-closed by v2, not code-closed** — no slots, no `tailLatest`/`scanLatest`, no `unlinkOwnSlot`, no `breakLockAsOperator`, no `readFirst`/`stillHeld`, no `legacy` reader in the succession path, fence still decorative (`bindings.ts:181,267` never re-read; unlink unconditional `locks.ts:285,327`). Buildable only if implemented literally per the fixes above.
2. **Takeover safety:** new-format classifier is solid (host `791`, boot-linux `798-799`, ns-null `803`, ns-mismatch `804`, ESRCH `813`, zombie `818`, source-labeled starts `819-840`, time-ns gate `835-837`). Unsafe edges remain exactly where v2 is vague: hostname-fallback equality (B2), frozen-`machine-id` clones + jail co-location (B3), legacy kill-only reclaim in `locks.ts:214` (B4). Fix B2-B4 and the predicate is safe.
3. **CAS fencing + token release:** upgrade half verified (`418-420`, `972-980`, `1026-1033`); identity half absent in tree and v2's pseudocode needs the B5/B6/M1/M2 fixes (single mint, fsync reality, torn-line + rescan rules, error mapping).
4. **Sweep/GC blast radius:** upgrade sweeps verified scoped; identity GC/sweep needs the M3 prohibition list + same-path lock unification (B6). As written, a faithful implementer could GC another key's slot or reintroduce two writers on `identity/.lock`.
5. **`identity_worker_failed` resumable? NO — concur with the v2 decision.** `TRANSIENT = {identity_timeout}` only (`identity-state.ts:56`), `retryable` per cause (`329`, `452`), worker classify (`worker.ts:50-68`) already routes lock contention into `identity_timeout` (the reclaimable case) while crash/fork/IPС/programming faults stay `identity_worker_failed` → terminal. Retrying the latter buys no coverage (reclaim already makes the first `retry()` succeed — v2's T-reclaim-retry) and risks fork loops + orphan keypairs. Keep NON; fix only the `retryAfterMs` advisory (M6).
6. **5-step sequencing:** order is correct (mechanical → hardening → CAS → reconciliation → cull), with two corrections: step 1 is neutral **only** with the B1 placement fix; steps 2-3 must be split per-extension with per-step RED→green, and the multi-version transition needs a gate, not just a counter.

## Evaluation of the two posterior choices

- **Placement in `h2a-runtime`:** reject (B1). Keep the leaf in `@sentropic/h2a`, import it from `cull.ts`.
- **Legacy-no-token invariant:** approve the safety direction, reject the wording (B4). Restate as the ESRCH/present-PID rule above; it is fail-closed (may wedge legacy behind the operator tool, never double-hold), which is the correct tradeoff, but only once the wedge escape (counter + typed diagnostic + `h2a identity unlock` via SUCC) ships in the same lot.
