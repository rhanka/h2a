# h2a — double-review (Opus 4.8 + Codex 5.5) follow-ups still open

Status: the double adversarial review of `v0.39.0..HEAD` (2026-06-06) found bugs;
**7 were fixed (0.49.0) + the gateway redirect_uri BLOCKER (0.50.0)**. This tracks
what remains, with precise diagnoses so each is a focused, low-context pass.

## BLOCKER #2 — legacy-alias cross-read (needs careful migration surgery, NOT rushed)

**Real (Codex), confirmed.** `recordIdentityAlias` (runtime/identity/live.ts:279) records
the legacy alias `claude:<cwd-leaf>` on **every** connect, with
`adoptedKeyring: Boolean(adoptedFrom)`. `readInbox`/`popInboxMessage` dual-read every
recorded alias dir. So two agents in the **same cwd** (a de-collisioned peer +
the owner) both record `claude:<cwd>` and both read its inbox → cross-read of
messages meant for the other.

**Why the naive fix failed:** filtering dual-read to `adoptedKeyring === true` regressed
the legitimate case. In a **fresh workspace first connect** there is no prior legacy
keyring, so `provesLocalKey` is false → `legacyDecision.adopt` false → `adoptedKeyring:false`
**for the legitimate owner too**. So `adoptedKeyring` does NOT distinguish owner from
de-collisioned peer (test `identity-live-wiring.test.js:102` proved it).

**The right fix (unique owner for the bare-legacy alias):** record `claude:<cwd>` as a
dual-read source for the **first claimant only**; a later same-cwd agent must NOT record
it (full de-collision incl. the alias). The gate must be "is this legacyInstance already
claimed by ANOTHER instance?" — NOT gated on `adoptedKeyring` (which is false in the fresh
case). Options: (a) at `recordIdentityAlias`, skip if another instance already recorded
this `legacyInstance`; (b) store a single `legacyOwner` per legacyInstance and only the
owner dual-reads. Plus, as defense-in-depth, filter exposed envelopes by `target.instance`
(only expose envelopes whose target canonicalizes to the reader or its aliases; allow
untargeted) — this stops perennial-targeted cross-reads regardless of the alias gate, and
is safe (does not touch migration). Add tests: two agents same cwd, agent B must NOT read
A's `claude:<cwd>` inbox; the single-agent legit read still works.

**Why deferred:** identity migration is the most load-bearing subsystem; a correct fix
needs its own focused pass + migration tests, not a tail-of-session change. Niche trigger
(two concurrent agents, same cwd, one de-collisioned).

## MINORS (low risk)

- **local-tmux double-Enter is unconditional** (runtime/drive/index.ts): on a single-line
  prompt / wrong pane, the 2nd Enter can submit an empty turn. Fix: host/capability-aware
  submit, or a `submitEnterCount` option. Low risk (empty prompt Enter is usually a no-op).
- **outboxDir has no raw fallback** (paths.ts/store.ts readOutbox): inbox got `inboxDirRaw`
  dual-read for pre-case-fold orphans; outbox did not, so pre-fix outbox copies are invisible.
  Low impact (sender's own audit copy). Fix: mirror the inbox dual-read for outbox.
- **`status` outputShape mislabel** (cli-contract.ts): declared `action`, emits an
  inventory `{ok,root,counts,direct,indirect}`. Passes the contract test by carrying `ok:true`.
  Cosmetic; consider a dedicated shape or `resource`.

## Done (for the record)

Fixed 0.49.0: canonicalAddress preserves `~name`; inbox-wake targets own pane; popInboxMessage
deletes all copies; inbox-wake advances `seen` only on success; `--wake` rejects headless +
auto→native/local-tmux; isH2ASession validates `version`; safePathSegment neutralizes pure-dot
(rootForSub traversal). Fixed 0.50.0: broker redirect_uri+PKCE validation before 39-auth.
