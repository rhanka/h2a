---
status: selection-failed
target-ref: fix/security-debt-sveltekit-deepmerge
observed-failure: Exact author model/effort and the required h2a_run review tool are unavailable; no independent consensus is claimed.
---

# Focus dependency security repair

`npm run audit:security`, the command used by CI's `security-debt` job,
failed on the original lockfiles with six findings (two moderate, four low).
The root workspace has none of the three affected packages; the independent
Focus app and renderer lockfiles both contain deepmerge.

| Package | Before | After | Reason |
| --- | --- | --- | --- |
| @sveltejs/kit | 2.70.2 | 3.1.1 | GHSA-pfhg-q3qv-9q6r, GHSA-27mw-82g8-phjj, GHSA-mw6w-2fmv-pvw3 |
| @sveltejs/adapter-node | 5.5.7 | 6.0.1 | GHSA-rqw3-x7hx-mm3p; Kit 3 peer compatibility |
| deepmerge (both builds) | 4.3.1 | npm:@shivammathur/deepmerge@4.3.2 | GHSA-gcqx-w48m-w2h4 |
| App vite-plugin-svelte / Vite | 6.2.4 / 7.3.7 | 7.3.1 / 8.3.8 | Kit 3 peer requirements |
| App Svelte / TypeScript | 5.56.4 / 5.9.3 | 5.57.1 / 6.0.3 | Kit 3 peer requirements |
| App cookie | 0.7.1 override | 2.0.2 | Remove obsolete override; use Kit's compatible dependency |
| Renderer devalue / source-map-js | 5.9.2 / 1.2.1 | 5.9.4 / 1.2.2 | Two high findings exposed by auditing the second build tree |

The advisory lists no patched upstream deepmerge release; `npm view deepmerge
versions` ends at 4.3.1. Even vite-plugin-svelte 7.3.1 still depends on
deepmerge ^4.3.1, so a direct parent bump cannot remove it. Both manifests use
an exact npm alias override to the small patched fork. Its source change
rejects `__proto__` before reading or copying either operand. Remove the
override when upstream or the parent publishes a compatible fixed dependency.
No advisory suppression or downgrade is used.

Kit 3 requires configuration inside the Vite plugin, `$app/tsconfig`, and an
explicit legacy `$lib` alias. Adapter 6 externalizes production packages by
name: Track is included in noExternal so its statically imported friendly
report helpers remain bundled, while the existing dynamic Track runtime lookup
continues to use the installed dependency. Both shipped artifacts are refreshed.

Validation (Node 22):

- `node --test scripts/deepmerge-security.test.mjs`: 8 failures before the
  override, then 10 passes, zero skips. Exercises each build's actual plugin
  dependency, null-prototype and nested inputs, both operands, forbidden
  getters, merge.all, arrayMerge and ordinary configuration merging.
- `npm run audit:security`: exit 1 before, exit 0 after; zero vulnerabilities.
- `npm --prefix packages/h2a/focus-kit audit --audit-level=moderate`: zero
  vulnerabilities. CI now audits this tree and runs the override regressions
  after clean installations of both independent lockfiles.
- `npm run build:focus-app`, `npm --prefix packages/h2a/focus-kit run build`,
  and root `node scripts/build-focus-dossier.mjs`: pass. Root invocation
  preserves the renderer's existing relative source comments.
- `npm run build`, `npm run typecheck`, and `npm --prefix apps/focus run check`:
  pass (Svelte reports nine state-capture warnings and the legacy alias warning).
- Targeted audit-security-debt, focus-build, focus-diagram-cards and focus-serve
  files: 59 passes. Browser, report-browser and evidence-browser files: 16 passes.
- Both artifact freshness checks and clean `npm ci --ignore-scripts` in each
  independent build pass. No full local repository suite was run.

The dependency updates supersede Dependabot #392, which proposed Kit 3.1.0
and adapter-node 6.0.0; those versions precede the required security patches.
The conductor owns Track updates and the merge decision.

## Round 2

- P2: replaced the flagged wording in the agent-memory page and injection route
  comments. The generated server comment originates in Svelte's renderer, so
  Vite rewords that one source comment at load time, before code and source-map
  generation. Installed dependencies remain unchanged. Comparing emitted code
  with comments removed confirms the server runtime is identical.
- P3: both npm overrides are nested under `@sveltejs/vite-plugin-svelte`.
  Lockfile regeneration and clean installs succeed with unchanged lockfile bytes;
  `npm ls deepmerge --all` resolves only the patched alias under that parent.
- Before correction, both lexical artifact checks and both override-scope checks
  fail. Afterwards all four pass; the repository-wide lexical scan retains 77
  matching lines outside PR-touched files. The conductor report lists each one.
- Security audits: zero vulnerabilities in both builds. Deepmerge: 10 passes.
  Six targeted audit/Focus files: 94 passes. Three browser files: 16 passes.
  No skips. Build, typecheck, Svelte check (zero errors, nine warnings), import
  lint and both artifact freshness checks pass.
- Independent review selection remains unavailable: no h2a MCP launch tool is
  exposed. No new peer consensus is claimed. CI and pushed head are recorded
  in the conductor report.
