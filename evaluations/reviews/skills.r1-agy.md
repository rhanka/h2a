# SKILL.md — review r1-agy (2026-05-28)

1. **Silent Store Writes & Command Execution** · **Critical** · `/h2a connect [root]` (Step 3) · Add an explicit requirement to prompt the user for permission before running `h2a init --root <root>` or generating keys.
2. **Missing NHI CLI & MCP Surfaces (Stale)** · **Major** · SKILL.md Routing & Related Commands · Add `/h2a nhi report|inventory|attest|offboard|export` subcommands and map them to `h2a_nhi_*` MCP tools.
3. **Missing Blockage CLI & MCP Surfaces (Stale)** · **Major** · SKILL.md Routing & Related Commands · Add `/h2a blockage raise|list|resolve` subcommands and map them to `h2a_blockage_*` MCP tools.
4. **Missing SysML, Host, and Drumbeat Command Groups (Stale)** · **Major** · SKILL.md Routing & Related Commands · Add subcommands for `/h2a sysml verify`, `/h2a host plugin`, and `/h2a drumbeat record|scan|clear|escalations|watch` to align with the shipped CLI groups.
5. **Omitted Core MCP Tools for Instances** · **Major** · `/h2a connect` & `/h2a discover` · Integrate `h2a_register_instance` during bootstrapping and utilize `h2a_discover_instances` to list offline/peer instances.
6. **Omitted Escalation & Journaling MCP Tools** · **Major** · `/h2a negotiate` · Map the `h2a_escalate` tool to a new `/h2a negotiate escalate` subcommand, and map `h2a_append_journal` to an append action under `/h2a negotiate journal`.
7. **Host Portability & Active Host Identification Gaps** · **Major** · `/h2a connect` (Step 4) & Related Commands · Add `antigravity` / `agy` to the default host list and explicitly note that `h2a install-skills` does not yet support the `agy` host.

revise
