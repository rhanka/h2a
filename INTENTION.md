# Intention — layer 1 of the contractual stack (DEC-010)

> **Layer**: INTENTION (the **why**). Narrative, value-driven, owned by PRINCIPAL.
> **Source**: initial user message from 2026-05-16, preserved verbatim below.
> **Downstream**: measurable requirements in `SPEC.md`; design decisions in `DECISIONS.md`.

## User verbatim (preserved so nothing is lost)

> *(Translation of the original French verbatim. The original message was preserved as-is until 2026-05-23, at which point the project policy "all docs in English" — see `README.md` — was applied retroactively. The French source is recoverable from git history at commit `195d1c2~1`.)*
>
> I want to design a protocol that allows for a conductor of CLI agents + a flexible collab between CLIs. A bit like A2A but between CLIs. The idea would be to have a tool / plugin in each CLI (Claude, Codex, Gemini, others), so that agents can collaborate. The protocol must allow both remote collaboration (project `@sentropic/remote`) and local collaboration. The ideal is a CLI plugin + tool that can go either through a central MCP service or simply through files in each workspace (i.e. there is a reception point to receive requests and process them).
>
> The conductor role is essential: it will let the human pilot a herd of agents under the supervision/responsibility of a conductor. The terminology may not be the right one, because we could imagine roles that are largely transverse (cyber, etc.). We must ultimately plan for a mode that lets us replicate how an organization works. In this context, we must also think about the global management of coordination/consolidation of all the roles (which may be in a "non-central" mode) — simply one of the conductor roles (or another transverse-function terminology to be found) to enable coherent management. We must also enable human-in-the-loop: within a coherent organization, a human can take control of an agent or of one of the conductors.
>
> I am also looking for a name for this project (which will be a `@sentropic/{project}-modules` npm TypeScript project — not pnpm). At this stage I had `a2a-cli` as a working name.
>
> Record this initial intention, every requirement of which will need to be mapped to a spec, and start brainstorming mode to begin laying out the concept, its structure, its modules. At some point we can pick up the `@sentropic/harness` project from `../sentropic/` (I believe branch 25 or 23) — it might be more coherent to integrate it into this new project.

## Narrative rewrite (distillation)

Design an **organization and collaboration protocol between heterogeneous CLI agents** (Claude Code, Codex, Gemini, others) that lets a human (PRINCIPAL) pilot a herd of agents through a CONDUCTOR, with cross-cutting CONTROL functions (cyber, finance, ethics, legal, quality), and the ability for the human to take over an agent or a conductor at any moment.

The protocol must be able to run on three interchangeable transports (local-files, central MCP, remote `@sentropic/remote`), be implementable as a tool/plugin in each target CLI, and let one **replicate the way an organization works** — including in non-centralized coordination modes.

## Intention extension — multi-human (2026-05-17)

Every human must be able to operate as the PRINCIPAL of their own mini-organization: their perimeter, their agents, their engagements, their control rules and their journals. The same human may also hold a role in a larger organization, without losing their local responsibility.

The protocol must therefore frame **multi-human** as a possible federation of human mini-organizations. The first mode to explore is a peer-to-peer mode where humans talk to each other, each speaking from their mini-organization. Subsequent modes must cover more structured forms, notably when an executive carries responsibility for the umbrella activity, including several PRINCIPALs and their agents.

This multi-human organization must also treat **CONTROL** and **POLICY** as first-class elements: controls carry the transverse responsibilities (cyber, finance, ethics, legal, quality), while policies express the durable rules applicable to a mini-organization, a federation, an engagement or an umbrella activity.

## Project perimeter

- **Target package**: `@sentropic/{name-to-be-defined}-modules`, npm, TypeScript.
- **Working name**: `a2a-cli` (provisional, to be decided).
- **Planned integration**: possible takeover of the `@sentropic/harness` project (`../sentropic/`, branch to confirm — `br23` or `br25`).

## Downstream layers

- Requirements translating this intention into measurable items: `SPEC.md`.
- Design decisions taken to satisfy it: `DECISIONS.md`.
- Canonical vocabulary: `VOCABULARY.md`.

## Governance note for this intention

This intention may be revised by the PRINCIPAL; any substantial revision must be traced (date + reason) and trigger a consistency review on `SPEC.md` and `DECISIONS.md`.
