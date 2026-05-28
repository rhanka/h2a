# Evolution intentions register

> **Captured intentions, not yet specified.** Flow: *intention → framing consultation → spec session → backlog → build*. This file is the first step (capture). Each entry lists what, why/source, open framing points, and whether a dedicated spec session is needed. Nothing here is decided or scheduled yet.

| ID | Intention | Spec session? | Status |
|---|---|---|---|
| EVO-0 | `agy` host parity | Séance 1 done | **framed** — agy = Antigravity (Gemini), **supports MCP** (config `~/.gemini/config/mcp_config.json`, empty); full parity via that config + plugin import; no special gap |
| EVO-1 | Plugin bilateral-discussion & relance capability (per platform) | Séance 1 done | **framed** — feasible on all 4 (headless + resume/continue) |
| EVO-2 | Drumbeat = **external anti-stall relance loop** | Séance 2 done | **specified** (DEC-084 + `docs/drumbeat.md`); supersedes DEC-083; deadlines = layer 2 |
| EVO-3 | Agent-blockage **feedback loop** (cross-agent notification) | Séance 1 (partial) | framed — agy is the gap (no daemon); others have daemon/hooks |
| EVO-4 | Decision support / situation presentation | yes (largest) | intention |
| EVO-5 | NHI (Non-Human Identity) — NIST standard support | yes (research first) | intention → backlog |
| EVO-6 | Auto-connect at host startup (opt-in default + `/h2a disconnect`) | small (framed below) | intention |
| EVO-7 | Coach mode — assign roles + shape who-talks-to-whom across many instances, org committed to a repo | yes | intention |

> **Spec session 1 output**: [`docs/plugin-capability-matrix.md`](./plugin-capability-matrix.md) — factual CLI audit + capability matrix + per-intention implications.

---

## EVO-0 — `agy` host parity

**Status (DEC-093 + DEC-096, unreleased)**: 🟡 **MCP parity shipped** — `H2A_AGY_HOST` (`renderMcpConfig` → `~/.gemini/config/mcp_config.json`), accepted by `host setup`/`connect`/`host status` (4 hosts at parity); agy is a first-class stop-hook target (`host plugin`, poll-only, DEC-093). **Complete** (DEC-101): scenario test ✅ + `install-skills --host agy` ✅ (gemini-style TOML + `agy plugin import gemini` hint).

**Intention**: support **agy** as a first-class h2a host, on the **same functional perimeter** as the others.

**Status finding**: agy is **not** currently supported/implemented — h2a hosts are **claude / codex / gemini** (DEC-055). agy is installed as a CLI on this machine but has no host descriptor, skill install target, or MCP snippet.

**Why/source**: user — "pour agy, c'est à toi de me dire s'il est supporté/implémenté sinon clairement il faut le supporter sur le même périmètre fonctionnel." Confirmed: add agy.

**Open framing**: agy's CLI capabilities (does it support MCP servers? skills/commands? a scheduling/wake hook? background tasks?) — drives whether full parity is achievable.

## EVO-1 — Plugin bilateral-discussion & relance capability (per platform)

**Intention**: confirm/ensure each platform plugin (claude / codex / gemini / agy) has a **bilateral discussion mechanism** that can drive **relances / follow-ups** — i.e. an agent can hold a back-and-forth and be prompted again. This was the *real* original question behind the "drumbeat" ask.

**Why/source**: user — "savoir si chacun des plugins [a] des mécanismes de discussion bilatéral permettant de gérer des relances."

**Open framing**: build a **capability matrix** per platform: bilateral message exchange, ability to be re-prompted/woken, background-task support, MCP support, Q&A interaction. This audit gates EVO-2/EVO-3/EVO-4.

## EVO-2 — Drumbeat = engagement tracking (reframe)

**Intention**: the **drumbeat** is a function to **follow / track an engagement** over time — *not* ad-hoc requests, *not* agent-blockage handling (those are separate concerns; see below). Reframe of the earlier timed-escalation framing.

**Why/source**: user — "le drumbeat est plutôt une fonction pour suivre un engagement"; "j'ai confondu les demandes ad hoc et le drumbeat."

**Correction**: this **supersedes the framing in DEC-083 / `docs/drumbeat.md`**, which conflated drumbeat with ad-hoc demands and agent-blockage. To be revised during its spec session: keep the engagement-tracking core, drop ad-hoc (separate) and agent-blockage (→ EVO-3).

**Open framing**: what "tracking an engagement" means concretely (progress checkpoints? deadline follow-up? status digest?) — to be framed, not assumed.

## EVO-3 — Agent-blockage feedback loop

**Intention**: when an agent is **blocked**, the plugin should **notify the other agents** (via a **background task** or other mechanism) — and we need to know whether **all platforms are compatible** with such notification. This is a **feedback loop**, distinct from the drumbeat.

**Why/source**: user — "pour les blocages des agents, c'est plutôt à traiter en feedback loop"; "qu'un blocage permettra via le plugin d'être notifié (en bg task ou autre) aux différents agents et si tous sont compatibles." Note: *emergency escalation* itself was already addressed (escalation channels, DEC-040); this intention is the **plugin-level cross-agent notification** of a blockage.

**Open framing**: notification transport (bg task vs MCP push vs inbox); per-platform compatibility (depends on EVO-1 matrix); relation to the existing escalation channels.

**Status (DEC-092, 0.11.0)**: ✅ **Phase A shipped** — `h2a blockage raise|list|resolve` + `h2a_blockage_*` MCP tools; durable registry `<root>/.h2a/blockage/`; new topics `peer.blocked`/`peer.unblocked` pushed by the MCP dispatcher to subscribed peers in scope (connected peers on all 4 hosts). ✅ **Phase B adapter layer shipped** — `BlockageNotifier` (`loggingNotifier`/`commandNotifier`/`pollingNotifier`/`chainNotifier`), the agy case = polling fallback. **Remaining**: wire the per-host wake command into each plugin (D6). Design spec: `docs/superpowers/specs/2026-05-27-evo3-blockage-feedback-loop-design.md`.

## EVO-4 — Decision support / situation presentation

**Intention**: when a solicitation notifies that **an action/decision is needed** (by `PRINCIPAL` or `EXECUTIF`), a **situation-presentation / decision-aid tool** must be available. Delivery modes envisaged (one or several):

1. **Native Q&A** of each tool, where it exists.
2. **Plugin-provided Q&A** — the plugin manages the question/answer interaction for a host that lacks it natively (e.g. *"le plugin gérera pour codex les interactions question/réponse"* — feasibility TBD).
3. **Ad-hoc generated web page** for answering questions, with **feedback via the MCP server acting as an API**, and notification of the informed agent.
4. **Attentive spec-review aid** — per-paragraph validation, even interactive modification, e.g. based on **Tiptap markdown**, respecting the **Sentropic design system** published as a lib.

**Why/source**: user — full description of the "decision dossier" need across the four modes above.

**Open framing** (largest item): the MCP-server-as-API surface for web feedback; the doc-review tool (Tiptap + Sentropic design system) scope; per-platform native Q&A inventory (ties to EVO-1); how a decision request is modeled in h2a (an envelope `kind: decision-request`?).

## EVO-5 — NHI (Non-Human Identity) — NIST standard support

**Intention**: support the relevant **NIST standard for Non-Human Identity (NHI)** management — if a NIST NHI standard/guidance has been published — or an equivalent. Add to backlog.

**Why/source**: user — "relativement à la gestion des identités NHI, il faudra mettre dans le backlog le support de la norme NIST associée, si elle est déjà sortie ou quelque chose d'équivalent."

**Researched (2026-05-27)**: no dedicated NIST NHI standard exists — **NIST SP 800-207** flags NPE/NHI as an open ZTA gap, **NIST CSF 2.0** (govern) is the framing; the concrete de-facto standard is the **OWASP Non-Human Identities Top 10 (2025)** (+ CSA). h2a already covers several risks (NHI4 auth, NHI5 least-privilege, NHI7 rotation, NHI1 offboarding). **Evaluation written**: [`evaluations/nhi.md`](../evaluations/nhi.md) (pending triple-review, BACKLOG #9). Status: **researched + evaluation drafted**; build of any new control work TBD from the eval's gaps (secrets/SCA out of scope; discovery/inventory partial).

---

## Next (not done here)

1. **Plan the spec sessions** — group these intentions into dedicated framing/spec sessions (proposed grouping to be confirmed by the user).
2. **Inscribe to a backlog** once each is framed.

## EVO-6 — Auto-connect at host startup (opt-in default)

**Intention**: a session should **open automatically when the host CLI starts**, so the agent is on the bus without typing `/h2a connect`. Not mandatory, but **configured by default for the user** and **recommended-by-default in the install docs**, with an explicit **`/h2a disconnect`** escape.

**Why/source**: user — "une option pour que le connect se fasse par défaut au démarrage (pas obligatoire, mais configurée pour moi, et préconisée dans la doc d'install par défaut — avec bien sûr une option `/h2a disconnect`)."

**Framing + preco**: two mechanisms —
1. **`mcp-serve --auto-open` (preco)** — the MCP server, already launched by the host at startup (now configured for claude/codex), opens the presence session itself on boot (instance derived from `--host` + cwd-leaf, or explicit `--instance`). Robust (no LLM compliance needed), and the session already auto-closes when `mcp-serve` exits (DEC-051). The installer bakes `--auto-open --host <h>` into the MCP args, so it is "configured for you"; `/h2a disconnect` calls `h2a_session_close` for the rest of the process (re-opens next launch). Install docs recommend it by default.
2. *(alt)* a **SessionStart hook** that injects a "you are h2a-connected" instruction — LLM-dependent, less reliable; rejected as the primary.

**Open framing**: instance-id derivation at server boot (host flag + cwd-leaf); should `/h2a disconnect` persist across restarts (preco: no — ephemeral, re-opens next launch); per-host: claude/codex/gemini bake the flag via the MCP add; agy via its MCP config slot.

## EVO-7 — Coach mode (role assignment + communication topology across many instances)

**Intention**: with **many instances** (e.g. 30 claude), **not all need to talk**; some must talk to all. A **coach** — a `CONDUCTOR` or a **transversal** advisor — helps **assign roles** and **shape the communication mode** (who discovers/messages whom). The **personal organization is committed to a repo** so it is durable and shareable. The `model` skill already proposes a tailored h2a mapping; coach is the **concrete operational** counterpart that drives it against live instances.

**Why/source**: user — "un mode coach. genre j'ai 30 instances claude, toutes n'ont pas besoin de se parler, certaines doivent parler à toutes ; le coach (un conductor ou un transversal) aide à attribuer les rôles et favoriser le mode de communication. on pourrait commiter l'organisation personnelle dans un repo. `model` sert un peu à ça mais là ce serait plus en appui concret."

**Framing + preco**: this maps cleanly onto existing primitives —
- **Who-talks-to-whom = `SCOPE` membership** (presence/`discover` is already scope-filtered, DEC-051). The topology is "which instances share which scope". → no new transport needed; the coach provisions scopes.
- **Roles** = the frozen set (`PRINCIPAL`/`CONDUCTOR`/`AGENTS`/`CONTROL`/`MANDATAIRE`). The coach assigns them per instance per scope via `MANDATE`s.
- **Committed org (preco)**: an **org manifest** in a repo — `org.h2a.yaml` (or `h2a org` verbs) declaring `instances → roles → scopes → comm-edges`. Durable, reviewable, diffable.
- **Coach (preco)**: a `/h2a coach` skill (operational) that reads the committed manifest **+ live presence** and (a) assigns roles/mandates, (b) provisions scopes so only the intended instances discover each other, (c) advises/sets the comm mode (broadcast scope vs targeted), (d) flags drift (a live instance not in the manifest, or an unfilled role). The coach **role** is a `CONDUCTOR` by default (orchestrates) and can hold a **transversal `CONTROL`-like** cross-scope read for advice. `model` = the *design proposal*; `coach` = *operating it*.

**Open framing** (spec session): the org-manifest schema; `h2a org`/`h2a coach` CLI+MCP surface; how scope-membership gates `discover`/`inbox` (enforce vs advise); whether the coach can *act* (write mandates/scopes) or only *recommend*; relation to `model` (coach consumes a model output); multi-PRINCIPAL ownership of the org file.
