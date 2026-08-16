# STUDY — the D11 verdict-artifact store on SQLite: structural equivalent, or impossible?

**Lane:** memory-core (WP11) · **Feeds:** unified-server plan (WP6, h-arch) · **Designed early on purpose:** the cutover (`01M01MN6…`) gates the *switch*, not the *design*; this object class can falsify a ratified hypothesis ("one local SQLite store"), so it is designed before migration, not discovered during it.

## The question, stated so it can have a verdict

The D11 promotion ceremony reads two *verdict artifacts* from a store that, today, is a **confined filesystem**: round-3 gave it `authorizedRoot` + `O_NOFOLLOW`/`realpath`/`fstat` (anti traversal / symlink / TOCTOU); round-4 bound each artifact to a fresh ceremony **nonce** + separated reviewers by **canonical key fingerprint**. Under the owner's single-local-SQLite decision, this store must move into SQLite. **Can SQLite provide a STRUCTURAL equivalent (not a convention) to those guarantees?** If yes, "one local store" holds. If no, "one local store" does **not** hold for this object class and it is an owner decision to reopen — a documented "impossible" beats a silent workaround.

## What the guarantees actually protect (the backend-agnostic invariant)

The ceremony promotes only on two verdict artifacts that are: (i) **read from the location the ceremony itself authorized**, never a caller substitution; (ii) **signed by the claimed leg's trusted key over a payload that includes THIS run's fresh nonce**; (iii) from **two distinct crypto principals**, neither equal to the note's verified author. The load-bearing anchor is the **unforgeable Ed25519 signature over (content, thisRunNonce), verified against the construction-time trusted keystore** — plus the fingerprint separation. The filesystem confinement is **not itself the anchor**: it is what stopped a caller-controlled `writeVerdict` from making the ceremony *read a different artifact than the one it authorized*, **in the filesystem addressing model**.

## Why round-3's three attacks are filesystem-SPECIFIC

Traversal, symlink, and TOCTOU all exist for one reason: artifacts were addressed by a **caller-influenced path string** (`writeVerdict` returned a ref; the round-3 fix derived the path itself and confined it). They are properties of "address a mutable object by a path in a shared filesystem namespace," **not** properties of the promotion logic. Change the addressing model and the class changes with it.

## The SQLite structural equivalent

Verdict artifacts become **rows**, `PRIMARY KEY = the ceremony-DERIVED tuple` `(noteId, leg_key_fingerprint, ceremonyNonce)` — the exact tuple `deriveVerdictRef` built, minus the filesystem. The ceremony **reads by a parameterized `SELECT` on that derived key**, never a caller-supplied rowid/ref. Consequences, by construction:

- **TRAVERSAL → gone.** There is no path; a caller cannot point the read outside the ceremony-derived key. The `WHERE` on the derived key *is* the confinement.
- **SYMLINK → gone.** There is no indirection to follow; a row is a row.
- **TOCTOU → gone.** The read is a single `SELECT` in a **consistent snapshot** (WAL / one transaction) — no check-then-reopen gap. Optionally the verdict write and the ceremony read run in one transaction, so "confirmed present" and "these are the verified bytes" are the same statement (the round-3 single-fd property, expressed as a transaction).
- **Round-4 freshness → carries over UNCHANGED.** The row's signature is over `(content, ceremonyNonce)`; the ceremony verifies against **this run's** nonce. A replayed/foreign-context row has a *different* nonce, so the `SELECT`-by-thisRunNonce does not even find it, **and** (defense in depth) its signature fails to verify over thisRunNonce. Fingerprint separation of principals is pure crypto — backend-agnostic.

## The shared-store concern, and why it does not weaken the anchor

Verdict rows live in the **same** SQLite store as notes. Can the note-write path forge a verdict row? **No.** A verdict row is accepted only if its Ed25519 signature verifies over `(content, thisRunNonce)` against the **construction-time** trusted keystore. An attacker who can `INSERT` a row still cannot forge that signature without a trusted private key. The anchor is the **signature, not store isolation** (the injected-deps lesson: the anchor must be the unforgeable signature against a trusted keystore, never the medium). So co-locating verdicts with notes is safe — the filesystem's separate-zone was compensating for the *absence* of a signature anchor at the FS layer, which the ceremony now has.

## VERDICT — STRUCTURAL EQUIVALENT FOUND, and stronger

The filesystem attack class (traversal / symlink / TOCTOU) **evaporates** under key-addressed rows: there is no path to confine. The load-bearing anchors — signature over a fresh nonce, crypto-principal fingerprint separation, fail-closed keystore lookup — are backend-agnostic and carry over unchanged. **"One local SQLite store" HOLDS for the verdict-artifact object class. No owner decision to reopen on this point.** (This is the *opposite* of a blocker: the migration removes an attack surface rather than creating one.)

## Acceptance criteria (SQLite verdict store)

- **AC-V1 — read only by the derived key.** The ceremony reads a verdict solely by its own derived `(noteId, leg_key_fingerprint, ceremonyNonce)`; a caller cannot supply a rowid/ref that redirects the read. Test: a caller aiming the read at another key/row is refused (the derived-key `SELECT` does not match).
- **AC-V2 — freshness.** A verdict row from a prior ceremony (different nonce) never promotes: the `SELECT`-by-thisRunNonce misses it, and its signature fails over thisRunNonce. Red/green mutation (neutralize the nonce → the stale row promotes).
- **AC-V3 — forged row.** A row inserted without a valid trusted signature over `(content, nonce)` never promotes (signature verify, fail-closed). Mutation: neutralize signature verification → the forged row promotes.
- **AC-V4 — atomic read.** The read is a consistent snapshot (WAL / transaction); a concurrent write cannot make the ceremony verify bytes other than those it reads. This *replaces* the round-3 TOCTOU close.
- **AC-V5 — mapping completeness.** The round-3 path-confinement mutation-checks are **replaced** by AC-V1/V2/V4 (there is no path left to confine); the round-4 freshness + fingerprint mutation-checks carry over **unchanged** and must still be red-without / green-with on the SQLite implementation.

## One caveat named (not a blocker, unchanged by the storage medium)

The **construction-time trusted keystore** and the crypto-principal identity model (I1 / D-FED-3) still need a **home** in the unified server: where the trusted Ed25519 keys live, and how they are made **not caller-swappable**. That is the same WP5 key-custody / human-attestation residual as today — independent of filesystem-vs-SQLite — carried separately, not reopened by this study.
