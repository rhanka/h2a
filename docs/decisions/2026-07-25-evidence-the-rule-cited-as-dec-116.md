# Evidence dossier — the rule cited as "DEC-116" in eight source files

**This is not a decision record.** It describes what the code *enforces*, with evidence. The section that
says *why* is deliberately **empty**, because only the decider can supply it. Do not treat a filled-in
version of this document as a decision unless the decider wrote that section.

Status: **awaiting the decider.** Nothing in the code changes because of this document.

## Why this dossier exists

Eight source files cite `DEC-116` as the authority for behaviour they implement. `DECISIONS.md` contains
**zero** occurrences of `DEC-116`, and `DEC-111` … `DEC-115` and `DEC-117` are all present — so the
numbering itself asserts a decision that was never recorded. An auditor who sees 111–115 and 117 will
reasonably conclude 116 exists and that they failed to find it.

The framing that matters: this is **not** "the code is unsafe". It is **"nobody can audit why the code is
that way."** The rule is enforced at the strongest rung available in code and recorded at the weakest rung
in governance — the first case found where the code is *stronger* than its warrant rather than weaker.

A dangling citation is worse than no citation. No citation invites the question *on whose authority?*; a
citation to a non-existent record answers that question **falsely and closes it**.

## Measured facts

All re-measured independently by two parties on 2026-07-25.

| Fact | Value |
|---|---|
| Source files citing `DEC-116` | **8** |
| Occurrences in `DECISIONS.md` | **0** |
| `git log -S'DEC-116' -- DECISIONS.md` | **empty** |
| Neighbours present in `DECISIONS.md` | `DEC-111`, `112`, `113`, `114`, `115`, `117` |

**The empty git history is the important one, and it is the benign branch.** A hole between 115 and 117 is
equally consistent with a decision that was *withdrawn* — and eight files citing a withdrawn decision would
be a far more serious finding. The history shows it was never written and never removed: simply never
recorded.

### The eight citing files

```
packages/h2a/src/runtime/identity/bindings.ts
packages/h2a/src/runtime/identity/migration.ts
packages/h2a/src/runtime/identity/readers.ts
packages/h2a/src/runtime/identity/resolver.ts
packages/h2a/src/runtime/mcp-http/oauth/config.ts
packages/h2a/src/runtime/mcp-http/oauth/single-tenant-provider.ts
packages/h2a/src/runtime/mcp-http/readonly-allowlist.ts
packages/h2a/src/runtime/mirror/build.ts
```

Two of these — the read-only allowlist and the key-custody path — are among the most security-relevant
surfaces in the package.

### Context that lowers the ceremony required

`DECISIONS.md` is a **mixed working log, not a formal registry**: `DEC-114` and `DEC-115` are bug-fix notes,
`DEC-111` and `DEC-117` are drumbeat items. The ask is to add to a working log, not to amend a constitution.

## What the code ENFORCES (observable, and safe for a non-decider to write down)

Quoted from the citing files:

- `runtime/mirror/build.ts` — *"possession of the key is the sole authority anchor"*
- `runtime/identity/bindings.ts` — *"Identity binding registry + proof-of-possession (DEC-116 F1 security core)"*
- `runtime/mcp-http/readonly-allowlist.ts` — cites the invariant alongside *"EVO-11 key custody"*

So, **as implemented**, the rule appears to be: **authority derives from demonstrated possession of the
identity key — not from a self-declared identifier, a bearer token, or a recorded mapping.** It shows up as
an identity binding registry with proof-of-possession, a key-custody constraint, and a read-only allowlist
that refuses any tool taking a private key.

That description is *behaviour*, reconstructed from code and citations. It is not a rationale.

## Rationale — TO BE SUPPLIED BY THE DECIDER

> *(deliberately empty)*
>
> What was decided, when, by whom, and **why** — including what alternatives were rejected and what the
> decision was trading off.

**Why this section is empty rather than reconstructed.** What the code enforces is observable; *what was
decided and why* is not. Reconstructing the second and presenting it for ratification would be inference
wearing the costume of a record — and it is much easier to say "yes, that looks right" than to recall
original reasoning, so a nod would launder inference into record while looking like authorship. A dossier
with a hole in it cannot be nodded through; it has to be answered.

## Open question the decider must also settle: the number

**This document deliberately does not claim the number.** The eight files *claim* `DEC-116`; whether the
record should *take* that number is the decider's call. Either:

- **retrofit 116** to match the existing citations, or
- **mint a fresh DEC** and correct the eight citations to point at it.

Claiming the number here would be a small instance of the same manufacturing this document avoids.

## The weaker sibling: `reflect-host-native`

The rule that h2a reflects the host-native display state (a Claude `customTitle`, a Codex thread name) is
cited **once** in the repo and **defined nowhere** — no DEC, no vocabulary entry — while five source files
depend on it. It is therefore **undocumented** rather than **falsely warranted**: no numbering hole asserts
anything, so the ask is smaller and less urgent.

Note the related finding: **no document said "at heartbeat"**, so §D1 of
`docs/specs/2026-07-25-h2a-lane-addressing.md` is the **first written statement of an existing practice** —
and it must be read that way, not as a decision previously taken. A behaviour everyone assumed was
contractual had no contract, which is why it could be absent for this long without a single test going red.

Also unrecorded, for completeness: nothing governs case-folding, slugification, resolve-before-send, or
bare-alias policy. One concrete cost is already visible — the owner's list-and-ask decision on ambiguity
**overrules one of those unrecorded rules**, so a public behaviour changes by amending a skill document with
no decision record to amend.
