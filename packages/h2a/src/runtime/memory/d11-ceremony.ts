/**
 * D11 ceremony orchestrator — WP11 slice 5 (build brief). Anti-fabrication
 * FIXED in two rounds, each closing a hole an independent review NO-GO'd.
 * See "D11 FIX — ROUND 1" and "D11 FIX — ROUND 2" below for what changed, in
 * order, and why; the rest of this doc describes the ceremony's unchanged
 * shape.
 *
 * Composes the double-consensus END TO END: launch the two independent legs,
 * collect their INLINE verdicts, gate on slice 3's `checkDoubleConsensusPreconditions`
 * (the SAME structural check, not a reimplementation) as a cheap pre-write
 * reject, write the verdict + attestation artifacts, READ THEM BACK from a
 * REAL, construction-time-bound durable store and cryptographically verify
 * them (ROUND 1 + ROUND 2 together), and only then dispatch through
 * `promoteNoteWithDoubleConsensus` — now fed the READ, VERIFIED verdicts,
 * never the caller-controlled inline ones.
 *
 * SCOPE (bounded), same shape as the rest of `runtime/memory/`: the actual
 * model-leg launching and the verdict/attestation FILE WRITES are INJECTED
 * (`deps.launchLeg`, `deps.writeVerdict`, `deps.writeAttestation`,
 * `deps.port`) and stubbed in tests — never implemented for real here. This
 * module is the ORCHESTRATION only: what gets called, in what order, and
 * what refuses the ceremony before the next step ever runs. Real Ed25519
 * signature verification (`verifySignature`, the default), the concrete
 * `trustedKeystore` backing store, AND (ROUND 2) the default verdict-artifact
 * READER (`readVerdict`, a real path-bound filesystem reader) ARE
 * implemented for real — crypto, and "read back exactly what is actually
 * persisted", are not "out of scope, inject a stub" concerns the way
 * launching a model or writing a file are. The keystore's actual key
 * material/distribution and the durable store's actual deployment location
 * remain a WP5 concern (see ROUND 1 §1 and ROUND 2 below).
 *
 * ===========================================================================
 * D11 FIX — ROUND 1 — the anti-fabrication anchor (signature verification).
 * ===========================================================================
 *
 * THE HOLE (proven by an independent review): before this fix, `launchLeg`
 * returned verdicts INLINE (caller-controlled), `writeVerdict` returned ref
 * strings that were NEVER READ BACK, and the consensus gate checked only the
 * caller-supplied inline verdicts. A `writeVerdict` that returns invented ref
 * strings without ever creating a file still reached `promoteNote` with
 * `promoted: true` — a caller fabricating "2 GO" verdicts as plain JavaScript
 * objects could promote a note with no real evidence anywhere. This is the
 * classic fabricated-verdict hole: an assertion was trusted where a document
 * should have been demanded.
 *
 * THE FIX, in three parts:
 *
 * 1. `createD11Ceremony({ trustedKeystore, verifySignature? })` — a FACTORY
 *    that CLOSES OVER the trusted keystore (and, optionally, the signature
 *    verifier). It returns the actual `runD11Ceremony(input, deps)` function.
 *    This is the load-bearing design choice: `trustedKeystore` is a
 *    CONSTRUCTION-TIME input, never part of the per-call `RunD11CeremonyDeps`.
 *    At the time of THIS round, `readVerdict` and `launchLeg` were BOTH still
 *    per-call (caller-injected, untrusted); if signature verification used a
 *    per-call-supplied keystore too, a caller could simply hand the ceremony
 *    ITS OWN keystore (mapping its own throwaway key to whatever leg it
 *    likes) and sign its own fabrication — the hole would just move one layer
 *    down. The keystore must come from a trusted CONSTRUCTION site (a
 *    conductor/bootstrap that wires `createD11Ceremony` once, not a value an
 *    arbitrary per-call caller of the returned `runD11Ceremony` can swap).
 *    `trustedKeystore` is documented here as the LOCAL anchor for today
 *    (an in-process map/interface from leg identity to an Ed25519 public
 *    key); it is designed to be swapped later for the WP5 system-wide
 *    identity keystore WITHOUT a rewrite of this module — `D11TrustedKeystore`
 *    is a one-method lookup interface (`getPublicKey(leg)`) precisely so a
 *    different backing store (network-fetched, rotated, cross-repo) can
 *    implement it later; the ceremony's own logic never changes.
 *
 * 2. `readVerdict(ref) => Promise<VerdictArtifact | null>` — at THIS round, a
 *    per-call dep. It OPENS+READS the verdict artifact actually persisted at
 *    `ref` (or returns `null` if absent/unreadable — the exact shape of the
 *    proven counter-example: a `writeVerdict` that never created a file).
 *    Distinct from `MemoryVerdict` (slice 3's in-memory, caller-asserted
 *    shape): `VerdictArtifact` additionally carries a `signature` — proof the
 *    artifact was actually produced by whoever holds the claimed leg's
 *    private key, not merely narrated by whoever called this ceremony.
 *    ROUND 2 (below) moves this dep to construction-time too — read that
 *    section for why leaving it per-call was itself still a hole.
 *
 * 3. The gate (fail-closed at every step, `promoteNote` NEVER reached on any
 *    failure): after `launchLeg` → `writeVerdict` produce the two refs, for
 *    EACH ref —
 *      a. `readVerdict(ref)` → REFUSE if `null` (closes the proven
 *         counter-example structurally: an invented ref with no real file).
 *      b. Look up the trusted public key for the artifact's OWN CLAIMED
 *         `leg` (`trustedKeystore.getPublicKey(artifact.leg)`) — REFUSE if
 *         the keystore has no entry (unknown leg OR an empty keystore; a
 *         missing key is never treated as "skip verification", it is always
 *         a refusal — I5 fail-closed applies to the keystore lookup too).
 *         Verify the artifact's `signature` against THAT key over the exact
 *         payload `{noteId, verdict, leg, at}` — REFUSE if invalid. Because
 *         the key is looked up BY THE CLAIMED LEG, a verdict that declares
 *         leg A but was actually signed with leg B's key (even though B's
 *         key IS in the keystore) fails here: leg A's public key cannot
 *         verify a signature produced by leg B's private key.
 *      c. REFUSE unless the READ `verdict === "GO"`.
 *      d. REFUSE unless the READ `noteId` equals the note actually being
 *         promoted (`input.note.noteId`) — ANTI-REPLAY. The signed payload
 *         in (b) already binds `noteId` into what the signature covers, so a
 *         genuinely-signed verdict for note X cannot be replayed to promote
 *         note Y: either its `noteId` fails this pin (this check), or an
 *         attacker who edits the `noteId` field to match Y invalidates the
 *         signature (check (b) fires instead). Either way: REFUSE.
 *    Then, across the two READ artifacts (off the READ content only, never
 *    the inline verdicts or the legSpecs):
 *      e. REFUSE if the two artifacts' `leg`s are not structurally distinct.
 *      f. REFUSE if either artifact's `leg.session === authorId` (separation
 *         of powers, re-checked off what was actually read — a `readVerdict`
 *         that returns a different leg than the one that was launched is
 *         still caught here).
 *    Then, per artifact again:
 *      g. REFUSE unless the READ content is COHERENT with the INLINE verdict
 *         `launchLeg` returned for that same position (`noteId`, `verdict`,
 *         `leg` must all match) — a mismatch means what got signed/persisted
 *         disagrees with what the leg claimed inline, which is refused
 *         rather than silently preferring one over the other.
 *    Only if ALL of (a)-(g) pass for both legs: the FINAL verdicts and
 *    attestation fed to `promoteNoteWithDoubleConsensus` are built from the
 *    READ, VERIFIED artifacts (never the inline ones) — so even a bug in this
 *    module's own gate logic cannot cause a fabricated inline verdict to
 *    reach the port, because the inline verdicts are never what gets
 *    promoted. `promoteNoteWithDoubleConsensus` re-runs
 *    `checkDoubleConsensusPreconditions` on that verified data as an
 *    unconditional second layer (unchanged from slice 3) before ever
 *    touching the port.
 *
 * ===========================================================================
 * D11 FIX — ROUND 2 (this build) — `readVerdict` moves to construction time.
 * ===========================================================================
 *
 * THE HOLE ROUND 1 LEFT (proven by an independent review, a SECOND, separate
 * leg from the one that forced ROUND 1): ROUND 1 moved `trustedKeystore` and
 * `verifySignature` to construction-time, but left `readVerdict` as a
 * PER-CALL, caller-injected dep. An adversarial per-call caller can inject a
 * `readVerdict` that returns a NON-NULL, TRUSTED-SIGNED artifact that exists
 * ONLY in memory — a ref string pointing at NO durable file anywhere — and
 * the gate above (§3a) only refuses `null`; a fabricated-but-signed in-memory
 * object sails through every check in ROUND 1 §3. ROUND 1's signature
 * verification only actually defends anything IF the per-call caller lacks
 * the trusted legs' private keys — but nothing in this module, or in what it
 * composes, ESTABLISHES that. Key custody is a WP5 wiring concern that is not
 * yet specified; assuming the caller can't sign is exactly the kind of
 * unverified assumption D11 exists to eliminate. We do not rely on it here.
 * The deeper problem: a trust-critical READER that the untrusted per-call
 * caller can inject is an EMPTY ANCHOR — no matter how strong the
 * verification logic downstream of it is, the caller controls whether that
 * logic ever sees real data at all. This is the same injected-deps lesson
 * ROUND 1 only half-applied (it anchored the VERIFIER but not the READER).
 *
 * THE FIX:
 *
 * 1. `readVerdict` moves from `RunD11CeremonyDeps` (per-call) to
 *    `CreateD11CeremonyOptions` (construction-time) — EXACTLY like
 *    `trustedKeystore` and `verifySignature`, and for the identical reason:
 *    the per-call caller of the returned `runD11Ceremony(input, deps)` is the
 *    UNTRUSTED adversary this whole ceremony exists to defend against. A
 *    trust-critical dependency that adversary can inject or override is not
 *    a defense, it is a hook for the exact fabrication being defended
 *    against. `RunD11CeremonyDeps` no longer has a `readVerdict` field at
 *    all (a type-level guarantee, not merely a runtime check) — and even if
 *    a caller attaches an extra `readVerdict` property to the `deps` object
 *    at runtime anyway (JS does not enforce the TS shape), `runD11Ceremony`
 *    never reads `deps.readVerdict` — it always uses the reader CLOSED OVER
 *    at construction. Proven in tests: an attached-but-unused
 *    `deps.readVerdict` records zero calls.
 *
 * 2. The DEFAULT construction-time reader, `defaultReadVerdict`, is a REAL
 *    in-module durable-store reader with PATH-BINDING: `ref` IS a filesystem
 *    path, and the reader does a genuine `readFile` at exactly that path,
 *    then JSON-parses and shape-validates the result. It returns `null` on
 *    ANY failure — missing file, unreadable, malformed JSON, wrong shape —
 *    which is exactly ROUND 1's proven counter-example (an invented ref with
 *    no real file behind it) and stays refused for the identical reason.
 *    Because the reader always dereferences the REAL filesystem at the ref's
 *    own path, what it returns is BOUND to that ref — it is literally what
 *    is stored there — never a caller-fabricated in-memory object: there is
 *    no code path by which an in-memory `VerdictArtifact`, however validly
 *    signed, can reach `promoteNote` without first being real bytes on disk
 *    at the exact path the ceremony itself derived from `writeVerdict`'s
 *    return value. `readVerdict` remains overridable AT CONSTRUCTION for
 *    tests only — a test may supply a fake store-reader (e.g. an in-memory
 *    `Map<ref, VerdictArtifact>`) to `createD11Ceremony({ readVerdict: ... })`
 *    so tests don't need real disk I/O for every scenario — but that
 *    override is wired ONCE, at the same trusted construction site as
 *    `trustedKeystore`, never by the per-call caller under test.
 *
 * 3. Everything from ROUND 1 §3 is UNCHANGED: signature-by-claimed-leg,
 *    GO, anti-replay (noteId pin), cross-artifact distinctness, separation
 *    of powers off the READ content, and coherence with the inline verdict.
 *    ROUND 2 only changes WHERE `readVerdict` comes from and WHAT its
 *    default implementation actually does; it adds no new gate steps because
 *    none were missing — the missing piece was that the existing gate could
 *    be handed fabricated input before it ever ran.
 *
 * WHAT THIS DOES NOT CLAIM (residual, stated honestly): the CONSTRUCTION
 * SITE — whoever calls `createD11Ceremony({ trustedKeystore, readVerdict })`
 * — remains a trusted wiring point (WP5 domain, unchanged from ROUND 1 §1):
 * its choice of keystore, its choice of durable-store reader (or acceptance
 * of the real filesystem default), and the actual key material/store
 * deployment behind both are not re-verified by this module. That is ONE
 * trusted wiring point exercised once at bootstrap, not any of the
 * potentially many per-call callers of the returned `runD11Ceremony` — a
 * much smaller, much more auditable surface than ROUND 1 left. This module
 * defends against a per-call caller fabricating a plausible-looking verdict,
 * signed or not, durable or not; it does not defend against a compromised
 * private key for a leg genuinely registered in the trusted keystore, a
 * compromised/malicious construction site, or a durable store an attacker
 * can write to directly (bypassing `writeVerdict`) — those remain
 * key-management, wiring, and storage-access concerns, not gaps in this
 * gate.
 *
 * ===========================================================================
 * D11 FIX — ROUND 3 (this build) — `defaultReadVerdict` is now PATH-CONFINED.
 * ===========================================================================
 *
 * THE HOLE ROUND 2 LEFT (proven by a THIRD, independent review, a separate
 * leg from the two that forced ROUNDS 1 and 2): ROUND 2 moved `readVerdict`
 * to construction time, closing the "fabricated in-memory artifact" hole.
 * But the DEFAULT construction-time reader, `defaultReadVerdict`, still did
 * a plain `readFile(ref)` — and `ref` is `writeVerdict`'s PER-CALL,
 * caller-controlled return value. Moving the READER to construction time
 * defends against a caller substituting a DIFFERENT reader; it does nothing
 * to confine WHERE the real, trusted, construction-time reader looks, when
 * that location is still a bare string the untrusted per-call caller
 * chose. Three attacks reached `promoteNote` with `promoted: true` at
 * ROUND 2 (@824b633e):
 *   1. TRAVERSAL — `writeVerdict` returns a `../../…` ref pointing at some
 *      OTHER, genuinely signed verdict file outside the intended zone (e.g.
 *      one written by a real leg for a DIFFERENT ceremony run entirely).
 *   2. SYMLINK — `writeVerdict` "writes" its ref location as a symlink to
 *      an attacker-controlled file (or makes an ancestor directory a
 *      symlink); `readFile` follows it transparently.
 *   3. TOCTOU — `writeVerdict`'s ref looks confined and could even pass a
 *      naive check, but the file at that path is swapped between the
 *      moment any confinement check runs and the moment bytes are actually
 *      read — a real risk IF that check and that read are two separate
 *      pathname-based filesystem operations ("realpath(ref), then
 *      separately re-open(ref)" is itself racy this way).
 *
 * THE FIX, REUSING the path-confinement technique already proven and MERGED
 * in this repo — `packages/h2a-runtime/src/identity-cull/cull.ts` (PR
 * #160): `realpathSync` canonicalization of a TRUSTED root,
 * `openSync(..., O_RDONLY | O_DIRECTORY | O_NOFOLLOW)` descriptor-relative
 * directory walking that refuses a symlink at ANY path component, and — the
 * TOCTOU-closing move — a SINGLE held file descriptor carried from open
 * through the `fstatSync` regular-file check to the actual read, never a
 * second, pathname-based open. This module reimplements the same
 * primitives locally (`h2a` does not depend on `h2a-runtime` at build time;
 * the peer dependency is optional) — the TECHNIQUE is reused, not
 * reinvented, per that module's own comments on the same primitives.
 *
 * 1. `createD11Ceremony({ ..., authorizedRoot })` — a new construction-time
 *    option, REQUIRED whenever the REAL default reader is in use (no custom
 *    `readVerdict` override): constructing without it throws synchronously,
 *    the same fail-loud pattern as a missing `trustedKeystore`. A real
 *    filesystem reader with no confinement root IS the hole this round
 *    closes; there is no safe default for it.
 *
 * 2. `deriveVerdictRef(authorizedRoot, noteId, leg)` — a new, exported,
 *    PURE function (no filesystem access): the ONE location a leg's verdict
 *    for a note may ever be read from — `beneath(authorizedRoot,
 *    sanitized(noteId), sanitized(legId))`. Both `noteId` and the leg's
 *    `{model, session}` are sanitized (reject `/`, `\`, NUL, `.`, `..`) —
 *    REFUSED outright (thrown, caught, turned into a ceremony refusal)
 *    rather than silently stripped, so a hostile value can never be
 *    "cleaned" into some OTHER, ambiguous, colliding path. This is derived
 *    from `legSpec1`/`legSpec2` — the ceremony's OWN dispatch decision,
 *    already checked structurally distinct and non-author BEFORE launch —
 *    never from anything `launchLeg` or `writeVerdict` claim back. (A
 *    deliberate, narrow exception to I1's "opaque, never parsed/derived
 *    from" stance for `noteId`/leg identity: here they are used ONLY to
 *    build a confined filesystem path, via sanitize-or-refuse, never
 *    split/parsed/compared piecewise.)
 *
 * 3. Per leg, BEFORE any filesystem access on `writeVerdict`'s ref: the
 *    ceremony computes the derived path and requires
 *    `resolve(writeVerdictRef) === derivedPath`, EXACTLY, string-for-string
 *    — REFUSED otherwise, before `readVerdict` is ever called with it. This
 *    alone closes TRAVERSAL structurally: a `../`-laden ref can never be
 *    textually identical to the clean, sanitized, ceremony-derived path, so
 *    it is refused without a single filesystem call ever touching it.
 *
 * 4. `defaultReadVerdict(ref, authorizedRoot)` (signature change from
 *    ROUND 2 — now confined) opens the verdict file via the cull.ts-style
 *    descriptor-relative O_NOFOLLOW walk from the realpath'd
 *    `authorizedRoot` down through `ref`'s path components — refusing a
 *    symlink at ANY component (closes SYMLINK) — then, from the ONE
 *    resulting file descriptor: `fstatSync`s it (must be a regular file),
 *    re-derives its canonical path via `realpath("/proc/self/fd/<fd>")` as
 *    defense-in-depth confirmation it is still beneath `authorizedRoot`,
 *    and reads its bytes from THAT SAME descriptor — never a second,
 *    pathname-based open (closes TOCTOU: there is no gap between "this is
 *    confirmed a regular file beneath the root" and "these are the bytes
 *    verified" — both statements are about the identical open file
 *    description).
 *
 * 5. When a construction site supplies a CUSTOM `readVerdict` (an
 *    alternate, non-default store — still construction-time-only,
 *    unchanged from ROUND 2), the ref-derivation VALIDATION in (3) still
 *    applies whenever `authorizedRoot` is ALSO configured (defense in
 *    depth, cheap, store-agnostic — pure string comparison); it is skipped
 *    only when a construction site both overrides the reader AND supplies
 *    no `authorizedRoot`, in which case that override remains, as in
 *    ROUND 2, a fully trusted construction-time decision this module does
 *    not second-guess.
 *
 * Everything from ROUND 1 §3 and ROUND 2 remains UNCHANGED: signature-by-
 * claimed-leg, GO, anti-replay (noteId pin), cross-artifact distinctness,
 * separation of powers off the READ content, and coherence with the inline
 * verdict. ROUND 3 adds a confinement gate BEFORE that pipeline runs; it
 * removes no existing check.
 *
 * ===========================================================================
 * D11 FIX — ROUND 3 §B (this build) — `authorId` is now BOUND to a verified
 * author signature; `input.authorId` is no longer trusted for anything.
 * ===========================================================================
 *
 * THE HOLE: `RunD11CeremonyInput.authorId` was a bare, per-call,
 * caller-supplied string. Every separation-of-powers check compared a leg
 * against WHATEVER `authorId` the caller happened to supply — a caller could
 * simply lie (supply an `authorId` distinct from every leg) even when the
 * TRUE author was genuinely one of the two legs reviewing its own note, and
 * the ceremony had no way to detect it.
 *
 * WHY NOT a trusted-author field on the note itself: graphify verified
 * (@67bf73c7) that `MemoryNote` carries NO trusted author field — graphify
 * authors nothing at admission (its anti-cycle boundary, §8, forbids it from
 * verifying signatures there). So this cannot be closed by reading a field
 * graphify stamped; it must be closed INSIDE the ceremony, the same way the
 * verdict-fabrication hole was: bind the claim to an unforgeable signature,
 * verified against a trust anchor this module already owns.
 *
 * THE FIX — reuses the EXACT SAME trust anchor as verdict signatures, no
 * second trust root:
 *
 * 1. The note carries an AUTHOR SIGNATURE in its open extension field
 *    (`note["h2a.author_signature"]`, `D11CeremonyNote`'s `[key: string]:
 *    unknown` slot — `MemoryNoteInput`/`note-builder.ts` already carry such
 *    an open slot; graphify stores it OPAQUE/unverified, it never inspects
 *    or verifies it). The shape, `AuthorSignature`, mirrors `VerdictArtifact`:
 *    `{authorLeg: LegIdentity, noteId, signature}` — a base64 Ed25519
 *    signature over the canonicalized `{authorLeg, noteId}` payload, binding
 *    the identity claim to BOTH who claims it and which note it is for
 *    (anti-replay, identical shape to how verdict signatures bind `noteId`).
 *    `authorLeg` reuses `LegIdentity` (not a new taxonomy, I4) precisely so
 *    it can be looked up in the SAME `trustedKeystore` a leg's key is.
 *
 * 2. `runD11Ceremony` RE-VERIFIES this signature — FIRST, before any other
 *    check — against the SAME construction-time `trustedKeystore` +
 *    `verifySignature` already closed over for verdicts (`verifyNoteAuthor`,
 *    below). No per-call/caller-injected dependency is consulted for this
 *    (injected_deps_hide_fabrication_hole discipline, same as ROUND 1/2/3's
 *    other anchors): an attacker who controls `deps` cannot make their own
 *    verifier say yes.
 *
 * 3. On success, the VERIFIED signer's identity — `authorLeg.session` — is
 *    what EVERY separation-of-powers check in this module now compares
 *    against, replacing every prior use of `input.authorId`.
 *    `RunD11CeremonyInput.authorId` remains in the type (callers may still
 *    pass it) but is STRUCTURALLY NEVER READ for a trust decision anywhere
 *    in this module — at most an unverified, decorative hint. Lying about it
 *    has zero effect: it is not consulted.
 *
 * 4. FAIL-CLOSED: a note with no author signature, a malformed one, one
 *    whose `noteId` does not match the note it is attached to, or one that
 *    does not verify against the trusted keystore, REFUSES the entire
 *    ceremony immediately — `launchLeg` is never called, exactly like the
 *    other pre-launch fail-closed checks (I5).
 *
 * PARKED (owner-gated, not this round): having graphify itself stamp a
 * trusted `authored_by` field at admission (via `AdmissionDeps`) — a
 * heavier, graphify-contract change. This round stays entirely h2a-side,
 * zero graphify change, closing the hole with a mechanism this module
 * already had (signature verification against its own trust anchor).
 *
 * ===========================================================================
 * D11 FIX — ROUND 4 (this build) — same-note verdict REPLAY is now refused
 * (a fresh, gate-issued ceremony nonce), and separation-of-powers is now
 * enforced on CANONICAL CRYPTO PRINCIPALS (public-key fingerprints), not
 * session strings.
 * ===========================================================================
 *
 * THE TWO HOLES (proven by an independent review, a FOURTH, separate leg from
 * the three that forced ROUNDS 1-3): at ROUND 3 (@64e3f8a4), the signed
 * verdict payload was `{noteId, verdict, leg, at}` — signed, noteId-pinned
 * against cross-note replay, but with NO freshness, NO nonce, NO one-shot
 * consumption. An attacker holding NO private key at all could REPLAY the
 * already-signed BYTES of two OLD, genuinely-produced GO verdicts for the
 * SAME noteId (from a prior, real ceremony) straight into a FRESH ceremony's
 * confined artifact locations and mint a fresh promotion — BLOCKER 1,
 * SAME-NOTE REPLAY. Separately, separation-of-powers derived and compared
 * `authorLeg.session` / `leg.session` STRINGS only, never the verified
 * PUBLIC KEY those sessions claim to speak for; `D11TrustedKeystore` never
 * enforced that a public key maps to at most one identity. If the same
 * keystore mapped ONE Ed25519 key to TWO (or three) different
 * `{model, session}` identities, the SAME cryptographic principal could
 * author a note under one alias and review it — genuinely signing, no forged
 * signature anywhere — under another, or "independently" review it TWICE
 * under two reviewer aliases — BLOCKER 2, CRYPTO AUTHOR/REVIEWER (and
 * REVIEWER/REVIEWER) ALIAS. Both reach `promoteNote({promoted:true})` at
 * @64e3f8a4 without ever forging a signature.
 *
 * FIX 1 — REPLAY: a fresh, gate-issued, unpredictable ONE-SHOT ceremony
 * nonce.
 *
 * 1. `runD11Ceremony` generates `ceremonyNonce = randomBytes(32).toString(
 *    "base64")` (`node:crypto`, NOT `Math.random`/`Date.now` — unpredictable)
 *    as the FIRST thing it does, every call. Never persisted, never reused
 *    across calls — a fresh value exists ONLY for the lifetime of this one
 *    ceremony invocation ("stateless one-shot": no server-side nonce store
 *    is needed because the GATE regenerates its own value every run and
 *    trusts nothing else).
 * 2. The nonce is threaded to `launchLeg(note, legSpec, ceremonyNonce)` (new
 *    3rd arg), so an honest leg's inline verdict — now `LegVerdict =
 *    MemoryVerdict & {ceremonyNonce}` (a LOCAL extension; slice 3's own
 *    `MemoryVerdict` is untouched, I4) — can carry it through `writeVerdict`
 *    into what actually gets signed. `VerdictArtifact` and
 *    `verdictSignedPayload` gain `ceremonyNonce`; the signature now covers
 *    `{noteId, verdict, leg, at, ceremonyNonce}`.
 * 3. THE GATE (load-bearing): for each READ artifact, (a) REQUIRE
 *    `artifact.ceremonyNonce === ceremonyNonce` (THIS run's generated value)
 *    — reject a stale/replayed artifact immediately, before any signature
 *    math; AND (b), independently, verify the signature over a payload
 *    REBUILT from the GATE's OWN `ceremonyNonce` variable — never
 *    `artifact.ceremonyNonce` as the source of truth for what to verify. A
 *    replayed old artifact's real signed bytes covered a DIFFERENT (or
 *    absent) nonce, so (b) alone already fails to verify against a payload
 *    built with the CURRENT run's nonce, even hypothetically without (a).
 *    Both (a) and (b) independently refuse a same-note replay — proven by
 *    the ROUND 4 mutation-check in the test file (each neutralized alone,
 *    then together, then restored — see that file's comments for the
 *    ACTUAL, reproduced results).
 * 4. `coherentWithInline` is extended to also require
 *    `artifact.ceremonyNonce === inline.ceremonyNonce`.
 *
 * FIX 2 — ALIAS: separation-of-powers on canonical CRYPTO PRINCIPALS.
 *
 * 1. `canonicalKeyFingerprint(pem)` — `createPublicKey` then re-export as
 *    SPKI DER, SHA-256 of that DER, base64. Two differently-formatted PEM
 *    encodings of the identical key canonicalize to the SAME fingerprint
 *    (robust to encoding, unlike a raw PEM string compare); an unparseable
 *    key throws (caught and turned into a ceremony refusal, I5).
 * 2. `verifyNoteAuthor` resolves and returns the VERIFIED author's
 *    fingerprint alongside its `authorId` — the SAME public key it already
 *    looked up to verify the author signature, so no extra trust decision is
 *    introduced.
 * 3. Separation-of-powers now requires THREE PAIRWISE-DISTINCT crypto
 *    principals (author, reviewer1, reviewer2), by fingerprint, fail-closed
 *    on any missing/unparseable key:
 *      - PRE-LAUNCH: `legSpec1`/`legSpec2`'s trusted keys are resolved and
 *        fingerprinted BEFORE `launchLeg` is ever called (symmetric with the
 *        existing pre-launch session-string checks) — refuses before a
 *        single model call is ever made.
 *      - POST-READ: re-checked off the ACTUAL READ artifacts' `leg`s'
 *        fingerprints (the SAME trusted keys that just verified each
 *        artifact's signature) — a `readVerdict` returning a different leg
 *        than the one launched is still caught, symmetric with ROUND 1's
 *        existing "off the READ content only" discipline.
 *    The existing session-string distinctness checks (`sameLegSpec`,
 *    `.session === verifiedAuthorId`) are KEPT, unchanged, as defense in
 *    depth; the fingerprint checks are the AUTHORITATIVE crypto layer added
 *    this round — a `.session` alias backed by a shared key now refuses even
 *    when every session string looks pairwise distinct (the
 *    reviewer/reviewer variant ROUND 3 could not catch, since `sameLegSpec`
 *    only compares `{model, session}`, never the key behind them).
 *
 * Everything from ROUNDS 1-3 remains UNCHANGED: path confinement,
 * signature-by-claimed-leg, GO, cross-note noteId anti-replay, the two
 * artifacts' structural (session) distinctness, coherence with the inline
 * verdict, and author-signature verification. ROUND 4 adds a freshness gate
 * and a crypto-principal gate; it removes no existing check.
 *
 * ===========================================================================
 * (Unchanged) FLOW summary and invariants.
 * ===========================================================================
 *
 * I5 — fail-closed at EVERY injected/lookup step: `deps` itself,
 * `deps.legSpecs`, `deps.launchLeg`, `deps.writeVerdict`, `deps.writeAttestation`,
 * `deps.port`, the CONSTRUCTION-TIME `readVerdict` (ROUND 2), and the
 * `trustedKeystore` lookup are all treated as untrusted or fallible — absent,
 * wrong shape, throwing, rejecting, or (for the keystore, and for
 * `readVerdict`'s return) simply "nothing there" all REFUSE with a structured
 * `{promoted:false, reason}`, never a silent success. A ceremony that fails
 * partway NEVER reaches `promoteNote` (slice 3's raw dispatch) — proven in
 * tests via counting stubs showing later steps are never invoked once an
 * earlier one refuses.
 *
 * I1 — durable identity slot: `note.noteId`, `note.principal_owner`,
 * `authorId`, and every `legSpec.{model,session}` / `leg.{model,session}` are
 * OPAQUE strings here — compared with `===` only (via slice 3's own
 * equality, or the local `sameLegSpec` mirror below), never parsed, split or
 * derived-from. The `trustedKeystore` is looked up BY the opaque `LegIdentity`
 * value, not by any string built from parsing it.
 * I4 — no new capabilities vocabulary: this module reuses `MemoryVerdict`,
 * `IndependenceAttestation`, `LegIdentity`, `checkDoubleConsensusPreconditions`
 * and `promoteNoteWithDoubleConsensus` UNCHANGED from `./promote-client.ts`;
 * `LegSpec` is a type alias of `LegIdentity`, not a second taxonomy, and
 * `D11CeremonyResult` reuses slice 3's own `PromoteNoteResult` shape — a
 * ceremony IS a (composed) promotion attempt, not a new outcome vocabulary.
 * `VerdictArtifact` is the one genuinely NEW shape this fix introduces — the
 * READ, signed record `MemoryVerdict` never was.
 */

import { createHash, createPublicKey, randomBytes, verify as verifyEd25519Signature } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { canonicalize } from "../../canonical.js";
import type { MemoryContext, MemoryProducerPort } from "./port-v1.js";
import {
  checkDoubleConsensusPreconditions,
  promoteNoteWithDoubleConsensus,
  type IndependenceAttestation,
  type LegIdentity,
  type MemoryVerdict,
  type PromoteNoteResult
} from "./promote-client.js";

/** A leg's launch spec — the same opaque `{model, session}` shape as `LegIdentity`. */
export type LegSpec = LegIdentity;

/**
 * The note the ceremony reviews. Deliberately narrow (I1: `noteId` and
 * `principal_owner` are opaque, carried, never derived); open beyond that
 * for whatever else a caller's note representation happens to carry.
 */
export interface D11CeremonyNote {
  readonly noteId: string;
  readonly principal_owner: string;
  readonly [key: string]: unknown;
}

export interface RunD11CeremonyInput {
  readonly note: D11CeremonyNote;
  /**
   * D11 FIX ROUND 3 §B: this is an UNVERIFIED, per-call, caller-supplied
   * hint — structurally NEVER READ for a trust decision anywhere in this
   * module. Separation of powers ("no leg may equal the author") is
   * enforced against the VERIFIED signer of `note["h2a.author_signature"]`
   * (see `verifyNoteAuthor`, below), not against this field. Kept in the
   * type only so a caller may still attach it for its own bookkeeping.
   */
  readonly authorId: string;
}

/**
 * D11 FIX ROUND 3 §B — the note's AUTHOR SIGNATURE, carried in the note's
 * open extension slot (`note[AUTHOR_SIGNATURE_KEY]`). Mirrors
 * `VerdictArtifact`'s shape deliberately: `authorLeg` reuses `LegIdentity`
 * (I4 — not a new taxonomy) precisely so it is looked up in the SAME
 * `trustedKeystore` a leg's key is — no second trust root. The signature
 * covers the canonicalized `{authorLeg, noteId}` payload, binding the
 * identity claim to both who claims it and which note it is for.
 */
export interface AuthorSignature {
  readonly authorLeg: LegIdentity;
  readonly noteId: string;
  /** Base64 Ed25519 signature over the canonicalized payload `{authorLeg, noteId}`. */
  readonly signature: string;
}

/** The note extension key `AuthorSignature` is carried under (`D11CeremonyNote`'s open `[key: string]: unknown` slot). */
export const AUTHOR_SIGNATURE_KEY = "h2a.author_signature" as const;

/**
 * A verdict ARTIFACT — what `readVerdict` returns after actually opening and
 * reading the file persisted at a ref (D11 FIX ROUND 1, path-bound for real
 * by ROUND 2's default reader). Distinct from `MemoryVerdict`
 * (`./promote-client.ts`), which is the in-memory shape a `launchLeg` call
 * returns INLINE and is never, by itself, trusted for a promotion decision:
 * `VerdictArtifact` additionally carries `signature`, proof of authorship
 * the inline shape has no room for.
 */
export interface VerdictArtifact {
  readonly noteId: string;
  readonly verdict: "GO" | "NO-GO";
  readonly leg: LegIdentity;
  readonly at: number;
  /**
   * D11 FIX ROUND 4 FIX 1 — the FRESH, gate-issued, unpredictable nonce this
   * verdict was signed under (`crypto.randomBytes(32)`, base64). The gate
   * REQUIRES this equal THIS RUN's own generated nonce (never trusted from
   * the artifact alone) and rebuilds the signed payload from ITS OWN nonce
   * value when verifying — see `verdictSignedPayload` and the ROUND 4 module
   * doc. Closes SAME-NOTE REPLAY: an old, genuinely-signed artifact for the
   * SAME noteId carries a DIFFERENT (stale) nonce and fails both checks.
   */
  readonly ceremonyNonce: string;
  /**
   * Base64 Ed25519 signature over the canonicalized payload
   * `{noteId, verdict, leg, at, ceremonyNonce}` (exactly these five fields,
   * nothing else) — binds the verdict to the note it reviews (anti-replay
   * across notes), the leg that claims to have produced it
   * (anti-impersonation), and the ceremony run it was produced for
   * (anti-replay of the SAME note, ROUND 4).
   */
  readonly signature: string;
}

/**
 * D11 FIX ROUND 4 FIX 1 — the inline verdict a leg returns, extended with the
 * ceremony's own freshly-generated nonce so it can flow through
 * `writeVerdict` into what actually gets signed. A LOCAL extension of slice
 * 3's `MemoryVerdict` (I4 — not a new taxonomy: every `MemoryVerdict` field
 * is untouched; `ceremonyNonce` is additive and never leaves this module —
 * `toMemoryVerdict` strips it back out before anything reaches
 * `promoteNoteWithDoubleConsensus`).
 */
export type LegVerdict = MemoryVerdict & { readonly ceremonyNonce: string };

/**
 * The trusted keystore — an opaque `LegIdentity` -> Ed25519 public key (PEM)
 * lookup. D11 FIX ROUND 1 §1: NEVER supplied per-call (that would make it
 * caller-swappable, reopening the fabrication hole) — it is closed over at
 * `createD11Ceremony` construction time by a trusted wiring site. Today this
 * is the LOCAL anchor (an in-process map/interface); it is designed to be
 * swapped later for the WP5 system-wide identity keystore WITHOUT a rewrite
 * of this module — only a different `D11TrustedKeystore` implementation is
 * needed, same one-method shape.
 */
export interface D11TrustedKeystore {
  /**
   * The Ed25519 public key (PEM), trusted for this CLAIMED leg, or
   * `undefined`/`null` if the leg is not known to the keystore (including an
   * entirely empty keystore) — treated as fail-closed REFUSE by the
   * ceremony, never as "no key, skip verification".
   */
  getPublicKey(leg: LegIdentity): string | undefined | null;
}

/**
 * The signature-verification seam. Real Ed25519 (`defaultVerifySignature`,
 * below) in production; stubbable at `createD11Ceremony` construction time
 * for tests. Injected at CONSTRUCTION, like the keystore, and for the same
 * reason: per-call injection would let a caller supply a verifier that
 * always says yes.
 */
export type VerifySignatureFn = (payload: unknown, signature: string, publicKey: string) => boolean;

/**
 * D11 FIX ROUND 2: the verdict-artifact reader seam. Real, CONFINED,
 * path-bound filesystem I/O (`defaultReadVerdict`, below — ROUND 3 makes it
 * confined) in production; stubbable at `createD11Ceremony` construction
 * time for tests. Injected at CONSTRUCTION, like the keystore and the
 * verifier, and for the identical reason: per-call injection is exactly
 * what let a caller hand the ceremony a fabricated, durability-free "read"
 * in the hole ROUND 2 closes. `ref` here is always a value THIS MODULE
 * derived (ROUND 3 §3), never the raw, unvalidated string a per-call
 * `writeVerdict` returned.
 */
export type ReadVerdictFn = (ref: string) => Promise<VerdictArtifact | null>;

export interface RunD11CeremonyDeps {
  /**
   * Launch one leg's review. INJECTED — real model-launching is out of scope
   * here. D11 FIX ROUND 4 FIX 1: the 3rd arg is THIS ceremony run's freshly
   * generated `ceremonyNonce` — an honest leg threads it into its returned
   * `LegVerdict` so it flows through `writeVerdict` into what gets signed.
   */
  readonly launchLeg?:
    | ((note: D11CeremonyNote, legSpec: LegSpec, ceremonyNonce: string) => Promise<LegVerdict>)
    | undefined
    | null;
  /** Persist one verdict, return its REF (locator). INJECTED — real file I/O is out of scope here. */
  readonly writeVerdict?: ((verdict: LegVerdict) => Promise<string>) | undefined | null;
  /** Persist the attestation, return its REF. INJECTED — real file I/O + signing are out of scope here. */
  readonly writeAttestation?: ((attestation: IndependenceAttestation) => Promise<string>) | undefined | null;
  /** The two legs to launch. Must be structurally distinct (checked BEFORE launch). */
  readonly legSpecs?: readonly [LegSpec, LegSpec] | undefined | null;
  readonly port?: MemoryProducerPort | undefined | null;
  readonly ctx: MemoryContext;
  // NOTE (D11 FIX ROUND 2): there is deliberately NO `readVerdict` field here.
  // It moved to `CreateD11CeremonyOptions` — construction-time only. A
  // per-call caller cannot supply or override it; see the ROUND 2 module doc
  // for why leaving it here was itself the hole an independent review proved.
}

/** Reuses slice 3's result shape unchanged — a ceremony IS a composed promotion attempt. */
export type D11CeremonyResult = PromoteNoteResult;

/** What `createD11Ceremony` closes over — construction-time only, never per-call. */
export interface CreateD11CeremonyOptions {
  /** The trust anchor for verdict signatures. See `D11TrustedKeystore` above. */
  readonly trustedKeystore: D11TrustedKeystore;
  /** Defaults to real Ed25519 (`defaultVerifySignature`). Override only for tests. */
  readonly verifySignature?: VerifySignatureFn | undefined;
  /**
   * D11 FIX ROUND 2: the verdict-artifact reader. Defaults to
   * `defaultReadVerdict`, a REAL, CONFINED, path-bound filesystem reader
   * (ROUND 3). Override ONLY for tests — e.g. a fake, construction-time
   * `Map`-backed store-reader — wired at the SAME trusted construction site
   * as `trustedKeystore`, never by a per-call caller of the returned
   * `runD11Ceremony`.
   */
  readonly readVerdict?: ReadVerdictFn | undefined;
  /**
   * D11 FIX ROUND 3: the confinement root for verdict reads. REQUIRED
   * (construction throws otherwise) whenever the REAL default reader is in
   * use (no `readVerdict` override) — a real filesystem reader with no
   * confinement root is exactly the hole ROUND 3 closes. When supplied
   * alongside a CUSTOM `readVerdict`, it still activates the ref-derivation
   * validation (ROUND 3 §3/§5) as defense in depth, even though that
   * override reader itself is not required to be filesystem-backed.
   */
  readonly authorizedRoot?: string | undefined;
}

export type RunD11Ceremony = (
  input: RunD11CeremonyInput,
  deps: RunD11CeremonyDeps | undefined | null
) => Promise<D11CeremonyResult>;

/** A fixed, descriptive orchestrator id — NOT a minted identity (I1); this module names the mechanism, not a person/session. */
const ORCHESTRATOR_ID = "h2a:d11-ceremony" as const;

/**
 * Placeholder refs for the PRE-write, PRE-read precondition gate (a cheap
 * early reject on the INLINE verdicts, before any write happens) — no real
 * ref exists yet at that point. Never appear in the evidence handed to the
 * port; discarded the moment the real refs come back from `writeVerdict`.
 */
const PENDING_LEG1_REF = "__d11_ceremony_pending_leg1_ref__" as const;
const PENDING_LEG2_REF = "__d11_ceremony_pending_leg2_ref__" as const;

function refuse(reason: string): D11CeremonyResult {
  return { outcome: { promoted: false, reason }, localOnly: true };
}

function sameLegSpec(a: LegIdentity, b: LegIdentity): boolean {
  return a.model === b.model && a.session === b.session;
}

function errorReason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * D11 FIX ROUND 4 FIX 1 — the signed payload now includes `ceremonyNonce`,
 * but deliberately as a SEPARATE, EXPLICIT parameter (`ceremonyNonce`,
 * passed by the caller), never read off `artifact.ceremonyNonce`. The gate
 * (below) ALWAYS calls this with THIS RUN's own generated nonce — the ONE
 * source of truth for what a valid signature must cover this run — so a
 * replayed artifact whose real signed bytes covered a DIFFERENT (stale)
 * nonce fails to verify here even if the artifact's self-reported
 * `ceremonyNonce` field were tampered to match.
 */
function verdictSignedPayload(artifact: VerdictArtifact, ceremonyNonce: string): unknown {
  return { noteId: artifact.noteId, verdict: artifact.verdict, leg: artifact.leg, at: artifact.at, ceremonyNonce };
}

function toMemoryVerdict(artifact: VerdictArtifact): MemoryVerdict {
  return { noteId: artifact.noteId, verdict: artifact.verdict, leg: artifact.leg, at: artifact.at };
}

function coherentWithInline(artifact: VerdictArtifact, inline: LegVerdict): boolean {
  return (
    artifact.noteId === inline.noteId &&
    artifact.verdict === inline.verdict &&
    artifact.leg.model === inline.leg.model &&
    artifact.leg.session === inline.leg.session &&
    artifact.ceremonyNonce === inline.ceremonyNonce
  );
}

/**
 * The default, real signature verifier: Ed25519 over the canonicalized
 * payload, via `node:crypto` — the same primitive `./signature.ts` uses
 * elsewhere in h2a, applied here to a raw base64 signature string (this
 * seam's shape) rather than the `H2ASignature{by,alg,value}` envelope.
 */
export function defaultVerifySignature(payload: unknown, signature: string, publicKeyPem: string): boolean {
  let key;
  try {
    key = createPublicKey({ key: publicKeyPem, format: "pem" });
  } catch {
    return false;
  }
  let raw: Buffer;
  try {
    raw = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  try {
    const message = Buffer.from(canonicalize(payload), "utf8");
    return verifyEd25519Signature(null, message, key, raw);
  } catch {
    return false;
  }
}

/**
 * D11 FIX ROUND 2: shape-validate a value read back from the durable store
 * before trusting it as a `VerdictArtifact` at all — a malformed or
 * unrelated JSON blob at a path must never be handed to the signature check
 * as if it were a real artifact (it would simply fail signature
 * verification, but failing CLOSED here, before that, is cheaper and
 * clearer about why).
 */
function isVerdictArtifactShape(value: unknown): value is VerdictArtifact {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.noteId !== "string") return false;
  if (v.verdict !== "GO" && v.verdict !== "NO-GO") return false;
  if (typeof v.at !== "number") return false;
  // D11 FIX ROUND 4 FIX 1 — a verdict artifact with no (or empty)
  // ceremonyNonce is not a valid shape at all — refused HERE, before ever
  // reaching the freshness/signature gate below.
  if (typeof v.ceremonyNonce !== "string" || v.ceremonyNonce.length === 0) return false;
  if (typeof v.signature !== "string") return false;
  if (typeof v.leg !== "object" || v.leg === null) return false;
  const leg = v.leg as Record<string, unknown>;
  return typeof leg.model === "string" && typeof leg.session === "string";
}

/**
 * D11 FIX ROUND 4 FIX 2 — the canonical CRYPTO PRINCIPAL fingerprint for an
 * Ed25519 public key: parse the PEM, re-export as SPKI DER (a canonical
 * encoding independent of the ORIGINAL PEM's own formatting/line-wrapping),
 * then SHA-256 that DER. Two differently-formatted PEM encodings of the
 * IDENTICAL key canonicalize to the SAME fingerprint — robust to encoding,
 * unlike a raw PEM string compare. Throws on an unparseable key; callers
 * MUST catch this and turn it into a fail-closed ceremony refusal (I5) —
 * there is no safe default fingerprint for a key that cannot even be parsed.
 */
export function canonicalKeyFingerprint(publicKeyPem: string): string {
  const key = createPublicKey({ key: publicKeyPem, format: "pem" });
  const der = key.export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("base64");
}

// ---------------------------------------------------------------------------
// D11 FIX ROUND 3 §B — author-signature verification. Reuses the SAME
// construction-time `trustedKeystore` + `verifySignature` verdict
// signatures use — no second trust root, no per-call-injected verifier.
// ---------------------------------------------------------------------------

/** Mirrors `isVerdictArtifactShape`'s shape-before-signature discipline: refuse a malformed shape BEFORE ever handing it to signature verification. */
function isAuthorSignatureShape(value: unknown): value is AuthorSignature {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.noteId !== "string") return false;
  if (typeof v.signature !== "string") return false;
  if (typeof v.authorLeg !== "object" || v.authorLeg === null) return false;
  const authorLeg = v.authorLeg as Record<string, unknown>;
  return typeof authorLeg.model === "string" && typeof authorLeg.session === "string";
}

function authorSignedPayload(sig: AuthorSignature): unknown {
  return { authorLeg: sig.authorLeg, noteId: sig.noteId };
}

type AuthorVerification =
  | {
      readonly ok: true;
      readonly authorId: string;
      /**
       * D11 FIX ROUND 4 FIX 2 — the VERIFIED author's canonical crypto-
       * principal fingerprint (the SAME trusted key that just verified the
       * author signature). Used by separation-of-powers below to refuse a
       * key-fingerprint alias even when `authorId`/`leg.session` strings
       * look pairwise distinct.
       */
      readonly authorKeyFingerprint: string;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * D11 FIX ROUND 3 §B — verify `note[AUTHOR_SIGNATURE_KEY]` against the SAME
 * construction-time `trustedKeystore` + `verifySignature` verdict
 * signatures are checked against (no second trust root — the module doc's
 * ROUND 3 §B explains why). Returns the VERIFIED signer's `authorLeg.session`
 * on success; a structured refusal reason on ANY failure — missing
 * signature, malformed shape, a `noteId` that does not match the note it is
 * attached to (anti-replay), an unknown/untrusted claimed identity, or an
 * invalid signature. Never throws; never falls back to any caller-supplied
 * value.
 */
function verifyNoteAuthor(
  note: D11CeremonyNote,
  trustedKeystore: D11TrustedKeystore,
  verifySignature: VerifySignatureFn
): AuthorVerification {
  const raw = note[AUTHOR_SIGNATURE_KEY];
  if (!isAuthorSignatureShape(raw)) {
    return {
      ok: false,
      reason: `note has no valid author signature (${AUTHOR_SIGNATURE_KEY}) — refusing (fail-closed)`
    };
  }
  if (raw.noteId !== note.noteId) {
    return {
      ok: false,
      reason: "the note's author signature noteId does not match the note itself — refusing (anti-replay)"
    };
  }
  const publicKey = trustedKeystore.getPublicKey(raw.authorLeg);
  if (typeof publicKey !== "string" || publicKey.length === 0) {
    return {
      ok: false,
      reason: "no trusted public key for the note's claimed author — refusing (fail-closed; unknown author or empty keystore)"
    };
  }
  let signatureOk: boolean;
  try {
    signatureOk = verifySignature(authorSignedPayload(raw), raw.signature, publicKey);
  } catch (err) {
    return { ok: false, reason: `author signature verification threw — ${errorReason(err)}` };
  }
  if (!signatureOk) {
    return {
      ok: false,
      reason: "the note's author signature is invalid — refusing (fabricated, tampered, or signed by the wrong key)"
    };
  }
  // D11 FIX ROUND 4 FIX 2 — resolve the canonical fingerprint of the SAME
  // trusted key that just verified this signature. Fail-closed (I5) on an
  // unparseable key, the same discipline as every other lookup in this
  // module.
  let authorKeyFingerprint: string;
  try {
    authorKeyFingerprint = canonicalKeyFingerprint(publicKey);
  } catch (err) {
    return {
      ok: false,
      reason: `the note's author trusted public key is not a parseable Ed25519 key — refusing (fail-closed) — ${errorReason(err)}`
    };
  }
  return { ok: true, authorId: raw.authorLeg.session, authorKeyFingerprint };
}

// ---------------------------------------------------------------------------
// D11 FIX ROUND 3 — path-confinement primitives. REUSES the technique
// proven and MERGED in `packages/h2a-runtime/src/identity-cull/cull.ts`
// (PR #160): `realpathSync` canonicalization of a trusted root,
// `openSync(..., O_RDONLY | O_DIRECTORY | O_NOFOLLOW)` descriptor-relative
// directory walking that refuses a symlink at ANY path component
// (`openNoFollowDirectory`/`descriptorPath` below mirror cull.ts's own
// functions of the same names and shape), and a SINGLE held file
// descriptor carried from open through the `fstatSync` check to the read —
// never a second, pathname-based open. `h2a` does not depend on
// `h2a-runtime` at build time (the peer dependency is optional), so the
// primitives are reimplemented locally rather than imported; the technique,
// not the module, is what is reused.
// ---------------------------------------------------------------------------

/**
 * Reject `/`, `\`, NUL, `.` and `..` outright rather than stripping them —
 * a hostile `noteId`/leg identity value must never be silently "cleaned"
 * into some OTHER, ambiguous, possibly-colliding path segment.
 */
function sanitizePathSegment(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string to derive a confined verdict path`);
  }
  if (value === "." || value === "..") {
    throw new Error(`${label} refuses "." or ".." as a path segment`);
  }
  if (value.includes("/") || value.includes("\\") || value.includes("\0")) {
    throw new Error(`${label} refuses a path separator or NUL byte in a path segment`);
  }
  return value;
}

/** Mirrors cull.ts's `isInside` — `relative()`-based containment check, no `..`, never absolute. */
function isBeneathRoot(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return rel !== "" && rel !== "." && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * D11 FIX ROUND 3: the ONE location a leg's verdict for a note may ever be
 * read from — `beneath(authorizedRoot, sanitized(noteId), sanitized(legId))`.
 * Pure (no filesystem access) so the ceremony can compute it and compare it
 * against `writeVerdict`'s per-call return value BEFORE touching disk.
 * Derived from the ceremony's OWN dispatch decision (the `legSpec` it
 * actually launched, already checked distinct/non-author before launch) —
 * never from anything `launchLeg`/`writeVerdict` claim back.
 */
export function deriveVerdictRef(authorizedRoot: string, noteId: string, leg: LegIdentity): string {
  const root = resolve(authorizedRoot);
  const noteSegment = sanitizePathSegment(noteId, "noteId");
  const model = sanitizePathSegment(leg?.model, "leg.model");
  const session = sanitizePathSegment(leg?.session, "leg.session");
  // NB-03: length-prefix `model` so the (model, session) → segment mapping is
  // injective. A bare `${model}__${session}` join is ambiguous — ("claude",
  // "3__test") and ("claude__3", "test") both yield "claude__3__test.json", which
  // would alias two DISTINCT legs to ONE verdict file and silently collapse the
  // double-consensus into a single verdict. Encoding model's length ahead of it
  // makes the model|session boundary unambiguous regardless of underscores in
  // either value (the segment decodes to exactly one (model, session) pair).
  const legSegment = sanitizePathSegment(`${model.length}_${model}_${session}.json`, "leg");
  const derived = resolve(root, noteSegment, legSegment);
  if (!isBeneathRoot(derived, root)) {
    // Defense in depth: sanitizePathSegment above should already make this
    // unreachable (no `/`/`..` can survive into a segment), but a derived
    // path is never trusted without this check regardless.
    throw new Error("derived verdict ref escaped authorizedRoot");
  }
  return derived;
}

/** Mirrors cull.ts's `descriptorPath` — a safe, descriptor-relative `/proc/self/fd/<fd>[/<name>]` path. */
function descriptorPath(fd: number, name?: string): string {
  if (name !== undefined && (name.length === 0 || name.includes(sep) || name === "." || name === "..")) {
    throw new Error(`unsafe descriptor-relative verdict path segment: ${name}`);
  }
  return name === undefined ? `/proc/self/fd/${fd}` : `/proc/self/fd/${fd}/${name}`;
}

/** Mirrors cull.ts's `openNoFollowDirectory` — open a directory descriptor, refusing a symlink. */
function openNoFollowDirectory(path: string): number {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(fd).isDirectory()) throw new Error(`not a directory: ${path}`);
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

/** The path components of `target` relative to `root`, or `null` if `target` is not strictly beneath `root`. */
function componentsBeneathRoot(root: string, target: string): string[] | null {
  const rel = relative(root, target);
  if (rel === "" || rel === "." || rel.startsWith("..") || isAbsolute(rel)) return null;
  const parts = rel.split(sep).filter((part) => part.length > 0);
  return parts.length > 0 ? parts : null;
}

/**
 * D11 FIX ROUND 3 — confined-open + single-descriptor read. Walks from the
 * realpath'd `authorizedRoot` down through `ref`'s path components, opening
 * EVERY component (directories AND the final file) with `O_NOFOLLOW` —
 * refusing a symlink anywhere in the chain (closes SYMLINK). The final file
 * descriptor is `fstatSync`'d (must be a regular file), its canonical path
 * re-derived via `realpath(/proc/self/fd/<fd>)` and re-checked beneath the
 * root (defense in depth), and then READ FROM THAT SAME DESCRIPTOR — never
 * a second, pathname-based open (closes TOCTOU: no gap between "confirmed a
 * regular file beneath the root" and "these are the verified bytes"; both
 * are about the identical open file description).
 *
 * Returns `null` on ANY failure — missing path, escaped root, a symlink at
 * any component, not a regular file — never throws.
 */
function readConfinedFileBytes(authorizedRoot: string, ref: string): Buffer | null {
  let resolvedRoot: string;
  let resolvedRef: string;
  try {
    resolvedRoot = realpathSync(resolve(authorizedRoot));
    resolvedRef = resolve(ref);
  } catch {
    return null;
  }
  const components = componentsBeneathRoot(resolvedRoot, resolvedRef);
  if (!components) return null;

  const openedFds: number[] = [];
  try {
    let currentFd: number;
    try {
      currentFd = openNoFollowDirectory(resolvedRoot);
    } catch {
      return null;
    }
    openedFds.push(currentFd);

    for (let index = 0; index < components.length - 1; index += 1) {
      let nextFd: number;
      try {
        nextFd = openNoFollowDirectory(descriptorPath(currentFd, components[index]!));
      } catch {
        return null;
      }
      openedFds.push(nextFd);
      currentFd = nextFd;
    }

    const finalName = components[components.length - 1]!;
    let fileFd: number;
    try {
      fileFd = openSync(descriptorPath(currentFd, finalName), constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      return null;
    }
    openedFds.push(fileFd);

    let stat;
    try {
      stat = fstatSync(fileFd);
    } catch {
      return null;
    }
    if (!stat.isFile()) return null;

    let canonicalOpened: string;
    try {
      canonicalOpened = realpathSync(descriptorPath(fileFd));
    } catch {
      return null;
    }
    if (!isBeneathRoot(canonicalOpened, resolvedRoot)) return null;

    try {
      return readFileSync(fileFd);
    } catch {
      return null;
    }
  } finally {
    for (const fd of openedFds) {
      try {
        closeSync(fd);
      } catch {
        // best-effort close — the descriptor may already be invalid after a failure above
      }
    }
  }
}

/**
 * D11 FIX ROUND 2/3 — the default, REAL, CONFINED durable-store reader.
 * `ref` IS a filesystem path, opened only via the confined,
 * descriptor-relative, O_NOFOLLOW walk (`readConfinedFileBytes`, ROUND 3)
 * beneath `authorizedRoot` — never a bare `readFile(ref)` — then
 * JSON-parsed and shape-validated. Returns `null` on ANY failure — missing
 * file, escaped root, a symlink anywhere in the chain, permission error,
 * malformed JSON, or a well-formed-but-wrong-shape value — never throws.
 * What it returns, when non-null, is PATH-BOUND: literally the bytes
 * actually persisted at `ref`, confirmed beneath `authorizedRoot`, never a
 * value the caller constructed in memory and never bytes read via a path
 * that could have been re-resolved after any check.
 */
export async function defaultReadVerdict(ref: string, authorizedRoot: string): Promise<VerdictArtifact | null> {
  const bytes = readConfinedFileBytes(authorizedRoot, ref);
  if (!bytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
  return isVerdictArtifactShape(parsed) ? parsed : null;
}

/**
 * Factory: builds the actual `runD11Ceremony` function, CLOSED OVER
 * `trustedKeystore` (and, optionally, `verifySignature` and `readVerdict`).
 * This is the anti-fabrication anchor (D11 FIX ROUND 1 §1 + ROUND 2 §1):
 * signature verification always uses THIS keystore, and the verdict
 * read-back always uses THIS reader (real filesystem by default) — never
 * one a caller of the returned function can inject per-call. Throws
 * synchronously on a missing/malformed `trustedKeystore` — a
 * construction-site wiring bug should fail loudly and immediately, not
 * silently produce a ceremony that can never verify anything.
 */
export function createD11Ceremony(options: CreateD11CeremonyOptions): RunD11Ceremony {
  if (!options || typeof options.trustedKeystore?.getPublicKey !== "function") {
    throw new Error(
      "createD11Ceremony requires a trustedKeystore with getPublicKey(leg) — construction-time, not caller-swappable"
    );
  }
  const trustedKeystore = options.trustedKeystore;
  const verifySignature: VerifySignatureFn =
    typeof options.verifySignature === "function" ? options.verifySignature : defaultVerifySignature;
  const hasCustomReadVerdict = typeof options.readVerdict === "function";
  const authorizedRoot = typeof options.authorizedRoot === "string" ? options.authorizedRoot : undefined;

  // D11 FIX ROUND 3: a real filesystem reader with no confinement root is
  // exactly the hole this round closes — fail loudly at construction, the
  // same pattern as a missing `trustedKeystore`, rather than silently
  // producing a ceremony whose default reader is unconfined.
  if (!hasCustomReadVerdict && !authorizedRoot) {
    throw new Error(
      "createD11Ceremony requires authorizedRoot when no custom readVerdict is supplied — the real default reader must be confined (D11 FIX ROUND 3)"
    );
  }

  const readVerdict: ReadVerdictFn = hasCustomReadVerdict
    ? (options.readVerdict as ReadVerdictFn)
    : (ref: string) => defaultReadVerdict(ref, authorizedRoot as string);

  /**
   * Run the D11 ceremony end to end. See the module doc for the full flow.
   * Any refusal at any step returns a structured `{promoted:false, reason}`
   * with `localOnly: true`, and guarantees `promoteNote` (slice 3's raw
   * dispatch, the only thing that ever touches the injected port for a
   * promotion) is NEVER reached.
   */
  return async function runD11Ceremony(
    input: RunD11CeremonyInput,
    deps: RunD11CeremonyDeps | undefined | null
  ): Promise<D11CeremonyResult> {
    // =========================================================================
    // D11 FIX ROUND 4 FIX 1 — the FIRST thing every ceremony run does: mint a
    // fresh, unpredictable, gate-owned nonce (`node:crypto.randomBytes`, NOT
    // Math.random/Date.now). Never persisted, never reused — a "stateless
    // one-shot": THIS run's own value is the ONE source of truth every read
    // artifact is checked against below (see the ROUND 4 module doc).
    // =========================================================================
    const ceremonyNonce = randomBytes(32).toString("base64");

    if (!deps) {
      return refuse("no ceremony dependencies injected — refusing (fail-closed, I5)");
    }

    // =========================================================================
    // D11 FIX ROUND 3 §B — verify the note's AUTHOR SIGNATURE FIRST, against
    // the SAME construction-time trustedKeystore + verifySignature used for
    // verdict signatures (no second trust root). Every separation-of-powers
    // check below compares against the VERIFIED signer's identity —
    // `verifiedAuthorId` — never `input.authorId` (an unverified, per-call
    // hint this module structurally never reads for a trust decision).
    // FAIL-CLOSED: no signature, a malformed one, a noteId mismatch, or one
    // that does not verify against the trusted keystore refuses immediately —
    // launchLeg is never called, exactly like the other pre-launch checks.
    // =========================================================================
    const authorVerification = verifyNoteAuthor(input.note, trustedKeystore, verifySignature);
    if (!authorVerification.ok) {
      return refuse(authorVerification.reason);
    }
    const verifiedAuthorId = authorVerification.authorId;
    const authorKeyFingerprint = authorVerification.authorKeyFingerprint;

    // D11 FIX ROUND 2: `readVerdict` is intentionally NOT destructured from
    // `deps` here — it is not a field of `RunD11CeremonyDeps` at all. Even if
    // a caller attaches a `readVerdict` property to the object passed as
    // `deps` anyway (JS does not enforce the TS shape at runtime), it is
    // never read: the CLOSED-OVER `readVerdict` from `createD11Ceremony`
    // (above) is what's used below, unconditionally.
    const { launchLeg, writeVerdict, writeAttestation, legSpecs, port, ctx } = deps;

    if (!Array.isArray(legSpecs) || legSpecs.length !== 2) {
      return refuse("exactly 2 legSpecs are required to run a double-consensus ceremony");
    }
    const [legSpec1, legSpec2] = legSpecs;

    // --- Separation of powers, BEFORE anything is launched. ---
    if (sameLegSpec(legSpec1, legSpec2)) {
      return refuse(
        "the two legSpecs are not structurally distinct (same model+session) — refusing before launch"
      );
    }
    if (legSpec1.session === verifiedAuthorId || legSpec2.session === verifiedAuthorId) {
      return refuse(
        "a legSpec's session equals the note's VERIFIED author — separation of powers requires launching only independent reviewers"
      );
    }

    // =========================================================================
    // D11 FIX ROUND 4 FIX 2 — separation of powers on CANONICAL CRYPTO
    // PRINCIPALS, PRE-LAUNCH. The session-string checks above are kept as
    // defense in depth, but a public key can back TWO (or three) distinct
    // `{model, session}` identities in the SAME trusted keystore — a
    // `.session` alias the checks above cannot see. Resolve + fingerprint
    // BOTH legSpecs' trusted keys BEFORE a single model call is made; refuse
    // fail-closed on a missing/unparseable key (cannot establish
    // distinctness, so it is never treated as "assume distinct").
    // =========================================================================
    let legSpec1KeyFingerprint: string;
    let legSpec2KeyFingerprint: string;
    try {
      const legSpec1PublicKey = trustedKeystore.getPublicKey(legSpec1);
      if (typeof legSpec1PublicKey !== "string" || legSpec1PublicKey.length === 0) {
        return refuse(
          "legSpec1: no trusted public key — refusing before launch (fail-closed; cannot establish crypto-principal distinctness)"
        );
      }
      const legSpec2PublicKey = trustedKeystore.getPublicKey(legSpec2);
      if (typeof legSpec2PublicKey !== "string" || legSpec2PublicKey.length === 0) {
        return refuse(
          "legSpec2: no trusted public key — refusing before launch (fail-closed; cannot establish crypto-principal distinctness)"
        );
      }
      legSpec1KeyFingerprint = canonicalKeyFingerprint(legSpec1PublicKey);
      legSpec2KeyFingerprint = canonicalKeyFingerprint(legSpec2PublicKey);
    } catch (err) {
      return refuse(
        `could not resolve a canonical key fingerprint before launch — refusing (fail-closed) — ${errorReason(err)}`
      );
    }
    if (legSpec1KeyFingerprint === authorKeyFingerprint || legSpec2KeyFingerprint === authorKeyFingerprint) {
      return refuse(
        "a legSpec's trusted public key is the SAME canonical crypto principal as the note's VERIFIED author (key-fingerprint alias) — separation of powers requires launching only independent reviewers — refusing before launch"
      );
    }
    if (legSpec1KeyFingerprint === legSpec2KeyFingerprint) {
      return refuse(
        "legSpec1 and legSpec2 resolve to the SAME canonical crypto principal (key-fingerprint alias) — refusing before launch (two reviewer identities must not share one key)"
      );
    }

    if (typeof launchLeg !== "function") {
      return refuse("no launchLeg injected — refusing (fail-closed, I5)");
    }

    // --- Launch both legs CONCURRENTLY: neither sees the other's verdict. ---
    // D11 FIX ROUND 4 FIX 1: both legs receive THIS run's ceremonyNonce as a
    // 3rd arg — an honest leg threads it into its returned LegVerdict.
    let v1: LegVerdict;
    let v2: LegVerdict;
    try {
      [v1, v2] = await Promise.all([
        launchLeg(input.note, legSpec1, ceremonyNonce),
        launchLeg(input.note, legSpec2, ceremonyNonce)
      ]);
    } catch (err) {
      return refuse(`launchLeg failed: ${errorReason(err)}`);
    }

    // --- Cheap pre-write reject on the INLINE (caller-controlled) verdicts. ---
    // This is a courtesy that saves a write + read round trip on an obviously
    // bad ceremony; it is NOT the authority — the READ, signature-verified
    // gate below (D11 FIX §3) is what actually protects `promoteNote`.
    const precheckAttestation: IndependenceAttestation = {
      leg1: v1.leg,
      leg2: v2.leg,
      distinctModels: v1.leg.model !== v2.leg.model,
      distinctSessions: v1.leg.session !== v2.leg.session,
      verdictsWrittenBeforeCrossVisibility: true,
      orchestrator: ORCHESTRATOR_ID
    };
    const precheck = checkDoubleConsensusPreconditions({
      verdicts: [v1, v2],
      attestation: precheckAttestation,
      leg1Ref: PENDING_LEG1_REF,
      leg2Ref: PENDING_LEG2_REF,
      authorId: verifiedAuthorId
    });
    if (!precheck.ok) {
      return refuse(`double-consensus preconditions not met: ${precheck.reason}`);
    }

    if (typeof writeVerdict !== "function") {
      return refuse("no writeVerdict injected — refusing (fail-closed, I5)");
    }
    let leg1Ref: string;
    let leg2Ref: string;
    try {
      leg1Ref = await writeVerdict(v1);
      leg2Ref = await writeVerdict(v2);
    } catch (err) {
      return refuse(`writeVerdict failed: ${errorReason(err)}`);
    }

    // =========================================================================
    // D11 FIX ROUND 3 §3 — path confinement, BEFORE any filesystem access on
    // writeVerdict's per-call, caller-controlled ref. Active whenever
    // `authorizedRoot` is configured (always, when using the real default
    // reader — construction requires it; also as defense in depth when a
    // construction site supplies both a custom reader AND an authorizedRoot).
    // The ceremony derives the ONE location each leg's verdict may be read
    // from, from data it already trusts at this point (the note being
    // promoted, and the legSpec it actually dispatched) — and requires the
    // per-call ref to resolve to EXACTLY that path, string-for-string,
    // REFUSING otherwise. This closes TRAVERSAL structurally: a `../`-laden
    // ref can never be textually identical to the clean, sanitized,
    // ceremony-derived path.
    // =========================================================================
    let leg1ReadRef = leg1Ref;
    let leg2ReadRef = leg2Ref;
    if (authorizedRoot) {
      let expectedRef1: string;
      let expectedRef2: string;
      try {
        expectedRef1 = deriveVerdictRef(authorizedRoot, input.note.noteId, legSpec1);
        expectedRef2 = deriveVerdictRef(authorizedRoot, input.note.noteId, legSpec2);
      } catch (err) {
        return refuse(`could not derive a confined verdict path: ${errorReason(err)}`);
      }
      if (resolve(leg1Ref) !== expectedRef1) {
        return refuse(
          "leg1: writeVerdict's ref does not resolve to the ceremony-derived confined path — refusing (traversal/relocation refused before any file access)"
        );
      }
      if (resolve(leg2Ref) !== expectedRef2) {
        return refuse(
          "leg2: writeVerdict's ref does not resolve to the ceremony-derived confined path — refusing (traversal/relocation refused before any file access)"
        );
      }
      // From here on, ONLY the ceremony's own derived strings are ever
      // handed to readVerdict — never the raw per-call ref, even though the
      // two are required equal at this point.
      leg1ReadRef = expectedRef1;
      leg2ReadRef = expectedRef2;
    }

    // =========================================================================
    // D11 FIX §3 — the READ, signature-verified gate. Everything from here on
    // is what actually protects `promoteNote`; nothing before this point does.
    // `readVerdict` here is ALWAYS the construction-time closure (ROUND 2) —
    // a real function is guaranteed (default or a construction-time override),
    // so there is no "readVerdict absent" branch left to guard: a missing
    // durable artifact now surfaces as `readVerdict(ref)` resolving to `null`
    // (checked immediately below), not as this dep being absent.
    // =========================================================================

    let artifact1: VerdictArtifact | null;
    let artifact2: VerdictArtifact | null;
    try {
      [artifact1, artifact2] = await Promise.all([readVerdict(leg1ReadRef), readVerdict(leg2ReadRef)]);
    } catch (err) {
      return refuse(`readVerdict failed: ${errorReason(err)}`);
    }
    if (!artifact1) {
      return refuse(
        "readVerdict found no artifact at leg1's ref — refusing (no file at the claimed ref; the fabrication hole this closes)"
      );
    }
    if (!artifact2) {
      return refuse(
        "readVerdict found no artifact at leg2's ref — refusing (no file at the claimed ref; the fabrication hole this closes)"
      );
    }

    // --- Per artifact: freshness, fingerprint, signature (against the CLAIMED leg's trusted key), GO, anti-replay. ---
    let artifact1KeyFingerprint!: string;
    let artifact2KeyFingerprint!: string;
    for (const [label, artifact] of [
      ["leg1", artifact1],
      ["leg2", artifact2]
    ] as const) {
      // D11 FIX ROUND 4 FIX 1 — freshness, checked FIRST and cheaply: REQUIRE
      // this artifact was signed for THIS ceremony's own, freshly generated
      // nonce. A stale/replayed artifact (from ANY prior ceremony, even one
      // that genuinely, validly signed it) is refused here before any
      // signature math runs.
      if (artifact.ceremonyNonce !== ceremonyNonce) {
        return refuse(
          `${label}: the read verdict's ceremonyNonce does not match this ceremony's freshly generated nonce — refusing (stale or replayed artifact; anti-replay)`
        );
      }

      const publicKey = trustedKeystore.getPublicKey(artifact.leg);
      if (typeof publicKey !== "string" || publicKey.length === 0) {
        return refuse(
          `${label}: no trusted public key for the claimed leg — refusing (fail-closed; unknown leg or empty keystore)`
        );
      }
      // D11 FIX ROUND 4 FIX 2 — resolve the canonical crypto-principal
      // fingerprint for the CLAIMED leg's trusted key (the SAME key about to
      // verify the signature below). Used by the cross-artifact checks
      // after this loop.
      let fingerprint: string;
      try {
        fingerprint = canonicalKeyFingerprint(publicKey);
      } catch (err) {
        return refuse(
          `${label}: trusted public key is not a parseable Ed25519 key — refusing (fail-closed) — ${errorReason(err)}`
        );
      }
      if (label === "leg1") {
        artifact1KeyFingerprint = fingerprint;
      } else {
        artifact2KeyFingerprint = fingerprint;
      }

      let signatureOk: boolean;
      try {
        // D11 FIX ROUND 4 FIX 1 — the payload is rebuilt from THIS RUN's OWN
        // `ceremonyNonce` variable, never `artifact.ceremonyNonce` — see
        // `verdictSignedPayload` and the ROUND 4 module doc for why this,
        // independently of the explicit check above, already refuses a
        // same-note replay.
        signatureOk = verifySignature(verdictSignedPayload(artifact, ceremonyNonce), artifact.signature, publicKey);
      } catch (err) {
        return refuse(`${label}: signature verification threw — ${errorReason(err)}`);
      }
      if (!signatureOk) {
        return refuse(
          `${label}: signature invalid for the claimed leg — refusing (fabricated, tampered, or signed by the wrong key)`
        );
      }
      if (artifact.verdict !== "GO") {
        return refuse(`${label}: the read verdict is not GO — refusing`);
      }
      if (artifact.noteId !== input.note.noteId) {
        return refuse(
          `${label}: the read verdict's noteId does not match the note being promoted — refusing (anti-replay)`
        );
      }
    }

    // --- Across the two READ artifacts, off the READ content only. ---
    if (sameLegSpec(artifact1.leg, artifact2.leg)) {
      return refuse(
        "the two read verdict artifacts are not independent — the same leg was read twice — refusing"
      );
    }
    if (artifact1.leg.session === verifiedAuthorId || artifact2.leg.session === verifiedAuthorId) {
      return refuse(
        "a read verdict artifact's leg session equals the note's VERIFIED author — separation of powers requires an independent reviewer — refusing"
      );
    }
    // D11 FIX ROUND 4 FIX 2 — separation of powers on the ACTUAL READ
    // artifacts' CANONICAL CRYPTO PRINCIPALS, POST-READ. Re-checked off the
    // fingerprints resolved from the SAME trusted keys that just verified
    // each artifact's signature — a `readVerdict` returning a different leg
    // than the one launched (and thus a different key) is still caught
    // here, symmetric with the existing "off the READ content only"
    // discipline for the session-string checks above. This is the
    // AUTHORITATIVE crypto check; the session-string checks above are kept
    // as defense in depth.
    if (artifact1KeyFingerprint === authorKeyFingerprint || artifact2KeyFingerprint === authorKeyFingerprint) {
      return refuse(
        "a read verdict artifact's leg resolves to the SAME canonical crypto principal as the note's VERIFIED author (key-fingerprint alias) — separation of powers requires an independent reviewer — refusing"
      );
    }
    if (artifact1KeyFingerprint === artifact2KeyFingerprint) {
      return refuse(
        "the two read verdict artifacts resolve to the SAME canonical crypto principal (key-fingerprint alias) — refusing (two reviewer identities must not share one key)"
      );
    }

    // --- Per artifact again: coherence with the INLINE verdict launchLeg returned. ---
    if (!coherentWithInline(artifact1, v1)) {
      return refuse(
        "leg1: the read verdict artifact is not coherent with launchLeg's inline verdict — refusing"
      );
    }
    if (!coherentWithInline(artifact2, v2)) {
      return refuse(
        "leg2: the read verdict artifact is not coherent with launchLeg's inline verdict — refusing"
      );
    }

    // --- Build the FINAL verdicts + attestation from the READ, VERIFIED artifacts. ---
    // Never the inline v1/v2 from here on — a bug in the checks above cannot
    // cause a fabricated inline verdict to be what actually gets promoted.
    const verifiedVerdicts: readonly [MemoryVerdict, MemoryVerdict] = [
      toMemoryVerdict(artifact1),
      toMemoryVerdict(artifact2)
    ];
    const attestation: IndependenceAttestation = {
      leg1: artifact1.leg,
      leg2: artifact2.leg,
      distinctModels: artifact1.leg.model !== artifact2.leg.model,
      distinctSessions: artifact1.leg.session !== artifact2.leg.session,
      verdictsWrittenBeforeCrossVisibility: true,
      orchestrator: ORCHESTRATOR_ID
    };

    if (typeof writeAttestation !== "function") {
      return refuse("no writeAttestation injected — refusing (fail-closed, I5)");
    }
    let attestationRef: string;
    try {
      attestationRef = await writeAttestation(attestation);
    } catch (err) {
      return refuse(`writeAttestation failed: ${errorReason(err)}`);
    }

    if (!port) {
      return refuse("no memory producer port injected — refusing (fail-closed, I5)");
    }

    // `promoteNoteWithDoubleConsensus` re-runs `checkDoubleConsensusPreconditions`
    // on this VERIFIED data as an unconditional second layer (unchanged from
    // slice 3) before ever touching the port.
    return promoteNoteWithDoubleConsensus(
      {
        noteId: input.note.noteId,
        ctx,
        verdicts: verifiedVerdicts,
        attestation,
        attestationRef,
        leg1Ref,
        leg2Ref,
        authorId: verifiedAuthorId
      },
      port
    );
  };
}
