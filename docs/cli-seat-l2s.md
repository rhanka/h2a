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
| 1 — authority | Trusted channel context is explicit; neither source mode nor `delegate` grants custody. Renewable material also requires an exclusive family ticket. An unavailable consumer native projection never creates a profile. Trusted renewable custody delegates canonical material with an exclusive family ticket, including serialized-only native markers. |
| 2 — codecs/isolation | Claude/Vibe selectors match their credential paths; MCP is rendered at native JSON/TOML paths. Files use exclusive no-follow creation below a private XDG runtime root. Agy requires an injected isolated keyring adapter and never writes Gemini OAuth files. Native OS adapters remain L2a work. |
| 3 — environment/integration | MCP uses a closed allowlist and separate empty profile, including native manifest overrides. The interactive/headless env.json is private authentication IPC: non-seat launches retain their environment, while seat launches use the materializer childEnv. MCP keeps its closed environment. Enrollment shares the codec aliases. Generic five-CLI bundle enrollment is still unavailable in the published L1 facade, so its existing refusals remain and carry `seat-import-unavailable`. |
| 4 — matrix | The Node test compiles the actual three seat modules into a disposable tree and exercises the materializer in every cell. Two independently invented seats/families replace shared diagonal grants. Sixteen additional serialized-only diagonal cells exercise admission, canonical materialization, disposal, capture and clearance. Missing input and lab billing/Q1 reserve/Q3 admission are executable refusals. |
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

## Review 348 — Tour 3

Round-2 findings 1, 2, 4, 5 and the requested validation invariants of 6
have targeted red/green regressions. The public package entry now exports the
fixture, codec and materialization APIs. Renewable fixtures publish the explicit
serialized-only native marker; materialization consumes canonical.materialRef
under a trusted custodian ticket. Consumer materialization consumes only
nativeUse.accessRef. These remain invented stand-ins, including the injected
agy keyring payload; they do not resolve live references or qualify native auth.
Vibe MCP env uses an inline table that the actual native TOML editor can update
and remove. sanitizeEnvJson checks values only against explicit secrets;
short values of excluded keys cannot erase unrelated environment variables.

Finding 3 is wired against the real L1 contract in Sentropic
[PR 681](https://github.com/rhanka/sentropic/pull/681), pinned to
7293130ee3f6bfc6dd1e2fefcc07b3bd4d751a99. The public facade method is
importSeatBundle({ bundle, ownerScope }); the enrollment entry exports
parseCliSeatProfile and parseTokenSeatEnvelope. h2a validates the bounded
consumer envelope, requested provider and owner, access projection, expiry
and refreshAuthority none, then delegates persistence and lineage to L1.
There is no h2a account store or refresh implementation.

All five CLI providers and aliases now route --from cli|token (including
--cli/--token) exclusively through enrollSeatConsumerViaFacade. --from cli
requires --seat-profile <path>: a private 0600 L1 CliSeatProfileInput JSON
record/manifest, explicitly selected by its trusted caller. It is the L1
parser-only input, not a claim that native access-only auth is executable.
--from token reads the consumer SeatBundle over bounded stdin or masked input
(48 KiB, never argv). Both paths refuse missing expiry/capability metadata
and refresh-bearing projections before import. Actual elapsed expiry remains
a classified L1 acquisition refusal; importing a replacement never refreshes.
The older product SDK enrollViaFacade remains compatible for existing product
callers, but CLI shared-seat imports never call it or its renewable import legs.
OAuth still uses the product circuit.

Publication remains a release/integration gate: npm llm-mesh 0.26.1 and
cluster-mesh 0.18.0 do not expose this API. The currently pinned dependencies
fail closed before reading input when it is absent, with no product fallback.
No unpublished dependency version was installed into the checkout or written
to its lock. Source integration was exercised against the exact PR implementation
in a disposable package tree: ten imports through its actual public facade and
parsers, idempotency, reload, external marker, expiry/401, explicit refresh
refusal and stale lineage, with zero provider calls. This proves the pinned
source contract, not registry publication, deployed delivery or live credentials.

The exact pinned upstream validator distinguishes nested-refresh-field and
authority-escalation. Contrary to the review's line references, that commit
still accepts custodian renewable bundles without canonical material and
non-renewable custody refresh. h2a now rejects both to enforce the requested
spec invariants; this is stricter local validation, not exact upstream parity.
No independent harness consensus was dispatched: the owner's confinement
forbids installed/native h2a access. Only disposable fixtures were used.

## Final publication check (Dernier tour)

Sentropic PR #681 remains OPEN at this check. An isolated npm installation
of the latest published cluster-mesh 0.18.0 and llm-mesh 0.26.1 confirms that
parseCliSeatProfile, parseTokenSeatEnvelope and facade.importSeatBundle
are all absent (three executed assertions fail, none skipped). Rebasing h2a
cannot supply this missing upstream API. The publication reserve remains
open; this PR must not merge with it. No fallback, guard or lock was changed.
L1 owns publication; the subsequent h2a change must pin compatible published
versions and pass all five providers in both cli/token modes against those
packages, including external refresh refusal and persisted lineage.
