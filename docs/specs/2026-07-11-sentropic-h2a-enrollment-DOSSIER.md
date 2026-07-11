# DECISION DOSSIER — h2a enrollment onto sentropic (owner: Fabien)

**Method:** present-decision, full-dossier path (hard triggers: auth/security/privacy;
migration/data-retention; cross-repo/cross-owner (a2a-cli + sentropic); frozen-contract-shaping
(new server API); high blast radius — a server holding all CLI conversations).
**Companion spec:** `sentropic-enroll-spec.md` (same directory, **v2**). Four genuine forks are
presented: **(a)** dossier publication locus, **(b)** conversation persistence scope/privacy,
**(c)** initial sync & source of truth, **(d)** enrollment auth model.
**Consensus state:** adversarial pass #1 (gpt-5.5) returned **NO-GO on spec v1** with 7
must-fixes (`gpt55-enroll.out`); spec v2 closed them — notably: transcript persistence is now a
separate per-workspace consent gate with **uploader-only bytes normative** (narrowing fork (b)
to profile *defaults*), fingerprint binding is caller-scoped with no global first-binding-wins,
explicit bind now requires **admin**, publication baseline **A3 is locked in the spec**
(narrowing fork (a) to ratify-A3-or-drop-the-index), sync is generation-based with full-hash
chaining, and resume claims are downgraded to "bytes recovered; resume attempted per a
verification-matrix plan gate". Re-run of pass #1 on v2: see `gpt55-enroll-v2.out`. A second
independent pass (codex) was attempted and hit a usage limit — it remains to be run (§8).

---

## 1. Decision asked

Approve the design posture of "h2a enrolls onto sentropic" by choosing one option in each of
four forks: **(a)** where decision dossiers are published (A1 neutral-only / A2 per-workspace /
A3 per-workspace + neutral index — **spec v2 locks A3 as baseline and rejects A1; the live
choice is ratify A3 or fall back to A2**); **(b)** what CLI-conversation persistence is
(B1 default-on-full / B2 opt-in + redaction / B3 metadata-first — **spec v2 makes the
per-workspace gate + uploader-only bytes normative; the live choice is the `personal`-profile
DEFAULT of that gate + retention values**); **(c)** how local workspaces are created in
sentropic (C1 auto-create-all / C2 explicit-only / C3 auto-create + explicit adoption);
**(d)** how h2a authenticates (D1 seeded client + PKCE + device fallback / D2 DCR / D3 PAT).
Scope: design-only; no code, no endpoint freeze.

## 2. Context

**Facts.**
- Sentropic already has workspaces (`type ∈ neutral|ai-priorities|opportunity|code`),
  memberships (viewer→admin), a per-user **neutral** orchestrator workspace, and a
  local-project→workspace mapping + `code`-workspace **creation** endpoint (vscode extension)
  [FACT — `~/src/sentropic/api/src/routes/api/{workspaces,neutral,vscode-extension}.ts`].
- h2a has a durable git-derived `ws:<sha256>` workspace id (path/machine independent)
  [FACT — `packages/h2a/src/runtime/identity/workspace-id.ts`], a proven 39-auth OIDC
  broker pattern with per-user tenancy (`rootForSub`) [FACT — `packages/h2a/src/runtime/
  mcp-http/oauth/*`], hook-based session enrolment that never breaks the host [FACT —
  `packages/h2a-runtime/src/enroll.ts`], and a conversation-alignment engine with
  push/pull/diverged verdicts [FACT — `packages/h2a-runtime/src/convsync.ts`].
- CLI conversations live as host-native append-only JSONL (claude:
  `~/.claude/projects/**.jsonl`; codex: `~/.codex/sessions/**/rollout-*.jsonl`) [FACT].
- 39-auth has **no DCR**; its real clients are seeded operator-side [FACT — `oidc-rp.ts`].
- `packages/secret-redaction` exists in sentropic [FACT — directory listing]; its
  effectiveness on CLI transcripts is **unmeasured** [FACT about absence of evidence].

**Assumptions.** Sentropic API and 39-auth remain the target server/IdP (memory: h2a-mcp
gateway direction). Single sentropic server per user for now.

**Unknowns.** Team-multi-user load on one workspace; transcript volume at scale; whether the
hosted signing surface (spec Q-7) arrives soon after.

## 3. Stakes

- **Privacy/security:** CLI transcripts embed secrets, file contents, third-party data; a
  server-side store is a honeypot (spec H1) and reshapes who can read your terminal history
  (H2). Irreversible in the "data once uploaded" sense.
- **Cross-repo/owner:** touches a2a-cli (CLI, runtime) and sentropic (API, DB, IdP).
- **Contract-shaping:** the binding + conversation-store API will freeze into a public
  contract; the EVO-4 signature invariants must survive server-side publication.
- **Cost/blast radius:** wrong default on (b) or (c) erodes user trust in h2a itself.

## 4. Options

### (a) Dossier publication locus

| id | choice | strongest FOR | strongest AGAINST | cost | reversibility | what would make it win |
|---|---|---|---|---|---|---|
| A1 | Neutral space only — **rejected by spec v2 §5.2 for workspace-governing decisions** (it makes the aggregator the canonical owner — the exact confusion EVO-4b §7.5.1 prevents; pass-1 reviewer concurred); kept here as the considered-and-rejected row | Mirrors EVO-4b cockpit: ONE aggregation point for a ~50-repo human [FACT: neutral ws exists per user]; simplest RBAC (own data only) | Aggregator becomes owner of records governing work it does not own; decision record severed from the governed workspace; blocks team review | low | high (copy later) | Only as the personal-scope exception (single-member workspaces), which spec v2 already grants |
| A2 | Per-workspace only | The decision record lives WITH the governed work, under the workspace's RBAC — the natural system-of-record; matches how track decisions are per-repo today [FACT] | The human loses the single pane; re-creates the exact fragmentation EVO-4b §7 was written to kill ("ad-hoc-per-decision pages fragment attention") [FACT: EVO-4b gap statement] | low | high | If the local cockpit remains the only aggregation the owner ever wants |
| A3 | Canonical per-workspace + neutral **index** (references, not copies) | Both properties: record-with-the-work + one aggregation pane; single copy → no divergence; neutral stays a non-owning aggregator, satisfying EVO-4b "aggregator ≠ beneficiary" [FACT: §7.5.1]; dereference passes through workspace RBAC → closes the H4 leak | Most moving parts (index consistency, dangling refs after unenroll/purge); the neutral view must handle "you can see the entry exists but not read it" UX honestly | medium | medium (drop the index) | Default winner unless index complexity is judged not worth it now |

### (b) Conversation persistence scope + retention + privacy

| id | choice | strongest FOR | strongest AGAINST | cost | reversibility | what would make it win |
|---|---|---|---|---|---|---|
| B1 | Default-on full persistence for every enrolled workspace (owner's stated starting intent) | Matches the stated feature ("the entirety of the CLI conversations… persisted"); recovery works with zero ceremony; simplest mental model — enrolled ⇒ backed up | Uploads secrets/third-party data by default; one consent (enroll) silently implies a second (transcript exfiltration) — spec H1/H2; a single default-on mistake is **not recoverable** (data already left) | low build / high risk | **LOW — uploaded data cannot be un-disclosed** | If the server is self-hosted by the same person whose data it holds (current reality: Fabien's own infra) |
| B2 | Per-workspace opt-in flag at enroll time (`--with-conversations`), + redaction pass, + retention window + purge | Consent is explicit and scoped where the sensitivity actually is; redaction capability already exists to wire [FACT: `packages/secret-redaction`]; purge/retention stated as first-class; H1/H2 damage bounded | More ceremony; partial backups → recovery gaps users discover too late ("I thought it was backed up"); redaction on raw JSONL may break byte-faithful resume if applied at rest (must redact a *copy* or accept resume loss — real tension, not solved here) | medium | high | Default winner if any second user/tenant is plausible in the next year |
| B3 | Metadata-first (convsync stats: id/bytes/lines/sha) with on-demand full push | Near-zero privacy surface; still enables alignment/liveness dashboards; full push stays available when the user asks | Does not deliver the owner's stated feature — no recovery without a prior manual push; "on-demand backup" is the backup you don't have when the disk dies | low | high | If (b) is judged premature and the owner wants a probe first |

**Visibility (no longer a sub-choice):** spec v2 §6.4 makes **uploader-only transcript
bytes normative** (members get at most metadata / a redacted projection by explicit opt-in;
admins can purge, never read) — pass-1 review required this closed at design time [FACT:
`gpt55-enroll.out` must-fix #1]. Fork (b) therefore decides only the `personal`-profile
default of gate 3 and the retention values.

### (c) Initial sync direction & source of truth

| id | choice | strongest FOR | strongest AGAINST | cost | reversibility | what would make it win |
|---|---|---|---|---|---|---|
| C1 | Auto-create in sentropic for ALL h2a-enrolled workspaces (batch, no per-item consent) | The owner's stated start ("every project workspace enrolled in h2a should be created in sentropic"); zero-friction union view; idempotent by fingerprint [FACT: fingerprint is durable] | Mass-creates workspaces from whatever the allowlist holds (~50 repos → ~50 server workspaces incl. throwaways); noisy tenancy; silent creation is the anti-pattern the allowlist posture exists to prevent [FACT: EVO-4b §7.6 consent posture] | low | medium (mass-hide/delete server-side) | If the allowlist is already curated tightly enough to BE the intended server set |
| C2 | Explicit per-workspace enroll only (no batch) | Maximal consent; each binding is a deliberate act; no junk workspaces | Grinds against the stated intent; 50 repos × manual enrolls = the feature quietly unused | low | high | If early usage shows only 2–3 workspaces matter |
| C3 | Batch create-or-bind **with printed plan + one confirmation**; pre-existing server workspace is NEVER auto-adopted by name — explicit `bind --to` requiring **admin** on the target (spec v2 §4.2); caller-scoped fingerprint lookup prevents duplicates without any global first-binding-wins (spec B-1..B-6) | Delivers C1's outcome with one consent gate; name≠identity + scoped-lookup rules close the spoof/duplicate/capture hazards (spec H3, §4); re-runs idempotent | Still one bulk action to audit; the confirmation is a speed bump vs C1; adoption ceremony for pre-existing workspaces adds a step teams will feel | low-medium | medium-high | Default winner; loses only if the owner explicitly wants zero prompts |

**Source-of-truth rule (all options):** after binding — existence/name/membership = sentropic;
identity (fingerprint) = local git; content flows per-artifact (spec §2.2) [JUDGMENT, but
anchored in the reflect-host-native standing rule].

### (d) Enrollment auth model

| id | choice | strongest FOR | strongest AGAINST | cost | reversibility | what would make it win |
|---|---|---|---|---|---|---|
| D1 | Seeded public client at 39-auth + authorization_code/PKCE (browser) + device-code-style fallback for headless; refresh tokens in `~/.sentropic/h2a-auth.json` (0600) | Reuses the exact upstream leg already built and tested [FACT: `oidc-rp.ts`, `broker-login.ts`]; matches 39-auth reality (no DCR) [FACT]; codex precedent proves the fixed-public-client CLI pattern works at scale [FACT: `llm-mesh.ts`] | Device-code flow does not exist at 39-auth yet — that leg is new IdP work; a shared public client_id can't distinguish h2a builds (fine now, weak for revocation granularity later) | medium (device-code at IdP) | high | Default winner: shortest path on proven parts |
| D2 | DCR at 39-auth (each h2a instance registers itself) | Per-instance client identity → fine-grained revocation; the "DCR + 39-auth login + per-user root" phrase in the gateway direction memory | 39-auth has **no DCR** [FACT] — this builds a new IdP feature before the first enrollment can happen; DCR for public native clients adds little real security over PKCE | high | medium | If per-instance revocation becomes a governance requirement (h2a governance vision) |
| D3 | Server-minted PAT (user copies a token from the sentropic UI) | Trivial to ship; no IdP work at all | Long-lived bearer secret in a file, no refresh/rotation story, phishing-friendly copy-paste; regresses below the credential posture h2a already achieved [JUDGMENT anchored on existing OAuth files] | very low | high | Only as a stopgap if D1's device-code leg blocks a demo |

## 5. Recommendation + rationale

Per-fork, honestly held, **not sold** — dissent attached in §5b:

- **(a) → A3** (canonical per-workspace + neutral index). Decisive judgment: it is the only
  option satisfying both the EVO-4b aggregation gap AND record-with-the-work, and the
  reference-not-copy shape is what keeps the neutral space a non-owning aggregator (§7.5.1
  compliance) and closes H4.
- **(b) → B2-with-personal-profile-default-ON**: the gate and uploader-only bytes are fixed
  (spec v2 §6.0/§6.4, required by pass-1 review); recommend defaulting gate 3 **ON under the
  `personal` profile** (honors the owner's literal "entirety… persisted" intent on own infra)
  and **OFF under `team`**. Decisive judgment: uploaded transcripts are the one irreversible
  artifact in this design; the profile split gives the stated feature where the blast radius
  is the owner's own server, and consent-first where other tenants exist.
- **(c) → C3** (batch create-or-bind, printed plan, one confirmation; explicit adoption for
  pre-existing). Decisive judgment: delivers the stated "create them all" outcome while
  keeping name≠identity and one consent gate.
- **(d) → D1** (seeded client + PKCE + device fallback). Decisive judgment: every component
  except the device-code leg already exists in-tree; D2 requires building IdP DCR first,
  D3 regresses credential posture.

**§5b Dissent / what the recommendations cost you.**
- Against A3: two reviewers of EVO-4b flagged aggregation complexity as the recurring source
  of tenancy bugs; A2 is the safest privacy shape and A3 buys convenience with index-machinery.
- Against B2: it *is* friction, and it *does* soften the owner's stated feature; a user who
  forgot to opt in has no recovery when their disk dies — that failure will be blamed on h2a.
- Against C3: the confirmation prompt is exactly the kind of ceremony the owner has pushed
  back on before (memory: no complicated approval commands) — C1 is a legitimate read of
  intent on personal infra.
- Against D1: it commits 39-auth to a device-code feature; if that stalls, enrollment stalls
  (D3 exists as a conscious stopgap).

## 6. Reversibility / cost

- (a): all options cheap to build; A1↔A3 migration is additive (add/drop the index). A2→A3
  later is easy; A3→A2 leaves dangling neutral refs to clean.
- (b): **the only genuinely irreversible axis** — data uploaded under B1 cannot be un-shared;
  moving B2→B1 later is a flag default change, B1→B2 later does not claw back history.
  Purge tooling (stated requirement) mitigates but does not undo disclosure.
- (c): server workspaces mass-created under C1 can be hidden/deleted (`hiddenAt` exists
  [FACT: schema]), cost is cleanup noise, not data loss. Bindings are droppable.
- (d): auth models are swappable behind the same token file; D3→D1 is a re-login. IdP work
  (device-code, DCR) is sunk cost if later replaced.
- Rough build order-of-magnitude (JUDGMENT): D1 device-code leg ≈ small IdP feature;
  binding + create-or-bind ≈ small API feature (vscode endpoint as template); conversation
  store + sync ≈ the largest piece (new store + chunk protocol + resume path); dossier
  publish ≈ small once (a) is chosen.

## 7. Attendus (owner validation criteria)

| criterion | source | covered by | gap |
|---|---|---|---|
| Local workspaces enrollable into sentropic; union view | owner statement 2026-07-11 | spec §2, §4 | — |
| Every h2a-enrolled workspace created in sentropic "to start" | owner statement | spec §4 (C1/C3) | consent gate is a deviation question → fork (c) |
| Dossiers publishable to neutral OR per-workspace | owner statement | spec §5 + fork (a) | owner must pick |
| Entire CLI conversations persisted + resume/recovery | owner statement | spec §6 | scope/privacy default → fork (b); redaction-vs-byte-faithful-resume tension open |
| EVO-4 invariants survive (3-layer, decider≠relay, no server-side minting) | EVO-4/4b spec [FACT] | spec §5.1, I-1/I-2/I-8 | hosted signing surface deferred (Q-7) |
| Reuse existing enrollment/auth patterns, don't reinvent | task brief + repo reality | spec §3 (oidc-rp/broker/tenancy/llm-mesh cites) | device-code leg is new |
| No co-authoring trailers; docs in English | standing memory | this dossier + spec | — |
| Privacy/tenancy hazards surfaced honestly | present-decision method | spec §9 H1–H7, this §4(b) | residual honeypot risk cannot be engineered away |

## 8. What I need from you

Four picks (one per fork) — smallest valid decision:

1. **(a)** ratify **A3?** (spec baseline) / fall back to A2 (no neutral index). A1 rejected
   by design except the personal-scope exception.
2. **(b)** the transcript **gate + uploader-only bytes are fixed by spec v2**; choose the
   `personal`-profile default (gate ON at enroll? — closest to your stated "entirety
   persisted" intent) vs default OFF everywhere (**B2-strict?**), and the retention default.
3. **(c)** C1 / C2 / **C3?**
4. **(d)** **D1?** / D2 / D3.

Plus one confirmation: the hosted signing surface (spec §5.1) stays OUT of this feature —
any future sentropic-served signing page is a separate EVO-4b-class security design.

**Presenter self-audit (present-decision gate).** Agent-interest disclosure: B2/C3/D1 are also
the options that are *easiest to defend for the presenter* (they minimize the risk the agent is
later blamed for a leak or a mass-create); B1/C1 are the owner's literal words — flagged so the
convenience-vs-intent tension is visible, not buried. Pre-mortem: *six months later this failed
because default-off conversation sync (B2) meant nobody had backups when a laptop died, and the
neutral index (A3) showed dossier titles to users who couldn't open them, reading as a broken
app rather than RBAC.* What would overturn the recommendations: a decision that sentropic
stays strictly single-tenant personal infra (→ B1/C1 become clearly right); a hard requirement
for per-instance revocation (→ D2); abandonment of the local cockpit (→ A1).
**Double-instruction status:** gpt-5.5 adversarial pass completed twice on the companion spec
(v1: NO-GO, 7 must-fixes, `gpt55-enroll.out`; v2 re-run: `gpt55-enroll-v2.out`). An independent
second-model pass (codex) was attempted 2026-07-11 and failed on a provider usage limit
(`codex-enroll.err`); per the standing double-instruction rule this dossier is **Incomplete
until a second independent pass runs** — that pass must be executed by the orchestrating
Claude peer or by codex once the limit resets. No second opinion has been fabricated.

---

## DECISIONS TAKEN (Fabien, 2026-07-11)

- **(a) A3-refined** — dossier canonically attached to its workspace; the neutral space is a per-user SUPER-VIEW giving access to everything (all dossiers, agents, conversations), reading through per-workspace RBAC.
- **(b) Persistence ON by default + per-workspace opt-out + client-side ENCRYPTION-AT-REST (server blind → byte-faithful recovery) + redaction only as a client-side extra for team-shared views + purge/retention.** Resolves the redaction↔resume tension by encrypting (not stripping) the owner's recovery copy.
- **(c) C3** — batch create-or-bind, printed plan + one confirmation, name≠identity, fingerprint-first, admin-gated bind.
- **(d) D1** — seeded public client @39-auth + PKCE + device-code fallback, server/issuer-bound tokens.
- Hosted (server-side) signing surface stays OUT.

**Consensus (v3):** independent double-consensus — gpt-5.5 GO + Opus GO. The v1 NO-GO (raw-transcript honeypot) and the 6 pre-promotion must-fixes from the second pass are closed in the companion spec v3; three plan-tier residuals folded into spec §10. Normative spec: `2026-07-11-sentropic-h2a-enrollment.md`.
