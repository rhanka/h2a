# Peer drive consent — owner-ratified implementation

Track: 01M38RD4ZQ2MT7FHX8HHDP2P9R. Specification of record: the 2026-09-24 reconciliation and build brief, decisions 3a–d and 6b superseding earlier open questions.

Authorization retains this order: missing registration refuses; self authorizes; target conductor or principal authorizes; shared scope plus mandate authority authorizes; only then resolve consent. Legacy successes remain exactly `{ok:true}`. An absent request stays `unauthorized`. Read projections distinguish an absent request from `consent-refused`; status and authorization reads append no journal entries or other store files.

Consent covers an ordered agent pair and a time window. Per-instruction scope is consciously deferred by the owner to minimize the diff and preserve the signed drive format. Different instructions can use the same grant. Request and target grant are signed domain-separated payloads bound to the request hash, pair and registration UUIDs. Mutable negotiation state and inbox delivery cannot authorize. Refusal and request-specific revocation remain terminal for that request; renewal requires a new request. Either party may revoke; only the target may refuse or grant. A revoke without `requestId` revokes all live requests/grants of the ordered pair: its signed pair-level refusal wins over every conflicting live grant, independent of journal order. It remains live until the latest requested expiry among the live requests at revocation (at most the 25-hour request horizon). New grants cannot bypass a live pair-level revocation.

Grants verify against active target keys. If `target.principal` is set, a local registration with exactly that id must co-sign the same payload using its bound MCP session and an active key. A target-only grant remains unusable until co-signed; missing key, session or valid co-signature produces explicit `consent-principal-unavailable`. No principal keys are provisioned. If principal is undefined, the conditional policy records `principal-absent`, never `co-signed`. The conditional variant is ratified by the owner. There is no CLI grant surface.

Named constants: answer default 15 minutes / cap 1 hour; grant default 1 hour / cap 24 hours. Defaults describe suggested windows; omitted dates never confer authority. The reader independently enforces caps, valid dates, narrowing and the signed response deadline. At `now >= deadline`, silence expires. Grants cannot be committed before their issue time or after the answer deadline.

The receiver passes its supplied clock to signature verification, consent preflight and admission. A persisted journal high-water mark rejects genuine rollback, including backdated writes. Without a supplied clock the receiver uses wall time. Admission prepares the derived pair index outside `registryLock`, then holds registry and negotiation locks in that order, checks the journal fingerprint has not changed, rechecks signatures/keys/authority and appends a durable `drive-admitted` record before injection. A concurrent journal change fails closed; the next attempt rebuilds before taking the registry lock. Revocation cuts off new admissions; already admitted execution is not recalled. Execution is recorded as unknown, not proven complete. PID/local-files consent admission is supported; lease topology and read-only stores fail closed for consent admission, while a plain absent-consent pair still returns legacy `unauthorized` (403). The receiver's store is authoritative; a sender mirror cannot authorize it.

Refusals: `unauthorized`, `consent-pending`, `consent-refused`, `consent-expired`, `consent-revoked`, `consent-invalid`, `consent-principal-unavailable` map to HTTP 403; `consent-unavailable` maps to 503 for clock, lock or I/O failure. Success uses `via: consent`, grant/request ids, expiry and the distinct principal decision. Generic consent-namespace writes and stabilization are blocked. Invalid evidence is ignored and reported, never treated as a grant. Negative evidence verifies under historical keys so revoking its signing key cannot resurrect a grant.

## Bounded admission and full historical verification

The append-only pair journal is the sole source of truth. Each open store derives an in-memory domain index from it: live pair request/grant/revocation evidence within the 48-hour cap window (all live requests fit within 25 hours), plus one valid expired request group for denial diagnostics and signed per-request terminal revocation markers with their request witnesses (O(revocations), not O(history)), admission IDs within 48 hours for replay detection, and the per-pair anti-rollback high-water scalar. No signature-verification result is cached: the resolver verifies relevant signed evidence and active keys for every reception. The final journal entry is retained only to construct the next hash-chain link, not as a historical integrity certificate.

A missing or suspect index is fully reconstructed from the journal, never self-authorizing. An external journal fingerprint change (inode, size, nanosecond mtime/ctime) causes reconstruction outside the registry lock. A receiver store performs full-chain verification at startup and every 60 seconds while alive, outside admission and outside the registry lock. Each periodic pass reads and verifies the whole chain, including already-covered entries; it does not trust a cached verified head plus delta. A detected fault prevents consent authorization. Ordinary journal reads also retain full verification. Corrupt on-disk journals retain the existing `consent-invalid` / 403 mapping.

Historical retroactive-alteration detection is **deferred, not removed**: a change not caught by the fingerprint is detected at the next full pass (60 seconds plus event-loop scheduling delay), or at restart. Startup, periodic verification and exceptional index rebuilds remain O(history); steady-state reception depends on the pair's bounded evidence window and replay lookup, not total journal history. The journal itself remains append-only and can grow without bound; pruning the derived index never deletes journal records. Reads do not advance the persisted high-water scalar or append audits; writes/admissions do.

## Limits to declare at merge

R1 establishes possession of an active target key, not target intent. The owner's original measurement reports 53,904 private-key files under one OS account in `/home/antoinefa/h2a-workspace/.h2a/keys`, including a direct cross-lane key read (source: build brief decision 2, 2026-09-24). This earlier file count and the following later private-key count are separate reported measurements, not interchangeable quantities.

Source: `~/h2a-workspace/.h2a/registry/instances.jsonl`, count 2026-09-24: 0 / 26,964 live registrations carry a `principal`, so the conditional co-signature branch is inert on the current measured fleet.

Source: `~/h2a-workspace/.h2a/keys/`, measurement 2026-09-24: 26,964 private keys, mode 0600, all owned by the current uid; a principal key is readable by every same-uid lane, so co-signature is explicit but NOT attributable to human intent. Out-of-band principal custody does not exist today; per-agent custody is deferred to Track 01M38WH19VE7VGW8QY0P9NHHVX.

These are owner-provided measurements, not a new scan during this build. `DRIVE_CONSENT_LIMIT` includes both decision-3d measurements and sources in read-time projections and persisted audit records. An MCP agent session is not attestation of a human session. The signature and co-signature must not be presented as human attribution.

A holder of a revoked target key can still submit historically verifiable refusal/revocation evidence. This is a deliberate denial-of-service-only capability: it cannot grant authority.

MCP mutations write `observedAt = Date.now()`. A later `h2a drive receive --now` earlier than the last MCP write returns `consent-unavailable` / 503 as clock rollback. This mixed-clock behavior is inert when production receivers and MCP writers use the same wall clock; synthetic clocks must account for the last write.

## Index fidelity and renewal (binding Option A)

The full-journal `projectConsent` is unchanged and remains the source of truth.
The permanent corpus in `packages/h2a/test/drive-consent-index.test.js` reuses the
owner-supplied `fuzz-index.mjs` generator (ten deterministic seeds (original 1–7 plus 42, 123, 999), 40 journals
of 60 checkpoints each, warm and reopened stores). Its invariant is asymmetric:
if the full journal refuses, the index refuses; if the index grants, the full
journal grants. Other denial reasons may approximate within refusal, never toward
a grant. Whenever the full projection's winning reason is `consent-revoked`,
the index must return exactly that reason. Any change to pruning, retention or
index construction MUST rerun this corpus and the age-boundary corpus in
`drive-consent-e2e.test.js`.

Receipt age cannot erase a still-authoritative signed revocation. A request-specific
revocation retains its signed request witness after expiry, and both signatures
are evaluated again by the projection. A mere new peer request cannot authorize;
a genuinely new target-signed grant on a new request ID can, in both projections.
A pair revocation retains its evidence and a valid request witness within its
signed window; past its signed end it does not manufacture a revoked verdict.
Historical evidence that also binds a request hash retains the request-terminal
meaning that the full projection already assigns it. Late terminal writes restore
the matching request group from the verified journal if it has left the index.

## Journal growth, startup budget and operational action

Measured 2026-09-24 in the direct Codex build checkout (non-production): the
owner's `scratchpad/adv.mjs 2000` produced **3,924,093 bytes for 2,000 receptions**,
or **1.9620465 MB per 1,000 receptions** (decimal MB; includes initial request,
grant and audit overhead). Source script:
`/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-h2a/a03ecf8e-c55d-48d0-b155-aa94f319ef58/scratchpad/adv.mjs`.
The instrumented copy `/home/antoinefa/.cache-tmp/drive-consent-build/adv-measured.mjs`
reopened the 3,926,053-byte journal (after its extra final reception) five times;
emitted full-pass durations were 24.625, 23.382, 24.247, 22.656 and 24.237 ms
(median **24.237 ms**, approximately **6.17 ms/MB**).
Raw evidence: `growth-complete.log` in that same build-report directory. Measurements
include concurrent verification load and warm filesystem caches; these are local
measurements, not fleet guarantees.

At **one reception per second**, seven days means 604,800 receptions, about
**1,186.65 MB** and an extrapolated **7,325 ms per full pass**; 30 days means
2,592,000 receptions, about **5,085.62 MB** and **31,395 ms per full pass** at the
measured slope. These week/month values are linear projections, not executions
of week/month-sized journals; memory and I/O pressure may increase them.

The startup full pass runs **once per MCP server process** when its store is
created and reused, followed by full periodic passes every 60 seconds. The **CLI
pays the startup full pass once per command invocation** that creates a store;
there is no store reused across CLI processes. The earlier inventory estimated
about 25 call sites; this checkout has 36 textual `createLocalStore(` call sites
in `packages/h2a/src/cli.ts`. This debt covers CLI startup as well as MCP startup.

Server store creation always emits a structured JSON measurement to stderr with
event `drive-consent.full-verification` (once at process startup); subsequent
60-second full passes also report the trend. Only `createMcpServer` opts in via
`alwaysEmitConsentBudget: true`. The option defaults to false, so CLI creations
and periodic passes emit fresh measurements only at or above the alert threshold.
No CLI call sites need an override; initialize/readOnly remain storage capabilities.
Even when negotiations are absent, the signal path runs with a near-zero duration.

The alert threshold is **5% × MCP_IDENTITY_TIMEOUT_MS = 1,000 ms**; escalation is
**10% × MCP_IDENTITY_TIMEOUT_MS = 2,000 ms**. Alert is strictly below escalation,
giving advance warning; escalation reserves 90% of the 20,000 ms identity-acquisition
budget for registry, key, session and readiness work. Both follow future deadline
changes. Measurements include `durationMs`, `alertThresholdMs`, `thresholdMs`
(escalation), `identityDeadlineMs`, `budgetFraction`, `due`, `track` and `action`.
Startup costs sum across all consent pair journals. At the measured slope,
2,000 ms corresponds to approximately **324 MB / 165,123 cumulative receptions**.

At or above escalation, the signal emits `due:true` and
`action:"ESCALATE debt -> due"`, and best-effort writes
`<store root>/drive-consent-budget.json`: durationMs, thresholdMs,
identityDeadlineMs, crossedAt (ISO), and track `01M39VC11XBNSE8W2ASMQRRKZV`.
The durable marker lives on the writable **server store root**, not in an agent
session. Every subsequent creation (and periodic pass) rereads and re-emits the
saved crossing with `replayed:true` before measuring again, even for a quiet CLI.
It persists until handled by this precise recheck rule: a fresh measurement
strictly below escalation best-effort removes it, after replay; a measurement at
or above escalation rewrites it with the latest crossing. Recovery does not undo
a canonical Track escalation.

All marker reads, writes and removals are best-effort under try/catch. The read-only
startup contract takes precedence: on a read-only root (EACCES/EROFS), the marker
cannot persist, but the crossing stderr signal still emits and marker I/O never
fails store creation or changes availability. A failed removal leaves the marker
for replay on the next creation/pass. No missing store directories are created by
this signal path. Absence of a marker is not proof of budget compliance.

An escalation crossing means Track **01M39VC11XBNSE8W2ASMQRRKZV moves debt -> due**.
The canonical Track mutation is performed by **h-cond from the canonical owner
checkout**, attaching the crossing evidence; this worktree is not the canonical
Track writer. The persistent marker supplies the durable outstanding signal;
no daily watcher agent session is required.

The 24-hour scale replay (`adv-24h-after.mjs`, actual 86,400 receptions at one
simulated reception/second) produced 169,424,497 bytes, zero legitimate refusals,
345,532 ms total, 3.851 ms first reception and 2.935 ms last reception. This
measures reception with an already-open store, not the separate startup pass.
`24h-final.log` contains the raw result. The growth slope is consistent with
`adv.mjs`; the startup/full-pass cost remains O(journal size).

A measurement-only copy of the compiled store counted entries after the unchanged
pruning function (`measure-markers.mjs`, `markers-final.log`; instrumentation is
not shipped). With requests separated by 72 hours, 100 and 1,000 request/grant
pairs with 10 revocations both retained **24 evidence entries**; 1,000 pairs with
100 revocations retained **204 entries**. All renewal grants authorized. This
observes 2R signed terminal entries plus four live/diagnostic entries, independent
of the expired unrevoked history. Replay IDs remain bounded by the 48-hour window,
so their size depends on the reception rate within that window.
