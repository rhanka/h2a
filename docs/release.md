# Release procedure (V1)

> Status: tag-driven release automation is available (DEC-038). Local prep is done by `npm run release`; npm publication happens in GitHub Actions when the `vX.Y.Z` tag is pushed.

## Release Flow

V1 releases are lockstep across the two public packages:

- `@sentropic/h2a`
- `@sentropic/h2a-cli`

From a clean `main` checkout aligned with `origin/main`:

```sh
git pull --ff-only origin main
npm run release -- --version 0.2.0
git push origin HEAD
git push origin v0.2.0
```

`npm run release -- --version X.Y.Z` performs only local preparation:

1. Refuses to start unless `git status --porcelain` is clean.
2. Runs `npm run typecheck` and `npm test`.
3. Verifies those commands did not dirty the worktree.
4. Bumps `package.json`, `package-lock.json`, `packages/h2a/package.json`, and `packages/h2a-cli/package.json`.
5. Aligns `@sentropic/h2a-cli`'s dependency on `@sentropic/h2a` to `^X.Y.Z`.
6. Commits the version bump as `release: vX.Y.Z`.
7. Creates an annotated tag `vX.Y.Z` (signed when `git config commit.gpgsign` is `true`).

The script deliberately does **not** publish to npm and does **not** push to GitHub. `--dry-run` prints the planned commands and file bumps without writing files or running git/npm commands.

The version must be a strict `X.Y.Z` SemVer triple with no leading `v`, no pre-release/build metadata, and no leading zeros.

## Publish Workflow

`.github/workflows/release.yml` runs on tags matching `v*.*.*` and then:

1. Bootstraps Node 20 and upgrades npm to `^11.15.0` for Trusted Publishing.
2. Installs with `npm ci`.
3. Runs `npm run typecheck` and `npm test`.
4. Verifies the tag version matches both workspace package versions.
5. Publishes both packages with npm Trusted Publishing (`npm publish --access public`).
6. Creates a GitHub Release with generated notes.

The release job intentionally uses Node 20 for the publish bootstrap. The Node 22.22.2 hosted-toolcache npm has been observed failing during `npm install -g npm@^11.15.0` with a missing `promise-retry` module, while the separate CI matrix still verifies Node 20 and 22 compatibility.

Trusted Publishing must be configured on npm for both packages before a tag publish can succeed:

```sh
npm exec --package npm@^11.15.0 -- npm trust github @sentropic/h2a --repo rhanka/h2a --file release.yml --allow-publish --yes
npm exec --package npm@^11.15.0 -- npm trust github @sentropic/h2a-cli --repo rhanka/h2a --file release.yml --allow-publish --yes
```

`npm@11.15.0` or newer is required because npm configurations created after 2026-05-20 must explicitly allow at least one action (`npm publish` here). Older `npm trust github` clients omit that permission and the registry rejects the request.

The repository root is private and never publishes. The `--workspace` flag remains mandatory for package publication. The CLI bin entry (`bin: { h2a: "dist/bin.js" }`) is the failure mode that produced the broken `0.1.0` — see below.

## Release gate: `smoke.yml`

`.github/workflows/smoke.yml` runs on `workflow_dispatch` and on every push to `main`. It installs the currently published `@sentropic/h2a-cli@0.1.26` globally on a fresh Node 22 runner and exercises the published CLI surface:

- `h2a --help`, `h2a hosts`, `h2a mcp-tools`
- local store bootstrap: `h2a init`, `h2a register`, `h2a discover`
- host setup snippets: `h2a host setup --host codex --print`, `h2a host setup --host claude --print`

If smoke fails after a new publish, the publish is considered broken and must be deprecated (see DEC-029 for the existing precedent).

> Pin the version inside `smoke.yml` to the latest published `@sentropic/h2a-cli` after every publish, then expand the exercised commands to match that published surface.

## Known broken `0.1.0` and deprecation status

`@sentropic/h2a-cli@0.1.0` was published without the `bin` entry due to an autocorrection during the very first publication. DEC-029 records the decision to **deprecate** rather than `unpublish`. The message set during the `0.1.6` repair was:

> `Use 0.1.6; 0.1.0 was published without the CLI bin entry.`

The `npm deprecate` call was run interactively by a maintainer authenticated against `@sentropic`:

```sh
npm deprecate "@sentropic/h2a-cli@0.1.0" "Use 0.1.6; 0.1.0 was published without the CLI bin entry."
```

`0.1.26` is the supported baseline for all installs.

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
- DEC-038 — Release prep local + publication tag-driven via GitHub Actions.
- `.github/workflows/ci.yml` — build + tests gate.
- `.github/workflows/smoke.yml` — published-package smoke gate.
- `.github/workflows/release.yml` — tag-driven publish workflow.
