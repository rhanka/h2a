# h2a addressing failures — forensic analysis + remediation plan

Date: 2026-06-08. Status: FINAL (reviewed by Opus-4.8 correctness/safety + Codex-5.5-xhigh pragmatic).

## 1. Evidence base

433 real envelopes on the bus (`~/h2a-workspace/.h2a/inbox+outbox`) cross-referenced with live
presence + registry, **plus** the latest h2a-active conversation of 10 projects (sent-tech-design-system,
dataviz, a2a-cli, remote, sentropic, openerp, graphify, radar-immobilier, mermaid-editor, matchID).

Deliverability of the 433 envelopes: 36% delivered to a LIVE agent · 16% queued (registered, offline) ·
**41% bare alias `host:label`** (only the first-claimant reads) · 7% orphan-uuid / host-less / phantom.

## 2. Failure modes (ranked) with evidence

- **F1 — bare/base-label instead of the live full id (41%).** Lands in a base-label dir invisible to the
  session reading by full id. remote: "C'est mon erreur d'adressage" → "RE-LIVRAISON (id complet)".
- **F2 — role/topic sub-labels as addresses (phantom channels).** `claude:sentropic-scale`, `-38c`,
  `claude:scale`, `codex:a2a-cli-conductor` (15), `claude:39-auth`. Inbox dir exists, no live session.
- **F3 — invented IDs.** radar: "mes délégations visaient codex:immo4/claude:immo2 qui n'existent pas".
- **F4 — SPLIT-BRAIN h2a root (STRUCTURAL, the headline).** `resolveRoot = flags.root || join(cwd(),".h2a")`
  (cli.ts:353) with auto-create (`ensureLayout`). Any agent not launched with `--root`/`H2A_ROOT` from the
  shared home silently forks onto a repo-local auto-created bus. **8 dead repo-local `.h2a` buses found.**
  Also: mcp-http/k8s honor `H2A_ROOT` but the stdio `mcp-serve` path (the one everyone uses) ignores it.
  A perfect address dead-drops if the two sides are on different roots.
- **F5 — envelope validation ("erreurs d'envoi inbox").** `payload is not a valid H2A envelope` from flat
  fields / missing `createdAt`. dataviz, sent-tech→graphify, radar, mermaid.
- **F6 — liveness not blocking + presence fragility.** Mass `recipientLive:false`; discover→put TOCTOU.
  (The "2026-06-04 date change expired heartbeats" claim is a MISDIAGNOSIS — `isSessionExpired` is epoch
  arithmetic, calendar-invariant, session.ts:221-242. Real cause: 15s expiry + heartbeat needs a live
  mcp-serve `setInterval` (unref'd) → idle/parked hosts have no fresh presence → discover `[]`.)
- **F7 — wrong-topic wake (BR25 class).** Symptom of F1/F2 (the wrong id receives), not a separate cause.
- **F8 — read without pop.** matchID re-read the same envelope 7×. Structural: `readInbox` is
  non-destructive, no seen-marker/cursor (store.ts:1318).

## 3. Root causes

- **RC-B (headline)** h2a root not unified; silent cwd auto-create; stdio ignores `H2A_ROOT`. → F4. Precondition for the rest.
- **RC-A** No "discover → live full id" resolution before send; bare alias/label accepted silently. → F1, F2, F3, F7.
- **RC-C** Role/topic channels not first-class → labels invented. → F2. (Resolved by RC-A fix + skill; no new protocol — see WP-C cut.)
- **RC-D** Envelope validation late, no field-level reason. → F5.
- **RC-E** Liveness non-blocking + presence/heartbeat fragility (NOT a calendar bug). → F6, F8-adjacent.

## 4. Already shipped this session (honest)

0.55 re-anchor closes F7 collision (but AMPLIFIES F1: more uuids → bare alias misses more). 0.56 host-prefix
guard closes only the host-less subset of F1. 0.57 canonical liveness fixes the read side of F6 (still
non-blocking). F4, F2, F5 untouched.

## 5. Work packages (reviewed). Reversible = ship now (vetted, re-presented). Irreversible = PARK for the user.

Order (reviewers' consensus): **root first, then resolve-before-send, then cleanup.**

- **WP-1 — root unification (mechanism, NON-destructive).** Branch `wp1/h2a-root-honor-and-doctor`.
  - Make stdio `mcp-serve`/`resolveRoot` honor `H2A_ROOT` (parity with mcp-http/k8s). REVERSIBLE.
  - WARN loudly (stderr) when `resolveRoot` falls back to `cwd/.h2a` with no `--root`/`H2A_ROOT` — point to the
    shared home; do not silently fork. REVERSIBLE.
  - `h2a doctor`: detect + REPORT split-brain (repo-local `.h2a` while a global is configured), stray
    repo-local buses, case-dup dirs. Report only, NO deletion. No absolute paths in shared artifacts. REVERSIBLE.
  - PARKED (irreversible): (1) flipping the DEFAULT fallback cwd→global; (2) destructive GC/migration of the 8
    dead buses + 69 polluted dirs.
- **WP-2 — resolve-before-send (legible, 4-way, NO silent auto-route).** Branch `wp2/addr-resolve-before-send`.
  - Add canonical `(host,label)`-prefix live lookup (discover-by-base; today's match is exact, handlers.ts:692).
  - On a bare `host:label` (no uuid) send: **>1 live → refuse + list candidate uuids**; **0 live + registered →
    dormant deposit + flag**; **0 live + NOT registered → REFUSE** (don't deposit to a phantom); **exactly 1
    live → deliver to canonical dir AND surface `liveCandidate:<uuid>`** so the caller re-sends to the full id.
  - Malformed 3-segment handle (seg3 not 12-hex, e.g. `claude:sentropic:sentropic-chat`) → warn, treat as not
    a real instance. REVERSIBLE.
  - Skill: resolve via discover to the live full id before sending; never invent a sub-label.
  - PARKED (irreversible — Opus dissent): **silently auto-ROUTING a bare alias to the single live uuid.** It is
    a mail-interception primitive at an unauthenticated layer (a colliding live session captures a channel /
    dormant peer's mail) and is data-irreversible. Codex would ship it; Opus parks it. → USER DECIDES.
- **WP-3 — cleanup batch.** Branch `wp3/inbox-validation-and-hygiene`.
  - WP-D: replace the `isH2AEnvelope` boolean with `validateH2AEnvelope(): {ok, errors[]}` in `@sentropic/h2a`;
    throw the field list from the two store chokepoints (store.ts:1276 inbox + 1348 outbox) → covers CLI + MCP. REVERSIBLE.
  - WP-E (descoped): calendar-invariance PIN test for `isSessionExpired`; report dormant explicitly; do NOT
    chase the non-bug. REVERSIBLE.
  - WP-F: skill — always `pop` processed envelopes; note the structural cause (non-destructive read). REVERSIBLE.
- **WP-C — CUT** (both reviewers): discover-by-scope already covers role/topic routing; phantom sub-labels are a
  missing-resolution symptom, not a missing feature. One skill line, no new protocol.

## 6. PARKED irreversible decisions (for the user, presented at steady state)

1. **Canonical root + cleanup** (RC-B): (a) flip the default fallback `cwd/.h2a` → fixed global
   (`H2A_HOME ?? ~/h2a-workspace/.h2a`)? Codex: yes, repo-local only on explicit `--root`. (b) destructive
   GC/migration of the 8 dead repo-local buses + 69 polluted/ case-dup global dirs?
2. **Bare-alias auto-route** (RC-A): silently deliver a bare `host:label` to the single live uuid?
   Codex: ship (kills 41% of misses). Opus: PARK (interception, irreversible). → your call.

## 7. Reversible decisions TAKEN (vetted by both reviewers; re-presented at end)

The 4-way send classification (WP-2), field-level validation errors (WP-D), `H2A_ROOT` honoring + cwd-fallback
warning + report-only doctor (WP-1), the calendar-invariance pin + explicit-dormant (WP-E), pop guidance (WP-F).
