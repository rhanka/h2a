# Handover Prompt For Claude

Use this as the initial prompt for a Claude session taking over the `h2a` repository.

```text
You are taking over the `h2a` project in `/home/antoinefa/src/a2a-cli`.

Work style required by the user:
- Be direct, pragmatic, and concise.
- Keep moving; do not stop at analysis when code/docs can be changed safely.
- Use systematic reporting in French:
  - Fait
  - A faire, split by track/workpackage when relevant
  - Attendus, only actionable user decisions or external actions
- Commit and push meaningful changes unless the user explicitly asks not to.
- Do not create unnecessary package fragmentation. The current constraint is 2 packages:
  - `@sentropic/h2a`
  - `@sentropic/h2a-cli`
- Preserve modularity internally, especially for `mcp`, `codex`, `claude`, and `gemini`.
- Never revert user changes or unrelated work.

Project summary:
- `h2a` means humans-to-agents.
- The project is not only A2A. It covers multi-human, multi-agent coordination, organization, mandates, governance, policies, contractual artifacts, control, escalation, and human-in-the-loop.
- The user is thinking in terms of each human having a small organization as principal, while also potentially participating in larger organizations.
- Important roles/concepts already discussed: `PRINCIPAL`, `EXECUTIF`, `CONDUCTOR`, `AGENTS`, `CONTROL`, `MANDATAIRE`, `CONTRACT`, `POLICY`, `ENGAGEMENT`, `AMENDMENT`, `MANDATE`, `AUTHORITY`, `SIGNATURE`, `ENFORCEMENT_PLAN`.

Repository:
- Path: `/home/antoinefa/src/a2a-cli`
- GitHub: `https://github.com/rhanka/h2a`
- Branch: `main`
- Root workspace is npm + TypeScript.
- Main files:
  - `README.md`: project index
  - `PLAN.md`: live project plan and backlog
  - `SPEC.md`: numbered requirements
  - `VOCABULARY.md`: canonical vocabulary
  - `DECISIONS.md`: append-only decision log
  - `evaluations/`: org-model use-case library (compatibility evaluations + Mermaid diagrams; `EVALUATIONS.md` is a thin pointer)
  - `RUNTIME_PROPOSAL.md`: runtime proposal
  - `packages/h2a`: core package
  - `packages/h2a-cli`: unified CLI package

Published npm packages:
- `@sentropic/h2a@0.1.0` is published.
- `@sentropic/h2a-cli@0.1.1` is published and is the version to consume.
- `@sentropic/h2a-cli@0.1.0` was also published but had an invalid `bin` entry after npm autocorrection. It should probably be deprecated with a message such as:
  `Use 0.1.1; 0.1.0 was published without the CLI bin entry.`
- Current package manifests use `license: "UNLICENSED"` until the user chooses a license.

Current implemented code:
- `@sentropic/h2a` exports:
  - protocol constants: `sentropic.h2a`, version `0.1`
  - role/artifact/envelope/negotiation constants and types
  - `createEnvelope`
  - `isH2AEnvelope`
  - `assertValidNegotiationState`
- `@sentropic/h2a-cli` exports:
  - `H2A_CLI_HOSTS`
  - `H2A_CLI_MCP_TOOL_NAMES`
  - host descriptors for `codex`, `claude`, `gemini`
  - `runCli`
  - `renderCliHelp`
- Implemented CLI commands:
  - `h2a --help`
  - `h2a hosts`
  - `h2a mcp-tools`

Useful commands:
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run pack:h2a`
- `npm run pack:h2a-cli`
- `git status --short --branch`
- `git log --oneline -5`

Known local environment notes:
- `npm` may print a warning about unknown `globalignorefile`; it is not currently blocking.
- If npm cache under `/home/antoinefa/.npm` is read-only, use a temp cache:
  `npm_config_cache=/tmp/h2a-npm-cache npm ...`
- If npm publish needs authentication, the user is authenticated in browser and expects Playwright MCP to be used.
- Avoid opening duplicate npm WebAuthn tabs. Let `npm publish` generate the challenge, press ENTER once if needed, or open only the exact latest URL manually. Old challenge tabs become stale and confuse the user.

Current plan:
- `PLAN.md` is the source of truth for workpackages and progress.
- Priority order from `PLAN.md`:
  1. Stabilize the `h2a` core artifact model.
  2. Implement the local-files runtime and store.
  3. Extend `h2a-cli` around that local runtime.
  4. Expose the same surface through a minimal MCP server.
  5. Add real host-side integrations for Codex and Claude.
  6. Add CI, examples, and release hygiene.

Recommended next implementation slice:
1. Add core artifact schemas in `@sentropic/h2a`:
   - `CONTRACT`
   - `POLICY`
   - `ENGAGEMENT`
   - `AMENDMENT`
   - `MANDATE`
   - `AUTHORITY`
   - `SIGNATURE`
   - `ENFORCEMENT_PLAN`
2. Add canonicalization and hash computation.
3. Add focused tests for stable canonical output and hash behavior.
4. Implement the local-files store only after the schemas are minimally stable.
5. Wire `h2a-cli register`, `discover`, and `inbox read` to that local runtime.
6. Then expose the same flow through MCP.

Open user decisions:
- Choose the project license.
- Decide whether to deprecate `@sentropic/h2a-cli@0.1.0`.
- Decide whether `gemini` stays in wave 1 or is deferred.
- Confirm whether the next track should be:
  - core schemas first
  - local-files runtime first
  - MCP server first
  - Codex/Claude plugin surface first

Recommended default if the user says "avance":
- Proceed with core schemas first.
- Keep changes small and test-driven.
- Update `PLAN.md` checkboxes as work progresses.
- Commit and push at the end of each coherent slice.

Important modeling constraints:
- `CONTRACT`, `POLICY`, and `ENGAGEMENT` are all binding artifacts, but should not be collapsed too early.
- `CONTROL` is a role; `ENFORCEMENT_PLAN` is the application plan.
- Escalation targets the competent authority of the scope, not always the local principal.
- `MANDATAIRE` presents, formats, and traces; it is not an arbitrator.
- V1 has no automatic inter-contract mediator.
- The initial concrete use case is one `PRINCIPAL` coordinating 15 `CONDUCTORS`.

When finishing a turn:
- Run the relevant verification command freshly.
- Report exactly what changed and what was verified.
- Include commit hash if committed.
- If blocked, say what action is needed from the user.
```
