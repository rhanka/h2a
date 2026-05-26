# Evolution intentions register

> **Captured intentions, not yet specified.** Flow: *intention → framing consultation → spec session → backlog → build*. This file is the first step (capture). Each entry lists what, why/source, open framing points, and whether a dedicated spec session is needed. Nothing here is decided or scheduled yet.

| ID | Intention | Spec session? | Status |
|---|---|---|---|
| EVO-0 | `agy` host parity | yes (with EVO-1) | intention |
| EVO-1 | Plugin bilateral-discussion & relance capability (per platform) | yes | intention |
| EVO-2 | Drumbeat = engagement **tracking** (reframe) | yes | intention (supersedes DEC-083 framing) |
| EVO-3 | Agent-blockage **feedback loop** (cross-agent notification) | yes | intention |
| EVO-4 | Decision support / situation presentation | yes (largest) | intention |
| EVO-5 | NHI (Non-Human Identity) — NIST standard support | yes | intention → backlog |

---

## EVO-0 — `agy` host parity

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

**Open framing**: identify the applicable NIST publication (or equivalent industry guidance) for NHI/machine identities; map it to h2a's identity model (instances, ed25519 keys, keyring/rotation DEC-078/079, mandates). **To verify**: which NIST doc applies (research needed).

---

## Next (not done here)

1. **Plan the spec sessions** — group these intentions into dedicated framing/spec sessions (proposed grouping to be confirmed by the user).
2. **Inscribe to a backlog** once each is framed.
