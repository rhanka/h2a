# Peer drive consent — owner-ratified implementation

Track: 01M38RD4ZQ2MT7FHX8HHDP2P9R. Specification of record: the 2026-09-24 reconciliation and build brief, decisions 3a–d and 6b superseding earlier open questions.

Authorization retains this order: missing registration refuses; self authorizes; target conductor or principal authorizes; shared scope plus mandate authority authorizes; only then resolve consent. Legacy successes remain exactly `{ok:true}`. An absent request stays `unauthorized`. Audit records distinguish `requestState: no-request` from a request with `consent-refused`.

Consent covers an ordered agent pair and a time window. Per-instruction scope is consciously deferred by the owner to minimize the diff and preserve the signed drive format. Different instructions can use the same grant. Request and target grant are signed domain-separated payloads bound to the request hash, pair and registration UUIDs. Mutable negotiation state and inbox delivery cannot authorize. Refusal and revocation remain terminal for that request; renewal requires a new request. Either party may revoke; only the target may refuse or grant.

Grants verify against active target keys. If `target.principal` is set, a local registration with exactly that id must co-sign the same payload using its bound MCP session and an active key. A target-only grant remains unusable until co-signed; missing key, session or valid co-signature produces explicit `consent-principal-unavailable`. No principal keys are provisioned. If principal is undefined, the conditional policy records `principal-absent`, never `co-signed`. The mandatory global-refusal variant is not implemented; owner arbitration remains pending. There is no CLI grant surface.

Named constants: answer default 15 minutes / cap 1 hour; grant default 1 hour / cap 24 hours. Defaults describe suggested windows; omitted dates never confer authority. The reader independently enforces caps, valid dates, narrowing and the signed response deadline. At `now >= deadline`, silence expires. Grants cannot be committed before their issue time or after the answer deadline.

The receiver passes its supplied clock to signature verification, consent preflight and admission. A persisted journal high-water mark rejects genuine rollback, including backdated writes. Without a supplied clock the receiver uses wall time. Admission holds registry then negotiation locks, rechecks keys/authority and appends a durable `drive-admitted` record before injection. Revocation cuts off new admissions; already admitted execution is not recalled. Execution is recorded as unknown, not proven complete. PID/local-files authority is supported; lease topology fails closed. The receiver's store is authoritative; a sender mirror cannot authorize it.

Refusals: `unauthorized`, `consent-pending`, `consent-refused`, `consent-expired`, `consent-revoked`, `consent-invalid`, `consent-principal-unavailable` map to HTTP 403; `consent-unavailable` maps to 503 for clock, lock or I/O failure. Success uses `via: consent`, grant/request ids, expiry and the distinct principal decision. Generic consent-namespace writes and stabilization are blocked. Invalid evidence is ignored and reported, never treated as a grant. Negative evidence verifies under historical keys so revoking its signing key cannot resurrect a grant.

## Limits to declare at merge

R1 establishes possession of an active target key, not target intent. The owner's original measurement reports 53,904 private-key files under one OS account in `/home/antoinefa/h2a-workspace/.h2a/keys`, including a direct cross-lane key read (source: build brief decision 2, 2026-09-24). This earlier file count and the following later private-key count are separate reported measurements, not interchangeable quantities.

Source: `~/h2a-workspace/.h2a/registry/instances.jsonl`, count 2026-09-24: 0 / 26,964 live registrations carry a `principal`, so the conditional co-signature branch is inert on the current measured fleet.

Source: `~/h2a-workspace/.h2a/keys/`, measurement 2026-09-24: 26,964 private keys, mode 0600, all owned by the current uid; a principal key is readable by every same-uid lane, so co-signature is explicit but NOT attributable to human intent. Out-of-band principal custody does not exist today; per-agent custody is deferred to Track 01M38WH19VE7VGW8QY0P9NHHVX.

These are owner-provided measurements, not a new scan during this build. `DRIVE_CONSENT_LIMIT` includes both decision-3d measurements and sources in read-time projections and persisted audit records. An MCP agent session is not attestation of a human session. The signature and co-signature must not be presented as human attribution.
