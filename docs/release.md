# Release procedure (V1)

> Status: V1 manual release. The publish step is gated by a green CI (`.github/workflows/ci.yml`) and a green smoke install (`.github/workflows/smoke.yml`). No release automation yet.

## Current release approach

V1 releases are produced by hand from a clean `main` checkout by a maintainer authenticated against npm under the `@sentropic` scope. The two packages are published independently from the workspace root:

```sh
# 1. Tree must be clean and aligned with origin/main
git status
git pull --ff-only origin main

# 2. Bump versions inside each package's package.json (manual)
#    - packages/h2a/package.json
#    - packages/h2a-cli/package.json
#    Keep both versions in sync only when both packages actually changed; otherwise
#    bump only the package whose contents shifted.

# 3. Build + test
npm ci
npm run typecheck
npm test

# 4. Publish (public access, scoped package)
npm publish --workspace @sentropic/h2a       --access public
npm publish --workspace @sentropic/h2a-cli   --access public

# 5. Tag and push
git tag h2a-vX.Y.Z h2a-cli-vA.B.C
git push origin main --tags
```

The `--workspace` flag is mandatory: the repository root is private and never publishes. The CLI bin entry (`bin: { h2a: "./dist/cli.js" }`) is the failure mode that produced the broken `0.1.0` — see below.

## Release gate: `smoke.yml`

`.github/workflows/smoke.yml` runs on `workflow_dispatch` and on every push to `main`. It installs the currently published `@sentropic/h2a-cli@0.1.1` globally on a fresh Node 22 runner and exercises:

- `h2a --help`, `h2a hosts`, `h2a mcp-tools`
- `h2a init --root "$RUNNER_TEMP/.h2a"`
- `h2a register --json '...'` followed by `h2a discover` (output must contain the registered principal)
- `h2a host setup --host codex --print` (output must contain `"command": "h2a"`)

If smoke fails after a new publish, the publish is considered broken and must be deprecated (see DEC-029 for the existing precedent).

> Pin the version inside `smoke.yml` to the latest published `@sentropic/h2a-cli` after every publish, so the workflow guards what users actually `npm i -g`.

## Known broken `0.1.0` and standing deprecation request

`@sentropic/h2a-cli@0.1.0` was published without the `bin` entry due to an autocorrection during the very first publication. DEC-029 records the decision to **deprecate** rather than `unpublish`, with the message:

> `Use 0.1.1; 0.1.0 was published without the CLI bin entry.`

The actual `npm deprecate` call still needs to be run interactively by a maintainer authenticated against `@sentropic` (see WP-00 in `PLAN.md`):

```sh
npm deprecate "@sentropic/h2a-cli@0.1.0" "Use 0.1.1; 0.1.0 was published without the CLI bin entry."
```

`0.1.1` remains the supported baseline for all installs.

## Key management

`h2a negotiate sign` consumes a private key via `--private-key <pem-path>`, and `signCanonical` only sees the PEM the caller hands it. The V1 posture (DEC-032) does **not** ship a key manager.

Operational rules for V1:

- Store private PEMs on the local disk, in a path readable **only by the user** (typical `chmod 600`, `chmod 700` on the parent directory).
- **Never commit private PEMs** to the repository. `.gitignore` already excludes `*.pem`-like artifacts inside example flows; add an explicit ignore line whenever a new flow generates keys.
- The matching public key is registered against an instance via `H2AActorRegistration.publicKeys` (see `registerInstance` and DEC-031). Trust-on-first-use applies: the first registration fixes the public key for a given `id`; later artifacts signed with a different key will fail `verifyCanonical` at stabilization.
- Examples that need keys (`examples/principal-conductors/run.mjs`) generate ephemeral keys per run under a temporary root and never reuse them.

V2 will likely move the private key out of plain disk PEMs (OS keyring / signing service / hardware token) in conjunction with the transport auth posture deferred by DEC-032. No upgrade path is baked into V1 code; the V2 decision will pick the substrate.

## Cross-references

- DEC-026 — 2-package topology (`@sentropic/h2a` + `@sentropic/h2a-cli`).
- DEC-027 — Licence MIT.
- DEC-029 — Dépréciation de `@sentropic/h2a-cli@0.1.0`.
- DEC-031 — Layout `<root>/.h2a/` du store local-files.
- DEC-032 — V1 sans authentification de transport ; identité déclarée par l'appelant.
- `.github/workflows/ci.yml` — build + tests gate.
- `.github/workflows/smoke.yml` — published-package smoke gate.
