# Developing H2A host adapters

This guide prevents capability gaps between CLI operators from becoming implicit
or from being papered over with a shared label.

## Before coding

1. Open or use the dedicated Track WP
   `01KY7CAYTVW4PVGQ0D552EENDG` (*Host operator capability parity & gap
   governance*), and create a child item for the host-feature pair.
2. Read the [capability contract](specs/2026-07-23-host-operator-capability-contract.md).
3. Start at `gap`, not at `shipped`. Record host name, exact version, operating
   system, and source/probe URL or transcript.
4. Identify the actual hook boundary. A `Stop` hook, MCP registration, skill,
   and a pre-shell tool hook are different capabilities.

## Implementation sequence

1. **Probe.** Build a minimal host-native artifact that records its hook payload.
   Verify whether it runs *before* the dangerous tool and whether a denial
   prevents execution. Record a negative result as `gap`.
2. **Adapter.** Put host-specific parsing/registration in `packages/h2a/src/hosts/`.
   Keep the policy predicate independent of host payload syntax. Do not claim a
   shared hook format unless the host accepts it in a live probe.
3. **Render/install.** Generate the native manifest/config only after the probe.
   Preserve unrelated host config and make rendering idempotent.
4. **Tests.** Add: policy corpus tests, host artifact/schema tests, install/merge
   idempotence tests, and a version-pinned host E2E test or a documented `gap`.
5. **Matrix and release.** Update `docs/host-integration-matrix.md` and the
   contract’s feature table. State the capability precisely in release notes.

## Test corpus for a shell-command denial policy

Every enforcing adapter must prove rejection of at least:

- `h2a connect`
- `env X=1 h2a …`
- `sudo h2a …`
- `true; h2a …`

It must also prove that it does not reject unrelated work such as `git status`,
`echo h2a`, `./h2a`, and `company-h2a`. The adapter tests prove policy logic;
the host E2E proves that the host actually invokes it at the pre-action boundary.

## When a host cannot enforce

Do not emulate enforcement with a prompt, skill text, or lifecycle hook. Keep
state `gap` or `guided`, emit the safe MCP/skill alternative, retain the Track
child item, and schedule a probe when the host releases a relevant plugin API.
