# llm-gateway host — thin consumer contract

This private app hosts the public `@sentropic/llm-gateway` router. It is not a second gateway implementation.

## Owned here

- HTTP process lifecycle and health endpoints.
- Opaque, process-local bearer issuance for control-plane-created h2a sessions.
- Stable owner/workspace/client-affinity forwarding.
- Redacted status projection from Sentropic route diagnostics.
- Parsing and validation of public host routing configuration.

## Owned by Sentropic packages

- `@sentropic/llm-mesh`: enrollment/keyring, account inventory and health, policy/planner, affinity, model catalogue/equivalence council and provider adapters.
- `@sentropic/llm-gateway`: Anthropic/OpenAI ingress, caller authorization contract, route execution, retries before response commitment, tools/thinking/SSE conversion and metering.

The app must never read provider credential files, accept raw accounts through environment variables, refresh tokens, copy model tables or choose an account itself. Codex and Cloud Code must be enrolled through the llm-mesh facade. Legacy Codex credentials require explicit re-enrollment.

## Configuration

- `PORT` — listener port, default `3002`.
- `H2A_LLM_MESH_OWNER_SCOPE` — stable owner scope; defaults to a host-derived scope.
- `H2A_LLM_MESH_CONFIG_JSON` — provider enrollment configuration consumed opaquely by the mesh facade.
- `H2A_LLM_MESH_ROUTING_JSON` — validated public mesh policy/profiles/council selection.

The bearer returned by `POST /v1/session` is an opaque `gw-v2-*` value. It contains no provider, account, route, model or credential data and becomes invalid when the process exits.
The endpoint itself is control-plane-only: cluster network policy must keep workload pods and public callers from reaching it. The embedded solo-dev host binds its equivalent endpoint to loopback.
