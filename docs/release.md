# Release procedure (V1)

> Local prep is done by `npm run release`. Every stable release requires a
> successful `vX.Y.Z-rc.N` publication on npm `next` from the same source tree,
> followed by the owner's installation and real reboot test. Publication is
> an owner GO; agents must not push release tags or publish packages.

## Release Flow

V1 releases keep these four public packages in lockstep:

- `@sentropic/h2a`
- `@sentropic/h2a-cli`
- `@sentropic/h2a-runtime`
- `@sentropic/track` (record-only system of record; folded into the monorepo, published in lockstep)

`@sentropic/focus` joins the same tag-driven wave with its **independent** stable
version from `packages/focus/package.json`; release preparation never bumps it
to the h2a version. For `v0.98.7-rc.N`, CI publishes focus `0.5.0-rc.N` on
`next`; `v0.98.7` publishes focus `0.5.0` only after the owner tests that RC.
The RC focus dependency on Track is pinned to the exact Track RC. Stable
keeps the declared compatible Track range. No focus-specific Git tag is needed.

`main` is PR-only for everyone (admins included; required CI checks, no approval).
The version commit therefore goes through a PR, and the tag is created only
after the merge, on the merged commit.

From a clean `main` checkout aligned with `origin/main` (the script switches to
a new `release/vX.Y.Z` branch), or from the feature branch that carries the
bump (see `docs/governance/agent-release-policy.md`):

```sh
git pull --ff-only origin main
npm run release -- --version 0.2.0          # commits on release/v0.2.0, no tag
git push -u origin release/v0.2.0
gh pr create --base main --head release/v0.2.0 --fill
gh pr checks release/v0.2.0 --watch --required
gh pr merge release/v0.2.0 --merge
git fetch origin main
SHA=$(gh pr view release/v0.2.0 --json mergeCommit --jq .mergeCommit.oid)
git merge-base --is-ancestor "$SHA" origin/main
git show "$SHA:packages/h2a/package.json" | grep -q '"version": "0.2.0"'
# Owner GO: cut the candidate first (-s when commit.gpgsign=true).
git tag -a v0.2.0-rc.1 "$SHA" -m "release: v0.2.0-rc.1"
git push origin v0.2.0-rc.1
# Wait for the entire release.yml RC run, including the post-publish smoke
# and release-attestation-<run_attempt> upload, to succeed.
gh run list --workflow release.yml --branch v0.2.0-rc.1

# On the owner's machine, after checking that next is the intended RC:
npm view @sentropic/h2a dist-tags.next
npm i -g @sentropic/h2a@next
# Perform a REAL machine reboot, then verify h2a startup, reconnection,
# and the owner's normal workflow. Record the result and the RC run URL.

# Only after owner acceptance: tag the EXACT SAME merged commit.
git tag -a v0.2.0 "$SHA" -m "release: v0.2.0"
git push origin v0.2.0
# Wait for the entire stable release.yml run to succeed, including publication
# and post-publish smoke, then explicitly replace the RC on the owner's machine.
gh run list --workflow release.yml --branch v0.2.0
npm i -g @sentropic/h2a@0.2.0
```

Install the exact stable version explicitly after successful publication.
`h2a upgrade` and automatic upgrade reject prerelease versions, so they cannot
take an installed RC back to stable. Do not rely on `@next` for this step: it
continues to select a candidate.

Never tag before the merge: a squash or rebase merge rewrites the commit, so a
pre-merge tag would point outside `main`, and `release.yml` refuses any tag
that is not reachable from `origin/main`.

`npm run release -- --version X.Y.Z` performs only local preparation:

1. Refuses to start unless `git status --porcelain` is clean.
2. Runs `npm run typecheck` and `npm test`.
3. Verifies those commands did not dirty the worktree.
4. Bumps `package.json`, `package-lock.json`, and every workspace manifest (`packages/h2a`, `packages/h2a-cli`, `packages/h2a-runtime`, `packages/track`).
5. Pins internal dependencies and peers to exact `X.Y.Z`: `@sentropic/h2a-cli` → `@sentropic/h2a`, and `@sentropic/h2a` → `@sentropic/track` / `@sentropic/h2a-runtime`. Release gates reject mixed versions or ranges before packing and publishing.
6. Commits the version bump as `release: vX.Y.Z` on a branch: from `main` it first creates `release/vX.Y.Z`; from another branch it commits there; a detached HEAD is refused; it never commits on `main`.
7. Prints the next steps (branch push, PR, green CI, merge, fetch, annotated RC tag on the merged commit verified on `origin/main` — signed when `git config commit.gpgsign` is `true` — successful RC publication, owner installation and real reboot acceptance, stable tag on the same commit, and explicit stable installation after successful publication).

The script deliberately does **not** create the tag, does **not** publish to npm and does **not** push to GitHub. `--dry-run` prints the planned commands and file bumps without writing files or running git/npm commands.

The preparation script's version must be a strict `X.Y.Z` SemVer triple with
no leading `v`, pre-release/build metadata, or leading zeros. Keep this stable
version in Git while testing RCs. Do not commit an RC version bump: release CI
stamps all five package manifests (focus keeps its own base), exact internal pins and the independent
artifact-smoke version literal with `X.Y.Z-rc.N` in disposable checkouts only.
`N` is a nonnegative integer without leading zeros.

If the reboot test fails, fix the source through a PR, then cut `rc.2` (or the
next unused candidate number) on the new merged commit. Repeat installation
and the real reboot. Any source-tree change requires a new successful RC;
never move an existing tag. Avoid concurrent RC publications because all five
`next` tags must point to the candidate when its attestation is recorded.

## Publish Workflow

`.github/workflows/release.yml` runs on tags matching `v*.*.*` and then:

1. Resolves the release commit once and verifies it is on `origin/main`.
2. Verifies it on Linux with Node 22 and 24: `npm ci`, security audit,
   typecheck, the test trust root and `npm test`.
3. Prepares the tag version, packs the four lockstep packages and focus, then runs the
   packaged-artifact smoke. The same checks apply to RCs and stable releases.
4. Downloads the verified tarballs in publish (Node 22, npm `^11.15.0`) and
   checks their hashes and the gated commit. Before **any** stable publication,
   requires a successful RC attestation for `X.Y.Z` and the same Git tree hash.
   Backfill dispatches have the same requirement; there is no bypass input.
5. Publishes those exact tarballs in dependency order: track, h2a-runtime,
   h2a, h2a-cli, focus. Focus explicitly requests provenance; all five use npm OIDC. RCs always pass `--tag next`, including when below `latest`;
   they never update `latest`. Stable backfills retain `--tag backfill`.
6. Creates a GitHub Release (explicitly a prerelease for RCs), then runs the
   post-publish install/doctor smoke. RC installation must actually finish;
   propagation lag cannot produce a warning-only success or an attestation.
7. Confirms all five npm `next` tags point to the RC and their registry
   integrity matches the verified tarballs (including idempotent skips), records its version,
   repository, run ID/attempt, commit SHA, Git tree hash and completed smoke,
   then uploads `release-attestation-<run_attempt>` (90-day retention).

Stable promotion discovers proof through GitHub's repository-scoped
`release.yml` run/artifact APIs (`actions: read`). Only a completed successful
RC **tag push** run in this repository is eligible. The record must match its
run ID/attempt, all five versions (including the independent focus RC version) and the commit's tree from GitHub's Git API.
Missing/expired artifacts, API failures, incomplete smoke, a different release
train or a tree mismatch fail closed. If proof expires, publish and test a new
RC number from the intended tree. This CI proof covers the automated install
smoke; the real machine reboot remains an explicit owner acceptance step.

The PR publish rehearsal stays credential-free and uses `npm publish --dry-run`.
Its five publish bodies, including RC `next` selection, are compared strictly
with the release bodies; only the documented dry-run/default-tag differences
are allowed.

### Owner setup for focus on npmjs.com

Before creating an RC tag, the **owner** must open
https://www.npmjs.com/package/@sentropic/focus/access (package **Settings** →
**Trusted publishing** → **GitHub Actions**) and configure:

| Field | Value |
| --- | --- |
| Organization or user | `rhanka` |
| Repository | `h2a` (full repository: `rhanka/h2a`) |
| Workflow filename | `release.yml` (file: `.github/workflows/release.yml`) |
| Environment name | Leave empty (the publish job has no environment) |
| Allowed action, if shown | Publish |

Replace any publisher still pointing to the former sentropic repository. This
configuration belongs to npm, not this PR; no npm token/secret is required.
The workflow already has `id-token: write`, uses npm >=11.15.0, and focus
publishes with `--provenance --access public` from its verified tarball.

After the successful `v0.98.7-rc.N` run, check
`npm view @sentropic/focus dist-tags.next` equals `0.5.0-rc.N`, install that
exact version in an isolated consumer, and test its schema, validator and
normal use alongside h2a. Record owner acceptance and the RC run URL. Only
then may the owner create `v0.98.7` on the exact same merged commit. The
stable gate rejects old four-package attestations, missing/wrong focus
versions, different source trees and unverified RC bytes. The publish sanity
gate also requires the focus version exported by the five-package prepare
helper: dispatching a backfill against an older four-package helper fails
before any publication, including an old RC that would leave focus stable.
After successful
stable publication, install `@sentropic/focus@0.5.0` explicitly.

Trusted Publishing must be configured on npm for every package before a tag publish can succeed:

```sh
npm exec --package npm@^11.15.0 -- npm trust github @sentropic/h2a --repo rhanka/h2a --file release.yml --allow-publish --yes
npm exec --package npm@^11.15.0 -- npm trust github @sentropic/h2a-cli --repo rhanka/h2a --file release.yml --allow-publish --yes
npm exec --package npm@^11.15.0 -- npm trust github @sentropic/h2a-runtime --repo rhanka/h2a --file release.yml --allow-publish --yes
npm exec --package npm@^11.15.0 -- npm trust github @sentropic/track --repo rhanka/h2a --file release.yml --allow-publish --yes
```

> `@sentropic/track` trust was re-pointed at `rhanka/h2a` + `release.yml`, so all
> four packages now publish the same way: the verify-built tarball bytes via npm
> Trusted Publishing (`npm publish "dist-tarballs/sentropic-<name>-${v}.tgz"` after
> a `sha256sum --check`). The 0.98.6 incident — track repacked via
> `npm publish --workspace`, failing with TS2688 in the publish job where dev
> types are absent — is what this uniformity removes.

`npm@11.15.0` or newer is required because npm configurations created after 2026-05-20 must explicitly allow at least one action (`npm publish` here). Older `npm trust github` clients omit that permission and the registry rejects the request.

The repository root is private and never publishes. Packing uses `--workspace`;
publication uses verified `./dist-tarballs/*.tgz` file specs and never repacks
workspaces. The CLI bin entry (`bin: { h2a: "dist/bin.js" }`) is the failure
mode that produced the broken `0.1.0` — see below.

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
- DEC-027 — MIT license.
- DEC-029 — Deprecation of `@sentropic/h2a-cli@0.1.0`.
- DEC-031 — Layout `<root>/.h2a/` of the local-files store.
- DEC-032 — V1 with no transport authentication; identity declared by the caller.
- DEC-038 — Release prep local + publication tag-driven via GitHub Actions.
- `.github/workflows/ci.yml` — build + tests gate.
- `.github/workflows/smoke.yml` — published-package smoke gate.
- `.github/workflows/release.yml` — tag-driven publish workflow.
