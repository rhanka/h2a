# h2a ↔ sentropic enrollment (v3 — owner decisions locked, double-consensus closed)

**Status: spec / design-only — passed independent double-consensus (gpt-5.5 + Opus, both GO on v3).**
No plan, no code. Owner decisions (Fabien, 2026-07-11) are **locked and normative** (§1). v1 was
gpt-5.5 **NO-GO**; v2 closed the honeypot substantively; **v3 closes the 6 pre-promotion must-fixes**
raised by the second independent pass (redaction-location, pre-upload consent, encrypt-then-chain,
resume-downgrade, generation snapshots, dual-id attestation binding) — both reviewers GO on v3, three
plan-tier residuals folded into §10.
Preserves EVO-4/4b invariants (three-layer; decider≠relay; client-side signature never server-minted;
aggregator ≠ beneficiary — `docs/specs/2026-06-27-h2a-canevas-evo4-decision-screen.md` §2/§7).

> **The feature (owner).** h2a enrolls onto a sentropic server. Workspaces = sentropic's + local, with
> enrollment of a local workspace into sentropic; publish dossiers to the neutral space or
> per-workspace; every h2a-enrolled workspace is created in sentropic to start; and every workspace's
> CLI conversations are persisted on sentropic too, with resume/recovery.

## 1. Decisions locked (NORMATIVE)

- **(a) A3-refined** — dossier canonically attached to its workspace (workspace RBAC = SoR); the
  neutral space is a per-user **SUPER-VIEW** reading *through* per-workspace RBAC (non-owning
  aggregator, EVO-4b §7.5.1), never the owning store.
- **(b) Persistence ON by default + per-workspace opt-out + client-side encryption-at-rest + purge**,
  with team-view redaction as a **consciously re-exposed, client-side** extra (§6).
- **(c) C3** — batch create-or-bind, printed plan + one confirmation, name≠identity, fingerprint-first,
  **admin-gated bind** (§4).
- **(d) D1** — seeded public client @39-auth + PKCE + device-code fallback, **server/issuer-bound
  tokens** (§3).
- **Out of scope**: a hosted server-side signing surface — signatures stay client-side.

## 2. Facts (cited, unchanged)

- Sentropic: workspaces (`neutral|ai-priorities|opportunity|code`), memberships (viewer→admin),
  per-user **neutral** workspace, local-project→workspace map + `code`-workspace creation endpoint
  [FACT — `api/src/routes/api/{workspaces,neutral,vscode-extension}.ts`].
- h2a: durable git `ws:<sha256>` **fingerprint** [FACT — `identity/workspace-id.ts`]; 39-auth OIDC
  broker + per-user tenancy [FACT — `mcp-http/oauth/*`]; host-safe hook enrolment [FACT —
  `h2a-runtime/src/enroll.ts`]; conversation-alignment engine push/pull/**diverged** [FACT —
  `convsync.ts`]. CLI convos = host append-only JSONL (claude `~/.claude/projects/**`; codex
  `~/.codex/sessions/**/rollout-*.jsonl`) [FACT — but NOT strictly append-only: compaction/rotation
  happen, see §7]. 39-auth has **no DCR** [FACT]. `packages/secret-redaction` exists [FACT — effectiveness on raw JSONL **unmeasured**].

## 3. Enrollment & auth (D1) — separate capabilities + token hardening

- **Auth**: seeded public client @39-auth + `authorization_code`/**PKCE** (browser) + **device-code**
  fallback (headless); refresh token in `~/.sentropic/h2a-auth.json` (0600). Reuses `oidc-rp.ts`/
  `broker-login.ts`; device-code is the one new IdP leg.
- **Token hardening (must-fix-lite)**: tokens are **audience/scope-limited** and **bound to the target
  server/issuer** — h2a MUST NOT send a 39-auth token to an attacker-supplied `--server`; refresh
  supports **rotation + server-side revoke**; tokens are **namespaced per server**; the device-code
  flow carries a phishing-mitigation (short TTL + explicit server display).
- **Capability separation (must-fix #1/v1)**: `enroll` grants (i) **workspace bind** and,
  *independently*, (ii) **transcript upload** — distinct scoped gates. Bind never implies upload.

## 4. Workspace create / bind (C3) — binding semantics, **admin-gated**

- Identity = h2a **fingerprint**; existence/name/membership = **sentropic** (SoR rule).
- **Batch create-or-bind**, per h2a-enrolled workspace:
  - Lookup **scoped to caller-authorized workspaces only** — **no** global first-binding-wins.
  - Pre-existing sentropic workspace **never auto-adopted by name** → explicit `bind --to <wsId>`
    requiring **workspace admin** (not mere membership — binding enables future upload + publication
    into that workspace, an administrative act; a viewer MUST NOT bind).
  - Multiple visible bindings → **explicit selection** required.
  - **Printed plan** + **one confirmation** gates the batch; re-runs idempotent (fingerprint-first).
  - **Binding-table uniqueness is transactional**; a rebind does **not** silently redirect in-flight
    uploads.
- **Upload routing** = the **(workspace, fingerprint) PAIR**; after bind, uploads route by the
  **opaque `sentropicWorkspaceId`** (not the clone-derivable fingerprint — metadata-leak reduction, §9).

## 5. Dossier publication (A3-refined) + attestation re-binding

- Dossier published **canonically into its workspace** (workspace RBAC owns it); the **neutral
  super-view** lists/opens it **by reference**, dereferencing **through** the workspace's RBAC. The
  super-view is an **index-only reader** — it computes **no** posture/COI/confiance (EVO-4/4b §7.2);
  the **signed payload is the sole authority**, server metadata is index-only.
- **Attestation re-binding (must-fix #6 — EVO-4b §7.4.1).** Enrollment creates an id **duality**
  (local `ws:<sha256>` fingerprint AND `sentropicWorkspaceId`). A `decision-attestation`'s signed
  payload MUST bind **both** ids **+ the binding-record id/version**; the sentropic destination
  **re-verifies `sentropicWorkspaceId` from the SIGNED payload**, never by resolving the **mutable
  binding table** — so a compromised/buggy binding table cannot re-target a signed decision from
  workspace A into B without breaking signature verification (confused-deputy closed).
- decider ≠ relay; server **relays/stores** the already-signed attestation, **never mints** it.
- **Hostile-content sanitization (EVO-4b §7.5.2)**: transcripts + dossier text are hostile
  (markdown/HTML/ANSI) → **sanitized before render** in the super-view and any team-view.

## 6. Conversation persistence (b) — content-honeypot neutralized, scoped honestly

- **Default ON, per-workspace OPT-OUT**, and a **one-time pre-first-upload disclosure + confirmation**
  (must-fix #2): before the *first* transcript ever leaves the machine, h2a shows what will be
  uploaded (encrypted), the default-ON + per-workspace off-switch, and — for a **team** workspace —
  that the ciphertext lands under the workspace's retention (possibly another admin's). The
  irreversible gate gets its own consent, not just the reversible bind confirmation.
- **Client-side encryption-at-rest.** Transcript bytes are **encrypted on the client** with an
  owner-held key before upload; **sentropic stores ciphertext** and is **content-blind**. Recovery
  decrypts client-side → **byte-faithful blob restored**.
- **Key custody design constraint (must-fix-lite, stated now; mechanism in §10).** {content-blind,
  no-escrow, survives-disk-loss} cannot all hold if the key lives only on the dead disk. So the key
  is a **human-held passphrase / recovery-code** (or an explicit opt-in escrow): **no key ⇒ no
  recovery** is a stated contract, not a surprise.
- **Team-view redaction is a CONSCIOUS re-exposure, client-side (must-fix #1 — the blocking issue).**
  “Server blind” is scoped to **content on the uploader-only path**. A workspace may opt in to a
  **team-shared view**; that view is produced by **client-side** redaction of a copy, encrypted to a
  **separate team/workspace key** and stored as a **distinct artifact** — explicitly acknowledged as
  re-introducing whatever redaction misses (effectiveness **unmeasured** → gated behind opt-in +
  pilot, §10). It is **not** additive safety; it is a scoped confidentiality downgrade the owner opts
  into. The server never sees raw plaintext or the owner key on either path.
- **Visibility default = uploader-only.** Teammates read only via the team-view opt-in above.
- **Admin powers, precisely (gpt-5.5 #1 / must-fix).** A workspace admin may **manage/retain/purge/
  export the CIPHERTEXT and the redacted team-projection**, and set team-view policy — but **cannot
  decrypt** an uploader's raw bytes without shared key material. **User-leaves**: their ciphertext
  follows the workspace retention/purge policy; it remains unreadable without the owner key.
- **Purge is transitive**: a purge removes ciphertext **+ redacted projections + queues/caches/
  backups/log-derived artifacts**, not just the primary object.
- **Backup is falsifiable (must-fix-lite).** Default-ON creates a “you’re backed up” belief; a silent
  hook failure is the dossier’s own premortem. `h2a sessions status` MUST surface **last
  server-verified head + unsynced byte count** per session, so “backed up” is checkable.

## 7. Transcript integrity / sync (encrypt-then-chain, generations)

Built on `convsync.ts` (push/pull/**diverged**):

- **Encrypt-then-chain (must-fix #3).** The chain is over **CIPHERTEXT**: each chunk carries a
  **ciphertext** content-hash + the **previous ciphertext-head hash**; the server verifies the
  previous-head over ciphertext and appends **atomically** (mismatch rejected). The **plaintext**
  integrity hash lives **inside the encrypted payload**, verified **client-side on resume** — so the
  server is **not** a plaintext presence-oracle.
- **Per-chunk authorization (must-fix-lite).** Every chunk is server-bound to `{userId,
  sentropicWorkspaceId, convId}` and **authorized against membership on each push** — a member cannot
  inject chunks cross-workspace or under someone else’s fingerprint (chunk-substitution closed).
- **Generation snapshots (must-fix #5).** Host JSONL is **not** strictly append-only
  (compaction/truncation/rotation/schema change). A rewrite is detected via a **per-generation
  file-hash/snapshot** and **forks a new generation** — it does **not** dead-lock the chain (the v2
  “reject mismatch” would have hard-stopped on routine host compaction). “No silent data loss” holds
  because a rewrite is a new generation, not a lost head.
- **Multi-machine fork.** Two machines on one logical session → **diverged** → explicit fork; on
  divergence the owner is shown **both branches** (never an auto-pick of “longest”, which can prefer
  a stale branch on a detector false-negative).
- **Resume is scoped honestly (must-fix #4).** Recovery yields a **byte-faithful blob**; a
  **host-CONTINUABLE resume is per-host UNPROVEN** — Claude `encodeCwd` is non-injective; Codex
  line-1 cwd + rollout-name + provider-UUID↔filename mapping is fragile (“Codex support especially
  weak”). Host-continuable resume is **gated behind separate Claude vs Codex verification matrices**
  (§10), not asserted here.

## 8. Invariants preserved (EVO-4 / EVO-4b)

Three-layer; **decider ≠ relay**; **client-side signature never server-minted**; neutral super-view
= non-owning **index-only** reader (computes no posture/COI); **signed payload is the sole authority,
server metadata is index-only**. **New**: sentropic never holds owner **plaintext** (content-blind)
nor owner **keys** (signing OR encryption) — only ciphertext + relayed signed attestations.

## 9. Hazards → guards (server-store / aggregation deltas)

| Hazard | Guard |
|---|---|
| Content honeypot | client-side encryption-at-rest; server content-blind (§6, uploader-only path) |
| **Team-view re-exposure** | client-side redaction, separate team-key store, **acknowledged downgrade**, opt-in + pilot (§6) |
| Consent creep / silent exfil | separate upload gate + **pre-first-upload disclosure** + opt-out + uploader-only (§3/§6) |
| **Metadata honeypot** | *acknowledged, not eliminated*: server still sees conv ids, chunk timing (hours/idle), sizes/line-counts, and the membership graph; the derivable fingerprint is replaced by the **opaque `sentropicWorkspaceId`** for routing (§4) to reduce who-shares-which-repo leakage |
| Presence oracle | chain over **ciphertext**; plaintext hash inside the encrypted payload (§7) |
| Binding spoof / duplicate / confused-deputy | pair-routing + name≠identity + **admin-gated** bind + transactional uniqueness (§4); attestation binds **both ids + record version**, destination verifies from signature (§5) |
| Chunk substitution / cross-workspace inject | per-chunk `{userId,wsId,convId}` + membership auth (§7) |
| Host rewrite dead-lock / silent loss | per-generation snapshots; rewrite → new generation (§7) |
| Illusory recovery | human-held key contract (no key ⇒ no recovery); `h2a sessions status` makes backup falsifiable (§6) |
| Token misuse | audience/scope-limited + issuer/server-bound + rotation/revoke (§3) |
| Stored-XSS on render | sanitize hostile transcript/dossier text before render (§5) |

## 10. Open questions (deferred to PLAN — mechanisms behind now-normative properties)

- **Key custody / rotation** mechanism (passphrase vs recovery-code vs opt-in escrow) — the *property*
  (human-held, no-key⇒no-recovery) is fixed in §6; the mechanism is plan-time. **Includes the TEAM
  key** (§6 team-view store): who holds/rotates it, and what happens to the team-readable copy when a
  member leaves (the owner-ciphertext leave-behavior is fixed in §6; the team-key copy is not).
- **Host-continuable resume** — per-host (Claude vs Codex) **verification matrices** proving a restored
  blob yields a session the host CLI actually continues; Codex weakest. (Now explicitly open.)
- **Generation retention/selection** — which generation a resume defaults to, and whether stale
  generations (§7 forks) are retained or purged (interacts with transitive purge §6 + volume below).
- **Per-workspace first-upload consent firing** — the §6 pre-first-upload disclosure MUST fire on each
  *workspace's* first upload (not once globally), so a later-bound team workspace never inherits a
  consent the owner never saw for that workspace.
- **Redaction effectiveness** on real CLI JSONL (unmeasured) — pilot before enabling any team-view.
- **Device-code IdP leg** at 39-auth (new upstream; D3 PAT is a conscious demo-only stopgap).
- **Team-multi-user load** + transcript volume at scale.
- Hosted signing surface stays **out**.

---

**Next:** final double-consensus confirmation on v3; on GO, promote to `docs/specs/` with the decision
dossier. Design-only until then.
