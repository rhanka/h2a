# SPEC EVOL — Scope guard `prBump`: replace the unsupported `gh` JSON field

Status: standalone hotfix spec, ready to implement. Base: `origin/main` (`dc78dc5f7`).
Deadline: merges planned 2026-10-20 21:00 UTC. One lot, no other behaviour change.
Addendum to the scope-guard hotfix spec (Track `01M5AZ78Z3S061J7KY8S5ZE37N`); ships with its Part 0.

## 1. Problem (proven 2026-10-20)

`prBump` in `packages/h2a/hooks/workspace-scope-shell.mjs:524` reads the PR base/head
commit SHAs with:

```
gh pr view <n> --repo <host/owner/repo> --json baseRefOid,headRefOid
```

The installed `gh` answers `Unknown JSON field: "baseRefOid"` (exit 1). `read()` then
returns `undefined`, `JSON.parse` throws, the `catch` at line 533 returns `undefined`,
and `packages/h2a/hooks/workspace-scope-guard.mjs:269` refuses every `gh pr merge` /
`gh pr ready` whose diff touches a `package.json` with `UNVERIFIABLE`
("Cannot inspect the PR diff.") — before any grant is evaluated.

Diff size is not the cause: engram #402 diff is 680 KB in 0.76 s, under the 2 MB /
4 s per-call limits of `read()` (`workspace-scope-shell.mjs:510-514`). Only PRs whose
diff touches a `package.json` reach line 524, so only they are refused.

Blocked now, owner GO already given for these merges:

| PR | Conductor | Note |
| --- | --- | --- |
| engram #402, #403 | gr-conductor | engram 0.21.0 release |
| radar-immobilier #875, #881 | i-cond | — |

## 2. Decision

In `prBump`, replace the `gh pr view --json baseRefOid,headRefOid` call (line 524) with
the REST endpoint, through the existing `read()` helper (same deadline, timeout, buffer):

```
gh api --hostname <host> repos/<owner>/<repo>/pulls/<n>
```

- `<host>`, `<owner>`, `<repo>` come from splitting `request.repo`, exactly as line 526
  already does for the `contents` call; hoist that split above the metadata fetch.
  `request.repo` is already validated by `/^[\w.-]+\/[^/]+\/[^/]+$/` (line 502) and
  `<n>` (`request.ref`) by `/^\d+$/` (line 508). All calls stay `spawnSync` argv, no shell.
- Read `base.sha` and `head.sha` from the JSON response, replacing
  `metadata.baseRefOid` / `metadata.headRefOid` at lines 525 and 529.
- Apply the unchanged SHA validation `/^[a-f0-9]{40,64}$/` to both values.
- Fetch metadata lazily once (`metadata ??=`), as today: one `gh` call replaces one
  `gh` call; no extra calls, no new deadline pressure.

Fail closed only on real absence: `gh api` failure, malformed JSON, missing
`base`/`head` object, or a missing / non-string / invalid `sha` must yield `undefined`
(hence `UNVERIFIABLE` in the guard), exactly as the current `try/catch` yields
`undefined`. Access `base.sha` / `head.sha` defensively so a missing object cannot
throw past that `catch`.

Rejected alternatives:

- Branch-name fields (`baseRefName` / `headRefName`, REST `base.ref` / `head.ref`):
  mutable refs, not commit SHAs; the compared manifests could change between the
  check and the merge. Immutable SHAs are required.
- Dual path / fallback to `baseRefOid` when supported: two code paths for one fact,
  and the failing path is the defect. Single REST path only.
- Another `gh`-version-dependent `--json` field: reintroduces the same coupling.

A `gh`-version-independent equivalent is acceptable only if it returns immutable
base/head commit SHAs for the PR, takes host/owner/repo/number from the same
validated inputs, goes through `read()`, and keeps the SHA validation and the
`true` / `false` / `undefined` tri-state. The REST endpoint above is the reference.

## 3. Invariants kept (no other behaviour change)

- Tri-state contract unchanged: `true` → `authorize('VERSION_BUMP', request)`
  (release grant required, `workspace-scope-guard.mjs:270` + `:240-241`);
  `false` → allowed; `undefined` → `UNVERIFIABLE` ("Cannot inspect the PR diff.",
  `:269`). The RELEASE path is unchanged: a published bump still requires a
  separate release grant.
- `publishedBump` (line 538-543) unchanged: top-level `name` + `version`,
  `private !== true`, version change. A private package is still not a bump.
- Diff acquisition unchanged: `gh pr diff` (line 515), 10 s overall deadline
  (line 509), 4 s / 2 MB per call (line 512).
- Manifest comparison unchanged: full before/after `package.json` fetched per SHA
  via `gh api --hostname <host> repos/<owner>/<repo>/contents/<path>?ref=<sha>`
  (lines 527-528), parsed as JSON before comparison (line 531).
- PR-number resolution when `request.ref` is absent (lines 503-507,
  `gh pr view --json number`) is untouched; it is outside this defect.
- No change to grants, audit, scope classification, or any other guard rule.
  `workspace-scope-guard.mjs` is not modified.

## 4. Lot 1 (only lot)

Exact files — nothing else:

1. `packages/h2a/hooks/workspace-scope-shell.mjs` — `prBump` only (lines 524-529
   area): REST metadata fetch, `base.sha` / `head.sha`, hoisted repo split.
2. `packages/h2a/test/workspace-scope-guard.test.js` — fake-`gh` fixture and tests.

Steps, in order:

1. RED test first (§5.1) against current code; observe it fail for the proven reason.
2. Update the fake `gh` in the fixture (currently lines 17-23):
   - `pr view` with a `--json` argument containing `baseRefOid` or `headRefOid`
     exits 1 with `Unknown JSON field: "baseRefOid"` on stderr, mimicking the
     installed `gh`. `pr view --json number` keeps returning `{number: 327}`.
   - `api` dispatch splits by endpoint: `repos/<owner>/<repo>/pulls/<n>` returns
     `{base:{sha:'a'.repeat(40)}, head:{sha:'b'.repeat(40)}}`, overridable per test
     via a `pr.pulls.json` fixture file (same file-driven pattern as `pr.diff`,
     `pr.base.json`, `pr.head.json`); `contents/...?ref=...` keeps serving
     `pr.base.json` / `pr.head.json` by `ref`.
3. Apply the §2 change in `prBump`.
4. GREEN tests (§5.2); then the full gate.

## 5. Tests

### 5.1 RED (before the fix)

With the updated fake `gh` rejecting `baseRefOid` and a non-bump `package.json`
change in `pr.diff`, `gh pr merge 327` is refused `UNVERIFIABLE` on current code.
This reproduces the production defect; after the fix the same case is GREEN test 2.

### 5.2 GREEN (after the fix, all through the fake `gh` above)

1. Published bump detected: existing test "a remote PR bump requires a separate
   release grant even after scope authorization" still passes via the REST path —
   `VERSION_BUMP` without a release grant, allowed with one.
2. Non-bump allowed: `package.json` touched, same top-level version (e.g. nested
   metadata change only) → merge allowed. Existing coverage in "remote private
   package versions and dependency metadata do not cause false bump refusals".
3. Invalid/missing SHA still `UNVERIFIABLE`: new case — `pr.pulls.json` returns a
   missing `base`, a missing `head.sha`, or a non-hex `sha` → refused
   `UNVERIFIABLE`, never allowed and never `VERSION_BUMP`.
4. Private package not a bump: `private:true` with a version change → allowed
   (existing case, now exercised through the REST path).

Because the fixture's fake `gh` always rejects `baseRefOid`, every `prBump` test
also proves the fixed code never calls `gh pr view --json baseRefOid,...` again.

Commands (from repo root):

```
node --test packages/h2a/test/workspace-scope-guard.test.js
npm test
```

## 6. Acceptance

- The 4 blocked PRs (engram #402, #403; radar-immobilier #875, #881) are no longer
  refused with `UNVERIFIABLE` / "Cannot inspect the PR diff." for this reason.
- A PR among them that really carries a published bump (engram 0.21.0) still goes
  through the `VERSION_BUMP` → release-grant path; that is expected, not a failure.
- All tests in §5 pass; no other guard test changes outcome.
- Rollback: revert the single lot. No state, no migration, no data format involved.

## 7. Résumé (français)

| Point | Contenu |
| --- | --- |
| Défaut | `gh pr view --json baseRefOid` refusé par le `gh` installé → tout merge touchant un `package.json` bloqué en `UNVERIFIABLE` |
| Bloqués | engram #402/#403 (gr-conductor), radar-immobilier #875/#881 (i-cond), GO owner donné |
| Décision | Lire `base.sha`/`head.sha` via `gh api --hostname <host> repos/<owner>/<repo>/pulls/<n>` |
| Fail-closed | Uniquement si SHA réellement absent ou invalide → `UNVERIFIABLE` comme aujourd'hui |
| Inchangé | Tri-state, `publishedBump`, chemin RELEASE, délais, grants, audit — `workspace-scope-guard.mjs` non touché |
| Lot unique | `workspace-scope-shell.mjs` (`prBump`) + `workspace-scope-guard.test.js` (fixture + tests) |
| Tests | RED d'abord (faux `gh` rejetant `baseRefOid`), puis GREEN : bump publié détecté, non-bump autorisé, SHA invalide → `UNVERIFIABLE`, package privé non-bump |
| Acceptation | Les 4 PR ne sont plus refusées pour cette raison ; un vrai bump passe toujours par le grant release |

## Post-implementation status (2026-11-07)

- #384 = `02f8e3948` (implements §2, the REST `pulls/<n>` base/head SHA read)
  + `04f0b7d08` (outside this spec: an explicit 404 reads as absence
  (`workspace-scope-shell.mjs:510-517`), both manifests absent →
  `UNVERIFIABLE` (`:534`), a deletion is allowed (`:537`), and an added
  publishable manifest counts as a published bump (`VERSION_BUMP`, release
  grant required): `prBump` returns `true` (`:538`), the guard calls
  `authorize('VERSION_BUMP', request)` (`workspace-scope-guard.mjs:270`)
  and refuses the request without a `release` grant (`:240-242`; tests
  `workspace-scope-guard.test.js:310`, `:319`, `:329`).
- The code line numbers cited in the restored text above are relative to base
  `dc78dc5f7`; the code line numbers cited in this section are as of the
  #384 merge (`9d4611ca5`).
- The `typeof`/array P3 review findings were applied in code; the other P3
  findings were not carried into this text.
- This section neutralizes line 3 ("ready to implement" — implemented and
  merged in #384), line 4 ("no other behaviour change" — the `04f0b7d08`
  scope above also landed), line 26 ("Blocked now" — the four PRs are merged)
  and line 83 ("Manifest comparison unchanged" — absent manifests, deletions
  and added publishable manifests are now handled as described above).
