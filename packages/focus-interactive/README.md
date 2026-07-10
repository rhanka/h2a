# @sentropic/focus-interactive

Focus L-B: a pure TypeScript, framework-agnostic interactive core.

This package owns only headless data contracts and deterministic state:

- neutral `PendingDecision` / `DecisionSource` / `CHANNEL_RANK` contract;
- opaque multi-project `decisionKey = projectHash:source:decisionId`;
- observable multi-focus deck store;
- swipe/navigation FSM;
- `FeedbackIntent` capture as data;
- sync client ports as interfaces only.

It intentionally imports no `@sentropic/h2a`, no `packages/h2a`, and no UI framework. Re-home / publish ownership is deferred to the owner-pending absorb-vs-federate decision in the Focus migration plan.
