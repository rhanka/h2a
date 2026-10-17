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
