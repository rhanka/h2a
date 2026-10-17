# L2-s synthetic seat contract

This lot exercises invented credentials for agy, codex, vibe, muse and Claude.
The fixture contract is pinned to sentropic
`fb5e92a6ae4928066e181716fdffbfb490b0b4f3`, specifically
`packages/llm-mesh/src/enrollment/seat-bundle.ts` and
`packages/llm-mesh/tests/enrollment/seat-bundle.test.ts`.
It is not a live enrollment implementation or proof of native CLI behavior.

## L1 publication evidence — 2026-10-17

The original lot observed npm latest `@sentropic/llm-mesh@0.26.0`.
During the CI repair, `npm view @sentropic/llm-mesh version --json` returned
`0.26.1`. Its tarball contains `dist/enrollment/seat-bundle.{js,d.ts}` and
publicly re-exports the contract through `@sentropic/llm-mesh/node`.
The bundle API is therefore published; the historical publication blocker
no longer applies to it.

The live integration lot still needs L1's five-CLI seat import contract for
`--from cli | token`, with trusted authority/lineage validation, and an explicit
external refresh policy that disables automatic refresh and reports expiry/401
as access-unavailable. The published `StartEnrollmentInput.mode` and
`FacadeOptions.mode` currently expose only `cli | portal`; the public facade
has no generic seat-bundle import method or external refresh-policy option.
L1 owns that API/publication; acceptance is a synthetic import for all five
CLIs plus zero provider refresh calls on expiry/401 under external policy.
This CI repair keeps the synthetic fixture and
does not restore a provider dependency inside h2a. A later live consumer must
use the supported public boundary and exercise those contracts against
synthetic bundles before handling native credentials.

The inspected npm tarball integrity is
`sha512-bA15mFuWriwA6+hGACEGKiz2WExhTobZdqbmXpeagLKNdhnlmmIIVljJn6sDKkbXfF7oBH+eJQJt+egeFvZlDA==`.

## Live lane boundary

`scripts/e2e-cli-seats-direct.mjs` is an explicit refusal stub. It exits 2 for
valid live arguments until a future lot implements and verifies both L1 and
L2a receipts. It does not resolve installed provider packages: installation
version alone cannot prove a public contract or runner qualification.
L2a still owns pinned five-CLI installations and OS-specific keyring evidence.
Live NxN, refresh, billing and tool qualification remain outside L2-s.

## Review 348 — round 2

The independent review's unsafe synthetic behavior is reproduced and guarded:

| Finding | Correction and remaining boundary |
| --- | --- |
| 1 — authority | Trusted channel context is explicit; neither source mode nor `delegate` grants custody. Renewable material also requires an exclusive family ticket. An unavailable native projection never creates a profile. |
| 2 — codecs/isolation | Claude/Vibe selectors match their credential paths; MCP is rendered at native JSON/TOML paths. Files use exclusive no-follow creation below a private XDG runtime root. Agy requires an injected isolated keyring adapter and never writes Gemini OAuth files. Native OS adapters remain L2a work. |
| 3 — environment/integration | MCP uses a closed allowlist and separate empty profile, including native manifest overrides. All three native env.json writers sanitize raw/base64 secrets. Native launch helpers accept the materialized seat; enrollment shares the codec aliases. Generic five-CLI bundle enrollment is still unavailable in the published L1 facade, so its existing refusals remain and carry `seat-import-unavailable`. |
| 4 — matrix | The Node test compiles the actual three seat modules into a disposable tree and exercises the materializer in every cell. Two independently invented seats/families replace shared diagonal grants. Missing input and lab billing/Q1 reserve/Q3 admission are executable refusals. |
| 5 — envelope | Static-key fixtures have no refresh family. Validation checks byte limit, verified owner/client/predecessor, provider mapping, strict field lists, credential class, projection renewal fields and generation zero. |
| 6 — stream | Random stream operation ids, atomic cross-process family admission, capture-before-clearance, cleanup/persisted-successor acknowledgement and exact handoff. Ambiguous outcomes retain their fence. The runtime journal contains metadata only, never credentials. |
| 7 — tools/canary | Codec allow/deny and the exact active scenario are both required. Claude disables built-ins. Multiline, shell/env, parent-directory, keyring and auth-path requests are refused. Empty scans fail. Native tool enforcement remains a live qualification. |
| 8 — hygiene | Materialization checks credential precedence on its clean child environment; tests poison ambient overrides. Healthy access stays healthy; expiry/401 refuses access. Raw/base64 detection covers argv, env.json and receipts. |

L2-s cannot satisfy the review's live enrollment requirement by inventing a
facade method or duplicating Sentropic's credential store/refresh logic. The
remaining blocker in finding 3 has owner **Sentropic L1**, then the h2a consumer:
publish a supported import boundary for cli/token on all five providers with
verified owner/client/lineage and external refresh policy. Acceptance is ten
offline imports (five providers × two sources), zero refresh/fallback on 401 or
expiry, followed by h2a wiring through that public API. PR 348 must remain a
draft until that requirement and the independent integration review are met.

The matrix's budget and keyring adapters are synthetic fixtures. They do not
attest production billing, OS keyrings, provider acceptance, actual messaging,
PTY capture or model tool enforcement. No live receipt is emitted by L2-s.
