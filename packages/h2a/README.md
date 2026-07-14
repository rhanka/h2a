# @sentropic/h2a

Core contracts and runtime primitives for `h2a`, a human-to-agent coordination model.

Current bootstrap surface:

- envelope creation and validation
- negotiation state guards
- artifact type guards for CONTRACT, POLICY, ENGAGEMENT, AMENDMENT, MANDATE, AUTHORITY, SIGNATURE, ENFORCEMENT_PLAN
- contractual artifact profiles + strict audit helpers for CONTRACT / POLICY / ENGAGEMENT
- escalation target resolution against ENFORCEMENT_PLAN routes
- ABC model compatibility profiles + audit helper for enterprise / ecosystem / government-citizen mappings
- policy precedence profiles for ABC contexts, with explicit escalation rather than a hidden V1 resolver
- multi-human mode taxonomy + selector for peer, delegated, shared-engagement, federated, consortium, and public-authority flows
- packaged Focus Web server: `h2a focus serve` (exact alias: `h2a focus web`)
- governance boundary classification for protocol / policy / implementation items
- canonical JSON + SHA-256 hashing
- ed25519 canonical signing and verification
- append-only journal entries and chain verification
- authority matrix for role/artifact signing rights
- canonical protocol constants

## Migration / Transition

Moving from the `remote` or `track` CLIs to `h2a`? See the transition guide:
[`docs/TRANSITION.md`](../../docs/TRANSITION.md).

Repository: <https://github.com/rhanka/h2a>

Focus Web binds to `127.0.0.1:5178` by default and reads the nearest repository's `.track/events.jsonl`. Use `--repo`, `--track-events`, `--host`, or `--port` to override resolution. The command serves the production adapter-node artifact shipped in this package and fails closed if that artifact is absent or incompatible.
