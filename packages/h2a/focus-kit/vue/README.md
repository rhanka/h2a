# Portable Vue candidate

**Source candidate, blocked on the published DS dependency closure. No usable Vue export is shipped yet.**

The default renderer is still the unchanged Svelte asset. The additive API is
`buildFocusDossier(document, { renderer: 'vue', mode: 'decision' | 'report' })`.
The CLI accepts `--renderer vue` and, optionally, `--mode report`. Selection is
host-owned; document data cannot choose a renderer. Missing candidate assets
refuse before publication, without a Svelte fallback.

The four application components are Vue Vapor SFC templates. They reuse the
neutral presentation/readability functions and evidence byte/search helpers.
The diagram adapter derives occurrence-keyed presentation for `generic@1`,
passes the registry and executor bindings explicitly, and supplies the DS glyph
resolver until the 0.40.1 fixes are available. It neither changes the semantic
document nor stores geometry. Other profiles refuse.

## Reproducible dependency blocker

On 2026-11-13, npm serves `@sentropic/design-system-vue@0.41.0-next.1`, but its
declared `@sentropic/design-system-themes@0.14.0` and
`@sentropic/diagram-canvas@0.2.0` are unavailable. The latter tarball returns 404.
The available canvas 0.1.0 lacks the `flowModel`, `diagramCardModel`,
`diagram-render` and `diagram-icons` exports imported by the Vue diagram host.
An exploratory installation using older-package overrides demonstrated this
incompatibility. Those overrides and its lockfile are not shipped.

DS owns publishing the complete compatible tuple. Acceptance: a clean npm
install with the declared versions, a committed lockfile, a complete portable
build, and the actual `DiagramSceneFigure` browser parity run. Do not weaken
the tuple check or substitute a diagram implementation to make the build pass.
`legacy-peer-deps=true` is confined to this candidate because the Vite plugin's
peer range excludes the owner-pinned Vue prerelease and the unused elements
peer is not part of the portable closure.

## Build and qualification after dependency publication

From the repository root, with `npm_config_cache` set to `.tmp/npm-cache`:

```sh
npm --prefix packages/h2a/focus-kit/vue install --no-audit --no-fund
node scripts/build-focus-vue.mjs
node scripts/build-focus-vue.mjs --check
FOCUS_PARITY_RENDERER=vue node --test packages/h2a/focus-kit/test/renderer-parity.test.mjs
```

The build emits separate `renderer-vue.html` and `renderer-vue-manifest.json`,
checks the exact tuple, records the rendered module inventory and notices,
rejects Svelte/runtime code generation/external assets, and retains the offline
CSP. The CLI consumes the frozen assets without a frontend compiler or network.
Commit the generated assets only after browser qualification. The candidate
has no mesh recipe identity: that contract belongs to L2.

The parity command never skips an unavailable Vue renderer. It compares exact
prepared-document serialization, headings, section content, glossary state,
nonempty cards and offline behavior. It emits candidate screenshots and paired
Svelte/Vue images under `.tmp/renderer-parity-results`. Camera chrome is allowed
to differ; document content is not. The default command verifies the frozen
Svelte baseline and does not claim Vue parity.

## Scope and remaining evidence

- L0 captures synthetic legacy/v2 dossiers and a validated decision used as a
  report, with DOM text/structure and screenshots at 1440 and 390. No numbered
  flows occur in this bounded corpus. It is not the complete spec-wide corpus.
- This checkout has no `ReportDocument` type, schema or existing report mode.
  The candidate report mode is a read-only view of `DecisionDossierDocument`:
  questions and recorded answers remain visible, local selection is disabled.
  No new report schema or readability exception is invented.
- The four SFCs compile with compiler-sfc 3.6.0-rc.15. This is syntax evidence,
  not DS runtime, diagram, offline export or report qualification.
- Vue screenshots, byte/visible-text parity, evidence interaction, folding,
  keyboard/touch, installed offline output and the candidate runtime closure
  remain unverified. The Vue parity command currently fails on absent assets.
- DS 0.40.1 card/zone anatomy and glyph defaults remain unqualified. ERD is
  outside the existing portable generic profile and is not claimed supported.
- L2 compile/isolate/serve and artifact delivery belong to sentropic. No
  substitute compiler service, mesh adapter or artifact publication is added.
- The async Focus HTML API and MCP chart/BPMN/custom-element migration are
  outside this bounded portable build request; no whole-L1 exit is claimed.

Independent review is incomplete: the review skill requires `h2a_run` through
MCP, which is not exposed in this session. No peer consensus is claimed.
