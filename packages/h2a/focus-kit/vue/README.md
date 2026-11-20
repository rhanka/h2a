# Portable Vue candidate

**L1 buildable behind the flag, browser-qualified on the frozen parity corpus.
Svelte remains the default renderer.**

The default renderer is still the unchanged Svelte asset. The additive API is
`buildFocusDossier(document, { renderer: 'vue', mode: 'decision' | 'report' })`.
The CLI accepts `--renderer vue` and, optionally, `--mode report`. Selection is
host-owned; document data cannot choose a renderer. Missing candidate assets
refuse before publication, without a Svelte fallback.

The application components are Vue Vapor SFC templates. They reuse the
neutral presentation/readability functions, the shared decision/option codes
and response line, and evidence byte/search helpers. The diagram adapter
derives occurrence-keyed presentation for `generic@1`, passes the registry and
executor bindings explicitly, and supplies the DS glyph resolver. It neither
changes the semantic document nor stores geometry. Other profiles refuse.

## Dependency tuple (exact pins, lockfile committed)

| Package | Pin | Note |
|---|---|---|
| `@sentropic/design-system-vue` | `0.41.0-next.7` | dist-tag `next` |
| `@sentropic/design-system-themes` | `0.14.0` | direct pin, see below |
| `@sentropic/diagram-canvas` | `0.2.5` | |
| `@sentropic/diagram-core` | `0.3.0` | required by diagram-canvas 0.2.5 |
| `vue` / `@vue/compiler-sfc` | `3.6.0-rc.15` | Vapor |

On 2026-11-13 the tuple was unavailable: design-system-vue `0.41.0-next.1`
declared themes `0.14.0` and diagram-canvas `0.2.0`, neither published. Themes
`0.14.0` was published on 2026-11-14 and design-system-vue `0.41.0-next.7`
declares themes `0.14.0` + diagram-canvas `0.2.5`, so a clean install now
resolves. The build script rejects any other installed tuple version.

The themes pin stays direct: design-system-vue does not re-export
`entropicTheme` or `createComponent`, and its `styles.css` ships component
rules without token definitions. `ThemeProvider` compiles the theme object at
runtime (itself importing `compileTheme` from themes). Dropping the direct pin
would leave `themes.js` on a hoisted transitive copy only. Full analysis:
`tmp/h-cond/pr451-themes-need.md` (conductor copy).

`legacy-peer-deps=true` is confined to this candidate because the Vite plugin's
peer range excludes the owner-pinned Vue prerelease and the unused elements
peer is not part of the portable closure.

## Build and qualification

From the repository root, with `npm_config_cache` set to `.tmp/npm-cache`:

```sh
npm --prefix packages/h2a/focus-kit/vue install --no-audit --no-fund
node scripts/build-focus-vue.mjs
node scripts/build-focus-vue.mjs --check
node --test packages/h2a/focus-kit/test/renderer-parity.test.mjs
FOCUS_PARITY_RENDERER=vue node --test packages/h2a/focus-kit/test/renderer-parity.test.mjs
```

The build emits separate `renderer-vue.html` and `renderer-vue-manifest.json`,
checks the exact tuple, records the rendered module inventory and notices,
rejects Svelte/runtime code generation/external assets, and retains the offline
CSP. The CLI consumes the frozen assets without a frontend compiler or network.
The generated assets are committed with this change because the browser parity
below passed. The candidate has no mesh recipe identity: that contract
belongs to L2.

The parity command never skips an unavailable Vue renderer. It compares exact
prepared-document serialization, headings, section content, glossary state,
nonempty cards and offline behavior. It emits candidate screenshots and paired
Svelte/Vue images under `.tmp/renderer-parity-results`. Camera chrome is allowed
to differ; document content is not.

After the rebase on `origin/main`, the L0 Svelte baseline was re-frozen from
the current Svelte renderer (`parity-capture.mjs`): it gained decision/option
codes (`D1 ·`, `A ·`), the "Votre réponse" response summary and the Sources
bibliography. The Vue renderer mirrors those visible items (shared
`response-line.ts`, `Citation.vue`, bibliography in `Evidence.vue`) so both
parities pass on the same corpus.

## Scope and remaining evidence

- L0 captures synthetic legacy/v2 dossiers and a validated decision used as a
  report, with DOM text/structure and screenshots at 1440 and 390. No numbered
  flows occur in this bounded corpus. It is not the complete spec-wide corpus.
- This checkout has no `ReportDocument` type, schema or existing report mode.
  The candidate report mode is a read-only view of `DecisionDossierDocument`:
  questions and recorded answers remain visible, local selection is disabled.
  No new report schema or readability exception is invented.
- Vue parity on the frozen corpus (headings, non-diagram section text,
  glossary folded, no overflow, offline, nonempty diagram cards) passes at
  1440 and 390. Evidence interaction, folding, keyboard/touch beyond the
  parity script and installed-package offline output remain unverified here.
- Still waiting on DS: a stable (non-`next`) design-system-vue release or an
  explicit support statement for `0.41.0-next.7`; re-export of
  `entropicTheme`/`createComponent` (or documentation that themes is a required
  direct dependency); DS-side qualification of card/zone anatomy and glyph
  defaults in this tuple. ERD is outside the portable generic profile.
- L2 compile/isolate/serve and artifact delivery belong to sentropic. No
  substitute compiler service, mesh adapter or artifact publication is added.
- The async Focus HTML API and MCP chart/BPMN/custom-element migration are
  outside this bounded portable build request; no whole-L1 exit is claimed.

Independent review is incomplete: the review skill requires `h2a_run` through
MCP, which is not exposed in this session. No peer consensus is claimed.
