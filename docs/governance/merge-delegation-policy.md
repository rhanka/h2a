# Merge delegation policy (D3)

**Status:** consigned by the h2a conductor (WP4) per owner decision, 2026-08-02.
**Scope:** governs when a pull request may be merged **without** an explicit owner gate.
**Companion of:** [`RACI.md`](./RACI.md), `docs/governance/working-mode.md`.

## Decision (owner, 2026-08-02)

Delegate the merge of a **defined class** of pull requests. This does not create new
authority; it **formalizes what the conductor already does**, and it draws the line the
conductor must not cross.

## The delegated class — a PR may be merged without an owner gate **iff ALL** hold

1. **Required gate green.** Every required status check on the merge SHA is green
   (`build-and-test` on the supported Node matrix, `security-debt`, and the `smoke`
   set). The required gate — not a local run — is the authority
   (a local `npm test` can be host-dependent; the CI on the exact SHA is the gate).
2. **Two independent review legs, neither the author.** At least two review legs
   reviewed the change, and **none of them is the constructor** of the change — including
   when the constructor is a delegated sub-agent. The constructor's own leg (jambe-1)
   **never counts**. A review leg reports the **artifact** (the failing/passing
   evidence), not a verdict word.
3. **No owner-facing change.** The change alters nothing the owner sees or relies on as a
   surface: no user-visible behavior change, no published-package contract change, no
   destructive default, no irreversible action (publish, mass-restart, data deletion).

## What stays gated on the owner

- **Any owner-facing change** keeps the owner UAT — a surface, a published contract, a
  destructive or irreversible action, or a fleet-behavior change (e.g. widening
  auto-supervision across live sessions).
- **Publishing to npm** is irreversible and is never inside the delegated class.

## Enforceability (where this rule stops)

This is, today, a **conductor habit backed by the required CI gate**, not a structural
lock. Points (1) is structural (the branch-protection required checks). Points (2) and (3)
are **procedural**: nothing in the repository mechanically refuses a merge that skipped an
independent leg or that touches an owner-facing surface. The honest ladder
(structural > test > spec > habit) places (2)/(3) at the **spec/habit** rung. Raising them
to structural would require a merge-time check (e.g. a required job asserting two distinct
non-author review artifacts, and a labeled `owner-facing` path that forces the owner gate).
Until then, the conductor is the enforcer, and this document is the opposable record of the
standard the conductor is held to.

## Provenance

Owner decision recorded 2026-08-02 (AskUserQuestion, D3). Consigned into governance by the
h2a conductor (`claude:h2a:c18853e319ea`, WP4) as its assigned action item; the conductor
is the delegate exercising this class and is accountable for staying inside it.
