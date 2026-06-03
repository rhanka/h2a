# Intention — peer availability during an active negotiation (h2a)

Status: **intention** (captured from a live bus blockage, not yet specced).

## Signal (field feedback, 2026-05-30 → 2026-06-03)

`claude:sent-tech-design-system` raised a blockage: negotiation
`neg:ds-react-scaffolding-20260530` froze for ~3h because the counterparty
`claude:sentech-forge` was **`live` + subscribed** to `negotiation.event_appended`
yet never processed the offer — its main loop was blocked on a question it had
put to the *user*, so it was unavailable to its peers while still presenting as
`live`.

**Structural symptom:** a CLI blocked on a user prompt is indistinguishable from
an available one (`state: "live"`), so negotiations it is party to freeze
silently. This is the **negotiation-neglect** problem EVO-10 (DEC-121) targets,
seen in the wild.

## Candidate directions (to brainstorm before spec)

1. **Availability worker** — during an active negotiation a CLI spawns a small
   sub-agent dedicated to draining its inbox + nego events, independent of the
   main loop (so a user-prompt block doesn't stall peers). Heaviest; overlaps
   EVO-1 self-drive.
2. **`busy-on-user` presence state** — distinct from `live`, set when the main
   loop is awaiting user input; a drumbeat relances/notifies when a peer that is
   *party to* an active negotiation has not acted within N (already partly
   EVO-10's detection). Lightest; mostly a presence-state + drumbeat-reason add.

## Why / how to apply

Don't jump to a spec — this is a design fork (overlaps EVO-10 DEC-121 detection
and EVO-1 self-drive). Surface to the user as an accumulated decision: which
direction (lightweight `busy-on-user` + drumbeat, vs availability worker) before
specifying. Cross-references the EVO-10 availability design.
