# skills/h2a/SKILL.md — review (1/3, partial)

> 2026-05-28. Only **R1 (agy)** completed (`revise`); R2 (codex) exited 1, R3 (claude) deferred — review CLIs flaky. Findings verified vs the real shipped surface (`h2a mcp-tools`, cli-contract).

## Applied (valid)
- **Stale surface** (agy, major): the skill omitted the operational surface shipped this session. Added an **"Operational surfaces"** block to "Related commands" — `h2a nhi report|inventory|attest|offboard|export`, `blockage raise|list|resolve`, `drumbeat record|scan|clear|escalations|watch`, `sysml verify`, `host setup|status|plugin` — with the matching `h2a_*` MCP tools + DEC refs.
- **agy host portability** (agy, major): `/h2a connect` instance-id host list now `claude|codex|gemini|agy`; the `install-skills` line notes agy is a first-class MCP host (`host setup`/`host plugin`) but `install-skills` has no `agy` target yet (via `agy plugin import`, DEC-096).

## Not applied (scoped / deferred)
- "Make nhi/blockage/sysml/drumbeat full `/h2a` subcommands" — over-scope: `/h2a` is the interactive coordination skill (session/messaging/negotiation/model). The operational groups are documented as shell-invocable, not added as interactive routes.
- "Prompt before `h2a init`/key-gen in `/h2a connect`" — `connect` *is* the explicit init action; the skill already confirms an ambiguous root. Not a silent write.
- "Use `h2a_register_instance`/`h2a_discover_instances` in connect/discover", "map `h2a_escalate`/`h2a_append_journal`" — the skill is session-based by design; these are deferred (minor, optional additions).
