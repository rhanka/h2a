# Bugfix: Cloud Code Assist compaction usage contract

## Objective

- [ ] Return Anthropic `input_tokens` and `output_tokens` from Cloud Code Assist `usageMetadata` for streamed and accumulated Messages responses.
- [ ] Preserve valid text and tool-use blocks required by Claude Code clients, without asserting that a gateway change repairs a locally rejected historical session.

## Scope / Guardrails

**Allowed Paths**

- `BRANCH.md`
- `packages/h2a-runtime/src/llm-gateway-runtime/proxy-gemini.ts`
- `packages/h2a-runtime/src/llm-gateway-runtime/proxy-gemini.test.ts`
- Published-package version and lockfile files required by the repository release recipe
- `docs/reviews/**` only for the required harness review record

**Forbidden Paths**

- `/home/antoinefa/src/h2a/**`, other worktrees, tmux state, and Claude Code transcript contents
- Gateway routing, model catalogues, provider credentials, and live session state
- A `/v1/messages/count_tokens` route or a client-side historical-transcript migration without evidence that the client calls it
- Unrelated proxy, build, deployment, dependency, or formatting changes

**Conditional Paths**

- `package.json`, `packages/h2a/package.json`, `packages/h2a-cli/package.json`, `packages/h2a-runtime/package.json`, `packages/track/package.json`, `packages/h2a/.codex-plugin/plugin.json`, and `package-lock.json` only for the lockstep patch release required after published runtime source changes.

## Plan / Todo (lot-based)

- [ ] **Lot 1 — prove the two boundaries and pin the Cloud Code response contract**
  - [ ] Read transcript metadata only: record the six successful historical compact boundaries/summaries and zero-usage synthetic responses after the local rejection.
  - [ ] Establish that the current Cloud Code path is `proxy-gemini.ts`; show that no request can be repaired by h2a when Claude Code rejects compaction before gateway egress.
  - [ ] Add deterministic handler tests with Cloud Code SSE fixtures for non-stream and stream usage normalization and structured blocks.
  - [ ] Gate: focused Vitest test is red before the runtime change, then green after it.

- [ ] **Lot 2 — normalize the proxy and make the publishable patch releasable**
  - [ ] Map `promptTokenCount` to `input_tokens` and `candidatesTokenCount` to `output_tokens` in both responses; preserve text and tool-use blocks with valid Anthropic stream events.
  - [ ] Do not add `count_tokens`, spoof model metadata, or alter transcript recovery without a request-level reproduction that makes either necessary.
  - [ ] Apply the repository lockstep patch-version and lockfile recipe for modified published runtime code.
  - [ ] Run focused and adapted project gates, mechanical scope check, atomic commit, push, and draft PR.
  - [ ] Gate: focused tests, TypeScript build, release sanity checks, and review evidence pass.

## Feedback Loop

- [ ] If Claude Code emits a gateway request after `/clear` or transcript migration and still rejects the normalized response, capture sanitized request/response metadata and open a separate client-contract investigation.
