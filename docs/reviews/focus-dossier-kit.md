---
status: selection-failed
review-author:
  host: codex
  model: unavailable
  effort: unavailable
target-ref: 3ae95526312dd8413d95f591b302a86703d0e140
observed-failure: Exact author model/effort unavailable; owner confinement forbids installed h2a and live mesh access required by the reviewer selector.
---

# Portable Focus dossier review record

No peer was selected or dispatched. No consensus verdict is claimed. The owner's explicit confinement
rules override the harness launch procedure; no installed h2a, real host state or other process was accessed.
This record is not a completed independent review.

The authored adapter consumes the authoritative Focus schema/validator. The bundled validator is generated
from those source files with esbuild; the manifest binds source and output hashes and prepack checks them.
No runtime package dependency or release-train coupling was introduced. The DS renderer remains replaceable.

Local evidence (targeted only, no skip):

| Check | Before | After |
| --- | --- | --- |
| CLI/document fixture | 0/6; builder/template absent | 9/9, including extracted npm artifact and canonical-document rebuild |
| Browser offline | process is not defined | Desktop + 390px phone, cards, keyboard, themes, 1px strokes, touch pinch pass |
| Prototype-key identifiers | 7/8 CLI; browser selection false | CLI and browser accept arbitrary schema-valid IDs |
| Artifact boundary | 10,166 kit files, including toolchain; pack stdout overflow | Only six runtime assets; no source, test or nested node_modules |
| Existing Focus serving | Extracted artifact could not import @sentropic/focus | 8/8 after lazy builder routing and bundling the canonical validator |
| Rebuilding embedded document | 8/9; expanded comments refused | 9/9 after accepting standalone Mermaid comments |

Full local suites were not run. Safari/iOS hardware, Firefox, Windows and macOS browser behavior,
arbitrary Mermaid/PlantUML and independently attested human decisions are not covered. The four ecosystem
scenes are conceptual, sourced component relationships rather than a live inventory.

## Tour 2 — diagram-core

- status: selection-failed
- target-ref: 131f38b7517cb816e6cc344a51b0a1d66b6f2800
- observed-failure: Exact author model/effort unavailable; owner confinement forbids installed h2a/mesh reviewer selection and dispatch. No peer was selected; no consensus verdict is claimed.

DiagramNode.scene carries the DS generic@1 SemanticDocument as plain JSON. The catalog and
custom-flowchart builder emit semantic records; xyflow reads section.scene directly, including
link roles, optional labels and containment trees. Coordinates exist only in the disposable
adapter. No view, geometry or layout hint is serialized; L-R1..L-R11 remain DS-owned.

| Targeted evidence | Red | Green |
| --- | --- | --- |
| Focus schema | 39/41; scene refused and missing in schema | 41/41 |
| Catalog semantics + CLI rebuild | 8/11; no scene, supplied scene refused | 12/12 including readability regression |
| Supplied semantic name/link bypass | 11/12; opaque-code names passed build | 12/12; undefined_code, previous output preserved |
| Browser semantic tree | supplied scene refused | 2/2, nested bounds, optional labels, desktop/phone offline pinch |
| Focus schema/readability + skill | — | 120/120, including after rebase |

Final post-rebase command: node --test packages/h2a/test/focus-build.test.js
packages/h2a/test/dispatch-characterization-goldens.test.js packages/h2a/test/native-question-mode.test.js
packages/h2a/focus-kit/test/browser.test.mjs — 67 passed, 0 failed, 0 skipped.
node node_modules/vitest/vitest.mjs run packages/focus/tests/schema.spec.ts
packages/focus/tests/readability.spec.ts packages/track/src/cli/present-decision-skill.test.ts
— 120 passed. npm run typecheck — exit 0. node scripts/build-focus-dossier.mjs --check
— Focus dossier renderer sources and portable asset: verified.

HOME/XDG/H2A_ROOT were temporary; PLAYWRIGHT_BROWSERS_PATH selected the allowed test cache.
The first browser run exposed a missing browser under temporary HOME, then used that cache;
a mistaken edge-text selector was corrected to xyflow's actual edge-label class.
The final fetch included #364: BRANCH.md conflicted and was resolved to this branch's scope.
An initial retry was aborted after a documentation step ran too early; the clean rebase
was repeated. Range-diff confirms feature code unchanged, and targeted checks passed afterward.

No full local suite or installed binary was run. Private DS schema, DS layout, arbitrary
diagram-core types/ports/resources/extensions and Safari/iOS hardware remain outside verification.

### Delivery closure

The canonical schema/source extension also requires generated delivery copies.
npm run check:focus-vendor was red (8 differing files); npm run registry:sync -w @sentropic/focus
and npm run vendor:focus regenerated only the pinned schema digests and corresponding Track vendor.
The same check then reported focus-vendor OK: byte-identical to a fresh build.
Targeted packages/focus/tests/packaging.spec.ts was red 8/9 (two integrity_mismatch issues for
the schema), then green 9/9. An earlier concurrent invocation was inconclusive because the
Track build temporarily removed its dist; verification was rerun sequentially.
Targeted packages/track/src/cli/focus.test.ts passed 15/15 after regeneration.
npm run typecheck and node scripts/build-focus-dossier.mjs --check also passed after synchronization.
